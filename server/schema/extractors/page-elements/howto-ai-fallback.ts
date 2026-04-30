/**
 * AI HowTo disambiguation fallback (PR2). Wraps extractLists() output and
 * asks AI to flip `isHowToLike` when an ordered list with ≥3 items has no
 * heading match (i.e. it WAS rejected by the rule-based extractor).
 *
 * Shares the same AiBudget as image classifier; consumes 1 slot per
 * disambiguation. Behind schema-ai-element-classifier feature flag.
 *
 * The caller passes `orderedItemsRaw` (parallel array — one entry per
 * list, containing the list's li.text() values) so the AI sees actual
 * step content. Empty array means caller didn't extract item text and
 * the disambiguator falls through to no-op.
 */
import type { PageList, HowToStep } from '../../../../shared/types/page-elements.js';
import { isFeatureEnabled } from '../../../feature-flags.js';
import { callAI } from '../../../ai.js';
import { tryConsumeAiBudget } from './ai-budget.js';
import type { AiBudget } from './ai-budget.js';
import { createLogger } from '../../../logger.js';

const log = createLogger('schema/extractors/howto-ai-fallback');

const MIN_AI_DISAMBIG_ITEMS = 3;

const DISAMBIG_PROMPT = `You are deciding whether an ordered list on a webpage represents a procedural how-to (a step-by-step guide users would follow in order) versus a different kind of ordered list (e.g. ranking, table-of-contents, pricing tiers, FAQ summary).

Respond with strict JSON only: {"howTo": true|false}. No prose.

The list items are:
`;

export interface AiDisambiguateHowToOpts {
  budget: AiBudget;
  workspaceId: string | undefined;
}

interface AiResponse {
  howTo?: boolean;
}

export async function aiDisambiguateHowTo(
  lists: PageList[],
  orderedItemsRaw: string[],
  opts: AiDisambiguateHowToOpts,
): Promise<PageList[]> {
  if (!isFeatureEnabled('schema-ai-element-classifier')) return lists;
  if (lists.length === 0) return lists;
  // Caller didn't pass parallel item text — can't disambiguate
  if (orderedItemsRaw.length === 0) return lists;

  const result: PageList[] = [];
  for (let i = 0; i < lists.length; i++) {
    const list = lists[i];
    if (list.kind !== 'ordered'
      || list.isHowToLike
      || list.itemCount < MIN_AI_DISAMBIG_ITEMS
      || opts.budget.exhausted) {
      result.push(list);
      continue;
    }

    if (!tryConsumeAiBudget(opts.budget)) {
      result.push(list);
      continue;
    }

    try {
      const response = await callAI({
        provider: 'openai',
        model: 'gpt-4.1-mini',
        feature: 'schema-ai-element-classifier',
        workspaceId: opts.workspaceId,
        maxTokens: 50,
        temperature: 0,
        messages: [{
          role: 'user',
          content: DISAMBIG_PROMPT + orderedItemsRaw.slice(0, list.itemCount).map((t, idx) => `${idx + 1}. ${t}`).join('\n'),
        }],
      });
      const parsed: AiResponse = JSON.parse(response.text);
      if (parsed.howTo === true) {
        const steps: HowToStep[] = orderedItemsRaw.slice(0, list.itemCount).map((text, idx) => ({
          name: text,
          text,
          position: idx + 1,
        }));
        result.push({ ...list, isHowToLike: true, steps });
      } else {
        result.push(list);
      }
    } catch (err) { // catch-ok: AI parse or network error — keep rule-based output
      log.debug({ err, listIdx: i }, 'AI HowTo disambiguation failed; keeping rule output');
      result.push(list);
    }
  }
  return result;
}
