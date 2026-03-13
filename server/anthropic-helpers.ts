/**
 * Anthropic Claude helper — retry logic, rate-limit handling, and token tracking.
 * Used for creative writing tasks (content post generation) where Claude
 * produces more natural, less formulaic prose than GPT.
 */

import { logTokenUsage } from './openai-helpers.js';
import { createLogger } from './logger.js';

const log = createLogger('anthropic');

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface AnthropicChatOptions {
  model?: 'claude-sonnet-4-20250514' | 'claude-3-5-sonnet-20241022' | 'claude-3-5-haiku-20241022';
  system?: string;
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
  /** Label for logging (e.g. 'content-section', 'content-intro') */
  feature: string;
  /** Workspace ID for cost tracking */
  workspaceId?: string;
  /** Max retry attempts on 429/5xx (default 3) */
  maxRetries?: number;
  /** Timeout per request in ms (default 90000) */
  timeoutMs?: number;
}

interface AnthropicChatResult {
  text: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/**
 * Call Anthropic Messages API with automatic retry on 429/5xx,
 * exponential backoff, timeout, and token tracking.
 */
export async function callAnthropic(opts: AnthropicChatOptions): Promise<AnthropicChatResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured');

  const {
    model = 'claude-sonnet-4-20250514',
    system,
    messages,
    maxTokens = 2000,
    temperature = 0.7,
    feature,
    workspaceId,
    maxRetries = 3,
    timeoutMs = 90_000,
  } = opts;

  const bodyObj: Record<string, unknown> = {
    model,
    messages,
    max_tokens: maxTokens,
    temperature,
  };
  if (system) bodyObj.system = system;

  const body = JSON.stringify(bodyObj);

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');

        const isRetryable = res.status === 429 || res.status >= 500;
        if (isRetryable && attempt < maxRetries) {
          const retryAfter = res.headers.get('retry-after');
          let waitMs = Math.min(2000 * Math.pow(2, attempt), 30_000);
          if (retryAfter) waitMs = Math.max(parseInt(retryAfter, 10) * 1000 + 500, waitMs);
          log.info(`[${feature}] Anthropic ${res.status}, retrying in ${(waitMs / 1000).toFixed(1)}s (attempt ${attempt + 1}/${maxRetries})`);
          await new Promise(r => setTimeout(r, waitMs));
          continue;
        }
        throw new Error(`Anthropic ${res.status}: ${errText.slice(0, 300)}`);
      }

      const data = await res.json() as {
        content?: Array<{ type: string; text?: string }>;
        usage?: { input_tokens?: number; output_tokens?: number };
      };

      const text = data.content?.find(c => c.type === 'text')?.text?.trim() || '';
      const promptTokens = data.usage?.input_tokens || 0;
      const completionTokens = data.usage?.output_tokens || 0;
      const totalTokens = promptTokens + completionTokens;

      // Track usage (reuse the OpenAI token tracker)
      logTokenUsage({ promptTokens, completionTokens, totalTokens, model, feature, workspaceId });

      return { text, promptTokens, completionTokens, totalTokens };
    } catch (err) {
      if (err instanceof Error && err.name === 'TimeoutError' && attempt < maxRetries) {
        log.info(`[${feature}] Anthropic timeout, retrying (attempt ${attempt + 1}/${maxRetries})`);
        await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
        continue;
      }
      if (attempt === maxRetries) throw err;
      log.info(`[${feature}] Anthropic error: ${err instanceof Error ? err.message : err}, retrying (attempt ${attempt + 1}/${maxRetries})`);
      await new Promise(r => setTimeout(r, 2000 * Math.pow(2, attempt)));
    }
  }
  throw new Error(`[${feature}] Anthropic call failed after ${maxRetries} retries`);
}

/**
 * Check if Anthropic API is configured.
 */
export function isAnthropicConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}
