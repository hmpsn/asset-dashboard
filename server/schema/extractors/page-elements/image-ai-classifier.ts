/**
 * AI image-role classifier (PR2). Wraps the rule-based output of
 * extractImages() and re-classifies images flagged as ambiguous
 * (roleSource === 'fallback'). Budgeted: consumes one AiBudget slot
 * per image. Behind the schema-ai-element-classifier feature flag.
 *
 * Calls OpenAI's chat.completions.create() directly with vision content.
 * Bypasses callAI/callOpenAI because both stringify message content arrays
 * (callAI's `messages.content` is typed `string`-only; callOpenAI line 53
 * JSON.stringify's array content for cache-key purposes — both mangle vision
 * payloads). Mirrors server/alttext.ts:120-136 precedent. Manually invokes
 * logTokenUsage() after each successful call so cost telemetry still flows
 * into the standard pipeline.
 *
 * Failure modes (all leave the image unchanged):
 *   - feature flag off
 *   - budget exhausted
 *   - image fetch returns null (network, content-type, timeout)
 *   - AI returns non-JSON
 *   - AI returns a role outside the {hero, informative, decorative} set
 */
import OpenAI from 'openai';
import type { PageImage } from '../../../../shared/types/page-elements.js';
import { isFeatureEnabled } from '../../../feature-flags.js';
import { logTokenUsage } from '../../../openai-helpers.js';
import { fetchImageAsBase64 } from './image-fetch.js';
import { tryConsumeAiBudget } from './ai-budget.js';
import type { AiBudget } from './ai-budget.js';
import { createLogger } from '../../../logger.js';

const log = createLogger('schema/extractors/image-ai-classifier');

const VALID_ROLES = new Set<PageImage['role']>(['hero', 'informative', 'decorative']);
const MODEL = 'gpt-5.4-mini' as const;

const CLASSIFIER_PROMPT = `Classify this image into ONE of three roles for SEO schema markup:
- "hero": the page's lead image, conveying the primary subject. Usually large and visually prominent.
- "informative": diagrams, screenshots, charts, or photos that add factual content readers benefit from.
- "decorative": background patterns, spacers, brand watermarks, or stock photography that adds no factual content.

Respond with strict JSON only: {"role":"hero"|"informative"|"decorative"}. No prose.`;

// Lazy-initialized client + test injection seam.
type OpenAIClient = { chat: { completions: { create: (...args: unknown[]) => Promise<unknown> } } };
let _client: OpenAIClient | null = null;
function getClient(): OpenAIClient {
  if (_client) return _client;
  _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) as unknown as OpenAIClient;
  return _client;
}

/** Test-only: inject a fake OpenAI client. Not exported in production builds. */
export function __setOpenAIClientForTest(client: OpenAIClient): void {
  _client = client;
}

export interface AiClassifyImagesOpts {
  budget: AiBudget;
  workspaceId: string | undefined;
}

interface AiResponse {
  role?: string;
}

export async function aiClassifyImages(
  images: PageImage[],
  opts: AiClassifyImagesOpts,
): Promise<PageImage[]> {
  if (!isFeatureEnabled('schema-ai-element-classifier')) return images;

  const result: PageImage[] = [];
  for (const image of images) {
    if (image.roleSource !== 'fallback') {
      result.push(image);
      continue;
    }
    if (opts.budget.exhausted) {
      result.push(image);
      continue;
    }

    // Try to fetch the image FIRST — if fetch fails we shouldn't waste a budget slot.
    const dataUrl = await fetchImageAsBase64(image.src);
    if (!dataUrl) {
      result.push(image);
      continue;
    }

    if (!tryConsumeAiBudget(opts.budget)) {
      result.push(image);
      continue;
    }

    const startedAt = Date.now();
    try {
      const response = await getClient().chat.completions.create({
        model: MODEL,
        max_completion_tokens: 50,
        temperature: 0,
        messages: [{
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: dataUrl, detail: 'low' } },
            { type: 'text', text: CLASSIFIER_PROMPT },
          ],
        }],
      }) as {
        choices?: Array<{ message?: { content?: string | null } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
      };

      // Manual token logging — bypassed callAI, so we plug into telemetry directly.
      const usage = response.usage;
      if (usage && opts.workspaceId !== undefined) {
        logTokenUsage({
          promptTokens: usage.prompt_tokens ?? 0,
          completionTokens: usage.completion_tokens ?? 0,
          totalTokens: usage.total_tokens ?? 0,
          model: MODEL,
          feature: 'schema-ai-element-classifier',
          workspaceId: opts.workspaceId,
          durationMs: Date.now() - startedAt,
        });
      }

      const text = (response.choices?.[0]?.message?.content ?? '').trim();
      if (!text) {
        // Empty content (rare gpt-5.4-mini failure mode: refusal, content filter).
        // Avoid JSON.parse(''), which throws unnecessarily — budget already
        // consumed; stay rule-classified.
        result.push(image);
        continue;
      }
      const parsed: AiResponse = JSON.parse(text);
      if (parsed.role && VALID_ROLES.has(parsed.role as PageImage['role'])) {
        result.push({
          ...image,
          role: parsed.role as PageImage['role'],
          roleSource: 'ai',
        });
      } else {
        result.push(image);
      }
    } catch (err) { // catch-ok: AI parse failure or network error — degrade to rule output
      log.debug({ err, src: image.src }, 'AI image classification failed; keeping rule output');
      result.push(image);
    }
  }

  return result;
}
