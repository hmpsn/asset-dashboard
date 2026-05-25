/**
 * Unified AI dispatch helper.
 *
 * Routes to OpenAI (callOpenAI) or Anthropic (callAnthropic) based on the
 * `provider` option. New code should prefer `callAI()` over importing the
 * provider-specific helpers directly — existing direct imports still work.
 */

import { callOpenAI } from './openai-helpers.js';
import { callAnthropic } from './anthropic-helpers.js';
import { getAIOperationContract, type AIOperationId } from './ai-operation-registry.js';

export interface AICallOptions {
  /** Registry operation id for auditable operation contracts. */
  operation?: AIOperationId;
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
  feature?: string;
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
  /** Adds factual-grounding instructions for research-heavy outputs. */
  researchMode?: boolean;
}

export interface AICallResult {
  text: string;
  tokens: { prompt: number; completion: number; total: number };
}

export const RESEARCH_MODE_INSTRUCTIONS = `RESEARCH MODE:
- Make factual claims only when they are supported by the provided context.
- If the context does not contain enough evidence, say what is missing instead of guessing.
- Do not invent statistics, quotes, citations, studies, client results, publication names, or source URLs.
- When using supplied source material, preserve source names and direct evidence accurately.
- Distinguish observed evidence from inference. Use explicit language ("The provided data shows..." vs "This likely means...").
- If a user asks for sources or citations and none were provided, explicitly say source verification is unavailable in this context.
- Never present inferred or example values as verified facts.
- Prefer cautious, verifiable wording over confident claims when evidence is partial.`;

function applyResearchMode(system: string | undefined, enabled: boolean | undefined): string | undefined {
  if (!enabled) return system;
  return [system, RESEARCH_MODE_INSTRUCTIONS].filter(Boolean).join('\n\n');
}

/**
 * Call an AI model through the unified interface.
 * Dispatches to OpenAI or Anthropic based on opts.provider.
 */
export async function callAI(opts: AICallOptions): Promise<AICallResult> {
  const operationContract = opts.operation ? getAIOperationContract(opts.operation) : undefined;
  const provider = opts.provider ?? operationContract?.defaultProvider ?? 'openai';
  const model = opts.model ?? operationContract?.defaultModel;
  const feature = opts.feature ?? operationContract?.feature;
  if (!feature) throw new Error('callAI requires either feature or operation');

  const maxRetries = opts.maxRetries ?? operationContract?.defaultMaxRetries;
  const timeoutMs = opts.timeoutMs ?? operationContract?.defaultTimeoutMs;
  const responseFormat = opts.responseFormat ?? operationContract?.defaultResponseFormat;
  const researchMode = opts.researchMode ?? operationContract?.defaultResearchMode ?? false;
  const effectiveSystem = applyResearchMode(opts.system, researchMode);

  if (provider === 'anthropic') {
    const result = await callAnthropic({
      model: model as Parameters<typeof callAnthropic>[0]['model'],
      system: effectiveSystem,
      messages: opts.messages,
      maxTokens: opts.maxTokens,
      temperature: opts.temperature,
      feature,
      workspaceId: opts.workspaceId,
      maxRetries,
      timeoutMs,
      signal: opts.signal,
    });
    return {
      text: result.text,
      tokens: { prompt: result.promptTokens, completion: result.completionTokens, total: result.totalTokens },
    };
  }

  // OpenAI: inject system message as first message
  const openaiMessages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [];
  if (effectiveSystem) openaiMessages.push({ role: 'system', content: effectiveSystem });
  openaiMessages.push(...opts.messages);

  const result = await callOpenAI({
    model: model as Parameters<typeof callOpenAI>[0]['model'],
    messages: openaiMessages,
    maxTokens: opts.maxTokens,
    temperature: opts.temperature,
    feature,
    workspaceId: opts.workspaceId,
    maxRetries,
    timeoutMs,
    signal: opts.signal,
    responseFormat,
  });

  return {
    text: result.text,
    tokens: { prompt: result.promptTokens, completion: result.completionTokens, total: result.totalTokens },
  };
}
