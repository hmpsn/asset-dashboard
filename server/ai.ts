/**
 * Unified AI dispatch helper.
 *
 * Routes to OpenAI (callOpenAI) or Anthropic (callAnthropic) based on the
 * `provider` option. New code should prefer `callAI()` over importing the
 * provider-specific helpers directly — existing direct imports still work.
 */

import { callOpenAI } from './openai-helpers.js';
import { callAnthropic } from './anthropic-helpers.js';
import { getAIOperationRuntimeDefaults, type AIOperationId } from './ai-operation-registry.js';
import { randomUUID } from 'crypto';
import type { AIExecutionMetadata } from '../shared/types/ai-execution.js';
import { recordOperationTrace } from './platform-observability.js';

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
  /** Internal correlation for multi-provider execution chains. */
  executionChainId?: string;
  /** Set only when this call follows a failed provider attempt. */
  fallbackUsed?: boolean;
}

export interface AICallResult {
  text: string;
  tokens: { prompt: number; completion: number; total: number };
  execution: AIExecutionMetadata;
}

export type AIRenderedMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

/**
 * Exact instruction payload handed to a provider helper after callAI applies
 * research-mode and provider-specific system-message placement.
 *
 * High-integrity generation paths fingerprint this shape so provenance follows
 * the actual dispatched instructions rather than a caller's pre-wrapper prompt.
 */
export type AIRenderedProviderInput =
  | {
      provider: 'anthropic';
      system: string | undefined;
      messages: Array<{ role: 'user' | 'assistant'; content: string }>;
    }
  | {
      provider: 'openai';
      system: undefined;
      messages: AIRenderedMessage[];
    };

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

export function renderAIProviderInput(input: {
  provider: 'anthropic' | 'openai';
  system?: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  researchMode?: boolean;
}): AIRenderedProviderInput {
  const effectiveSystem = applyResearchMode(input.system, input.researchMode);
  if (input.provider === 'anthropic') {
    return {
      provider: 'anthropic',
      system: effectiveSystem,
      messages: input.messages,
    };
  }
  const messages: AIRenderedMessage[] = [];
  if (effectiveSystem) messages.push({ role: 'system', content: effectiveSystem });
  messages.push(...input.messages);
  return { provider: 'openai', system: undefined, messages };
}

/**
 * Call an AI model through the unified interface.
 * Dispatches to OpenAI or Anthropic based on opts.provider.
 */
