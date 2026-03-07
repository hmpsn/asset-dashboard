/**
 * Shared OpenAI helper utilities — retry logic, rate-limit handling, and token tracking.
 * All AI features should use these instead of raw fetch() calls.
 */

// --- Token / Cost Tracking ---

interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  model: string;
  feature: string;
  workspaceId?: string;
  timestamp: string;
}

const usageLog: TokenUsage[] = [];
const MAX_LOG_SIZE = 500;

export function logTokenUsage(usage: Omit<TokenUsage, 'timestamp'>): void {
  usageLog.push({ ...usage, timestamp: new Date().toISOString() });
  if (usageLog.length > MAX_LOG_SIZE) usageLog.splice(0, usageLog.length - MAX_LOG_SIZE);
}

/** Get recent token usage, optionally filtered by workspace */
export function getTokenUsage(workspaceId?: string, since?: string): { entries: TokenUsage[]; totalTokens: number; estimatedCost: number } {
  let entries = usageLog;
  if (workspaceId) entries = entries.filter(e => e.workspaceId === workspaceId);
  if (since) entries = entries.filter(e => e.timestamp >= since);
  const totalTokens = entries.reduce((s, e) => s + e.totalTokens, 0);
  // Rough cost estimate: gpt-4o-mini ~$0.15/1M input + $0.60/1M output, gpt-4o ~$2.50/1M input + $10/1M output
  const estimatedCost = entries.reduce((s, e) => {
    if (e.model.includes('4o-mini')) {
      return s + (e.promptTokens * 0.00000015) + (e.completionTokens * 0.0000006);
    }
    return s + (e.promptTokens * 0.0000025) + (e.completionTokens * 0.00001);
  }, 0);
  return { entries, totalTokens, estimatedCost };
}

// --- Retry-enabled OpenAI call ---

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | Array<{ type: string; [key: string]: unknown }>;
}

interface OpenAIChatOptions {
  model?: 'gpt-4o-mini' | 'gpt-4o';
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
  /** Label for logging (e.g. 'seo-rewrite', 'schema-gen') */
  feature: string;
  /** Workspace ID for cost tracking */
  workspaceId?: string;
  /** Max retry attempts on 429/5xx (default 3) */
  maxRetries?: number;
  /** Timeout per request in ms (default 60000) */
  timeoutMs?: number;
}

interface OpenAIChatResult {
  text: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/**
 * Call OpenAI Chat Completions with automatic retry on 429/5xx,
 * exponential backoff, timeout, and token tracking.
 */
export async function callOpenAI(opts: OpenAIChatOptions): Promise<OpenAIChatResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not configured');

  const {
    model = 'gpt-4o-mini',
    messages,
    maxTokens = 1000,
    temperature = 0.7,
    feature,
    workspaceId,
    maxRetries = 3,
    timeoutMs = 60_000,
  } = opts;

  const body = JSON.stringify({
    model,
    messages,
    max_tokens: maxTokens,
    temperature,
  });

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        const isRetryable = res.status === 429 || res.status >= 500;
        if (isRetryable && attempt < maxRetries) {
          // Parse retry-after header if available
          const retryAfterMs = res.headers.get('retry-after-ms');
          let waitMs = Math.min(2000 * Math.pow(2, attempt), 30_000);
          if (retryAfterMs) waitMs = Math.max(parseInt(retryAfterMs, 10) + 500, waitMs);
          console.log(`[${feature}] OpenAI ${res.status}, retrying in ${(waitMs / 1000).toFixed(1)}s (attempt ${attempt + 1}/${maxRetries})`);
          await new Promise(r => setTimeout(r, waitMs));
          continue;
        }
        throw new Error(`OpenAI ${res.status}: ${errText.slice(0, 300)}`);
      }

      const data = await res.json() as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
      };

      const text = data.choices?.[0]?.message?.content?.trim() || '';
      const promptTokens = data.usage?.prompt_tokens || 0;
      const completionTokens = data.usage?.completion_tokens || 0;
      const totalTokens = data.usage?.total_tokens || 0;

      // Track usage
      logTokenUsage({ promptTokens, completionTokens, totalTokens, model, feature, workspaceId });

      return { text, promptTokens, completionTokens, totalTokens };
    } catch (err) {
      if (err instanceof Error && err.name === 'TimeoutError' && attempt < maxRetries) {
        console.log(`[${feature}] OpenAI timeout, retrying (attempt ${attempt + 1}/${maxRetries})`);
        await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
        continue;
      }
      if (attempt === maxRetries) throw err;
      // Generic retry for network errors
      console.log(`[${feature}] OpenAI error: ${err instanceof Error ? err.message : err}, retrying (attempt ${attempt + 1}/${maxRetries})`);
      await new Promise(r => setTimeout(r, 2000 * Math.pow(2, attempt)));
    }
  }
  throw new Error(`[${feature}] OpenAI call failed after ${maxRetries} retries`);
}

/**
 * Parse JSON from an AI response, stripping markdown fences if present.
 */
export function parseAIJson<T = Record<string, unknown>>(raw: string): T {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  return JSON.parse(cleaned);
}
