/**
 * Anthropic Claude helper — retry logic, rate-limit handling, and token tracking.
 * Used for creative writing tasks (content post generation) where Claude
 * produces more natural, less formulaic prose than GPT.
 */

import { logTokenUsage } from './openai-helpers.js';
import { createLogger } from './logger.js';
import { abortableDelay, composeTimeoutSignal, throwIfSignalAborted } from './abort-helpers.js';

const log = createLogger('anthropic');
const AI_REQUEST_CANCELLED_MESSAGE = 'AI request cancelled';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface AnthropicChatOptions {
  model?:
    | 'claude-sonnet-4-6'
    | 'claude-haiku-4-5-20251001'
    | 'claude-3-5-sonnet-20241022'
    | 'claude-3-5-haiku-20241022';
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
  /** Optional caller cancellation signal. Composed with timeoutMs. */
  signal?: AbortSignal;
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
    model = 'claude-sonnet-4-6',
    system,
    messages,
    maxTokens = 2000,
    temperature = 0.7,
    feature,
    workspaceId,
    maxRetries = 3,
    timeoutMs = 90_000,
    signal,
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
      throwIfSignalAborted(signal, AI_REQUEST_CANCELLED_MESSAGE);
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        body,
        signal: composeTimeoutSignal(timeoutMs, signal),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');

        const isRetryable = res.status === 429 || res.status >= 500;
        if (isRetryable && attempt < maxRetries) {
          const retryAfter = res.headers.get('retry-after');
          let waitMs = Math.min(2000 * Math.pow(2, attempt), 30_000);
          if (retryAfter) waitMs = Math.max(parseInt(retryAfter, 10) * 1000 + 500, waitMs);
          log.info(`[${feature}] Anthropic ${res.status}, retrying in ${(waitMs / 1000).toFixed(1)}s (attempt ${attempt + 1}/${maxRetries})`);
          await abortableDelay(waitMs, signal, AI_REQUEST_CANCELLED_MESSAGE);
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
      if (signal?.aborted) throw err;
      if (err instanceof Error && err.name === 'TimeoutError' && attempt < maxRetries) {
        log.info(`[${feature}] Anthropic timeout, retrying (attempt ${attempt + 1}/${maxRetries})`);
        await abortableDelay(2000 * (attempt + 1), signal, AI_REQUEST_CANCELLED_MESSAGE);
        continue;
      }
      if (attempt === maxRetries) throw err;
      log.info(`[${feature}] Anthropic error: ${err instanceof Error ? err.message : err}, retrying (attempt ${attempt + 1}/${maxRetries})`);
      await abortableDelay(2000 * Math.pow(2, attempt), signal, AI_REQUEST_CANCELLED_MESSAGE);
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

export interface AnthropicToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface AnthropicToolUseResult {
  toolInput: Record<string, unknown>;
  promptTokens: number;
  completionTokens: number;
}

/**
 * Call Anthropic Messages API with tool_use (structured output).
 * Forces the model to respond with the named tool's input_schema shape.
 * Returns the tool_use input block — guaranteed structured JSON.
 */
export async function callAnthropicWithTools(opts: {
  model?: string;
  system?: string;
  userMessage: string;
  tools: AnthropicToolDefinition[];
  /** Force a specific tool (tool_choice: { type: 'tool', name }). Defaults to auto. */
  forceTool?: string;
  maxTokens?: number;
  feature: string;
  workspaceId?: string;
  maxRetries?: number;
  timeoutMs?: number;
}): Promise<AnthropicToolUseResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured');

  const {
    model = 'claude-haiku-4-5-20251001',
    system,
    userMessage,
    tools,
    forceTool,
    maxTokens = 4096,
    feature,
    workspaceId,
    maxRetries = 3,
    timeoutMs = 60_000,
  } = opts;

  const bodyObj: Record<string, unknown> = {
    model,
    messages: [{ role: 'user', content: userMessage }],
    tools,
    max_tokens: maxTokens,
  };
  if (system) bodyObj.system = system;
  if (forceTool) bodyObj.tool_choice = { type: 'tool', name: forceTool };

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
          log.info(`[${feature}] Anthropic tool_use ${res.status}, retrying in ${waitMs}ms (attempt ${attempt + 1}/${maxRetries + 1})`);
          await new Promise(r => setTimeout(r, waitMs));
          continue;
        }
        throw new Error(`Anthropic tool_use ${res.status}: ${errText.slice(0, 300)}`);
      }

      const data = await res.json() as {
        content?: Array<{ type: string; input?: Record<string, unknown> }>;
        usage?: { input_tokens?: number; output_tokens?: number };
      };

      const toolUseBlock = data.content?.find(c => c.type === 'tool_use');
      if (!toolUseBlock?.input) throw new Error(`Anthropic tool_use: no tool_use block in response`);

      const promptTokens = data.usage?.input_tokens ?? 0;
      const completionTokens = data.usage?.output_tokens ?? 0;
      logTokenUsage({ promptTokens, completionTokens, totalTokens: promptTokens + completionTokens, model, feature, workspaceId });

      return { toolInput: toolUseBlock.input, promptTokens, completionTokens };
    } catch (err) {
      if (err instanceof Error && err.name === 'TimeoutError' && attempt < maxRetries) {
        log.info(`[${feature}] Anthropic tool_use timeout, retrying (attempt ${attempt + 1}/${maxRetries + 1})`);
        await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
        continue;
      }
      if (attempt === maxRetries) throw err;
      log.info(`[${feature}] Anthropic tool_use error: ${err instanceof Error ? err.message : String(err)}, retrying (attempt ${attempt + 1}/${maxRetries + 1})`);
      await new Promise(r => setTimeout(r, 2000 * Math.pow(2, attempt)));
    }
  }
  throw new Error(`[${feature}] callAnthropicWithTools failed after ${maxRetries} retries`);
}