export async function callAI(opts: AICallOptions): Promise<AICallResult> {
  const startedAt = new Date();
  const startedMs = Date.now();
  const runId = randomUUID();
  const operationDefaults = opts.operation ? getAIOperationRuntimeDefaults(opts.operation) : undefined;
  const provider = opts.provider ?? operationDefaults?.defaultProvider ?? 'openai';
  const model = opts.model ?? operationDefaults?.defaultModel;
  const feature = opts.feature ?? operationDefaults?.feature;
  if (!feature) throw new Error('callAI requires either feature or operation');

  const maxRetries = opts.maxRetries ?? operationDefaults?.defaultMaxRetries;
  const timeoutMs = opts.timeoutMs ?? operationDefaults?.defaultTimeoutMs;
  const responseFormat = opts.responseFormat ?? operationDefaults?.defaultResponseFormat;
  const researchMode = opts.researchMode ?? operationDefaults?.defaultResearchMode ?? false;
  const operation = opts.operation ?? feature;
  const cachePolicy = opts.signal ? { mode: 'none' } as const : (operationDefaults?.cachePolicy ?? { mode: 'inflight' } as const);
  const renderedInput = renderAIProviderInput({
    provider,
    system: opts.system,
    messages: opts.messages,
    researchMode,
  });

  if (provider === 'anthropic') {
    if (renderedInput.provider !== 'anthropic') throw new Error('Anthropic input rendering failed');
    const result = await callAnthropic({
      model: model as Parameters<typeof callAnthropic>[0]['model'],
      system: renderedInput.system,
      messages: renderedInput.messages,
      maxTokens: opts.maxTokens,
      temperature: opts.temperature,
      feature,
      workspaceId: opts.workspaceId,
      maxRetries,
      timeoutMs,
      signal: opts.signal,
      cachePolicy,
      runId,
      operation,
      executionChainId: opts.executionChainId,
      fallbackUsed: opts.fallbackUsed,
    });
    const completedAt = new Date();
    const cacheOutcome = result.execution?.cacheOutcome ?? 'miss';
    const originRunId = result.execution?.originRunId;
    if (cacheOutcome === 'hit' || cacheOutcome === 'inflight') recordOperationTrace({ source: 'ai', operation, status: 'success', durationMs: Date.now() - startedMs, workspaceId: opts.workspaceId, message: `${model ?? 'claude-sonnet-4-6'} reused ${cacheOutcome} result`, runId, originRunId, executionChainId: opts.executionChainId, provider, model: model ?? 'claude-sonnet-4-6', attempts: result.execution?.attempts ?? 1, cacheOutcome, fallbackUsed: opts.fallbackUsed });
    return {
      text: result.text,
      tokens: { prompt: result.promptTokens, completion: result.completionTokens, total: result.totalTokens },
      execution: {
        runId,
        ...(opts.executionChainId ? { executionChainId: opts.executionChainId } : {}),
        operation,
        provider,
        model: model ?? 'claude-sonnet-4-6',
        attempts: result.execution?.attempts ?? 1,
        ...(opts.fallbackUsed !== undefined ? { fallbackUsed: opts.fallbackUsed } : {}),
        ...(originRunId && originRunId !== runId ? { originRunId } : {}),
        cacheOutcome,
        startedAt: startedAt.toISOString(),
        completedAt: completedAt.toISOString(),
        durationMs: Date.now() - startedMs,
      },
    };
  }

  // OpenAI: inject system message as first message
  if (renderedInput.provider !== 'openai') throw new Error('OpenAI input rendering failed');

  const result = await callOpenAI({
    model: model as Parameters<typeof callOpenAI>[0]['model'],
    messages: renderedInput.messages,
    maxTokens: opts.maxTokens,
    temperature: opts.temperature,
    feature,
    workspaceId: opts.workspaceId,
    maxRetries,
    timeoutMs,
    signal: opts.signal,
    responseFormat,
    cachePolicy,
    runId,
    operation,
    executionChainId: opts.executionChainId,
    fallbackUsed: opts.fallbackUsed,
  });
  const completedAt = new Date();
  const cacheOutcome = result.execution?.cacheOutcome ?? 'miss';
  const originRunId = result.execution?.originRunId;
  if (cacheOutcome === 'hit' || cacheOutcome === 'inflight') recordOperationTrace({ source: 'ai', operation, status: 'success', durationMs: Date.now() - startedMs, workspaceId: opts.workspaceId, message: `${model ?? 'gpt-5.4-mini'} reused ${cacheOutcome} result`, runId, originRunId, executionChainId: opts.executionChainId, provider, model: model ?? 'gpt-5.4-mini', attempts: result.execution?.attempts ?? 1, cacheOutcome, fallbackUsed: opts.fallbackUsed });

  return {
    text: result.text,
    tokens: { prompt: result.promptTokens, completion: result.completionTokens, total: result.totalTokens },
    execution: {
      runId,
      ...(opts.executionChainId ? { executionChainId: opts.executionChainId } : {}),
      operation,
      provider,
      model: model ?? 'gpt-5.4-mini',
      attempts: result.execution?.attempts ?? 1,
      ...(opts.fallbackUsed !== undefined ? { fallbackUsed: opts.fallbackUsed } : {}),
      ...(originRunId && originRunId !== runId ? { originRunId } : {}),
      cacheOutcome,
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      durationMs: Date.now() - startedMs,
    },
  };
}
