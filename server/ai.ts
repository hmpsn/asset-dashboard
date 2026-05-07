/**
 * Unified AI dispatch helper.
 *
 * Routes to OpenAI (callOpenAI) or Anthropic (callAnthropic) based on the
 * `provider` option. New code should prefer `callAI()` over importing the
 * provider-specific helpers directly — existing direct imports still work.
 */

import { callOpenAI } from './openai-helpers.js';
import { callAnthropic } from './anthropic-helpers.js';

export interface AICallOptions {
  /** Provider to use. Defaults to 'openai'. */
  provider?: 'openai' | 'anthropic';
  /** Model override. Defaults to provider's default (gpt-5.4-mini / claude-sonnet-4-6). */
  model?: string;
  /** System prompt (mapped to OpenAI system message or Anthropic system field). */
  system?: string;
  /** Conversation messages. */
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  /** Max tokens for completion. */
  maxTokens?: number;
  /** Temperature (0-2 for OpenAI, 0-1 for Anthropic). */
  temperature?: number;
  /** Feature label for logging and cost tracking. */
  feature: string;
  /** Workspace ID for cost attribution. */
  workspaceId?: string;
  /** Optional request timeout. */
  timeoutMs?: number;
  /** Max retry attempts on 429/5xx. Defaults to provider helper behavior. */
  maxRetries?: number;
  /** Optional caller cancellation signal. Composed with provider timeout. */
  signal?: AbortSignal;
  /** OpenAI-only structured response mode. */
  responseFormat?: { type: 'json_object' };
}

export interface AICallResult {
  text: string;
  tokens: { prompt: number; completion: number; total: number };
}

/**
 * Call an AI model through the unified interface.
 * Dispatches to OpenAI or Anthropic based on opts.provider.
 */
export async function callAI(opts: AICallOptions): Promise<AICallResult> {
  const { provider = 'openai', system, messages, ...rest } = opts;

  if (provider === 'anthropic') {
    const result = await callAnthropic({
      model: rest.model as Parameters<typeof callAnthropic>[0]['model'],
      system,
      messages,
      maxTokens: rest.maxTokens,
      temperature: rest.temperature,
      feature: rest.feature,
      workspaceId: rest.workspaceId,
      maxRetries: rest.maxRetries,
      timeoutMs: rest.timeoutMs,
      signal: rest.signal,
    });
    return {
      text: result.text,
      tokens: { prompt: result.promptTokens, completion: result.completionTokens, total: result.totalTokens },
    };
  }

  // OpenAI: inject system message as first message
  const openaiMessages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [];
  if (system) openaiMessages.push({ role: 'system', content: system });
  openaiMessages.push(...messages);

  const result = await callOpenAI({
    model: rest.model as Parameters<typeof callOpenAI>[0]['model'],
    messages: openaiMessages,
    maxTokens: rest.maxTokens,
    temperature: rest.temperature,
    feature: rest.feature,
    workspaceId: rest.workspaceId,
    maxRetries: rest.maxRetries,
    timeoutMs: rest.timeoutMs,
    signal: rest.signal,
    responseFormat: rest.responseFormat,
  });

  return {
    text: result.text,
    tokens: { prompt: result.promptTokens, completion: result.completionTokens, total: result.totalTokens },
  };
}
