import { callAI } from '../ai.js';
import { MODEL_ROLES } from '../model-manifest.js';
import type { AIOperationId } from '../ai-operation-registry.js';
import { buildSystemPrompt } from '../prompt-assembly.js';
import { createHash } from 'crypto';
import type { AIExecutionMetadata } from '../../shared/types/ai-execution.js';

export interface KeywordStrategyAIExecution { execution: AIExecutionMetadata; inputFingerprint: string }
function fingerprint(system: string | undefined, messages: Array<{ role: string; content: string }>): string {
  return createHash('sha256').update(JSON.stringify({ system: system ?? null, messages })).digest('hex');
}

export async function callKeywordStrategyAI(
  workspaceId: string,
  messages: Array<{ role: string; content: string }>,
  maxTokens: number,
  _label?: string,
  onExecution?: (result: KeywordStrategyAIExecution) => void,
): Promise<string> {
  void _label;
  const wrappedMessages = messages.map((m, i) =>
    i === 0 && m.role === 'system'
      ? { ...m, content: buildSystemPrompt(workspaceId, m.content) }
      : m
  );

  const system = wrappedMessages[0]?.role === 'system' ? wrappedMessages[0].content : undefined;
  const aiMessages = (system ? wrappedMessages.slice(1) : wrappedMessages) as Array<{ role: 'user' | 'assistant'; content: string }>;

  const result = await callAI({
    operation: 'keyword-strategy',
    model: MODEL_ROLES.utilityExtraction,
    system,
    messages: aiMessages,
    maxTokens,
    workspaceId,
    maxRetries: 3,
    timeoutMs: 90_000,
  });
  onExecution?.({ execution: result.execution, inputFingerprint: fingerprint(system, aiMessages) });
  return stripCodeFences(result.text);
}

export async function callNamedStrategyAI(
  workspaceId: string,
  operation: Extract<AIOperationId, 'keyword-page-assignment' | 'keyword-site-synthesis' | 'keyword-topic-clusters'>,
  messages: Array<{ role: string; content: string }>,
  maxTokens: number,
  onExecution?: (result: KeywordStrategyAIExecution) => void,
): Promise<string> {
  const wrappedMessages = messages.map((m, i) =>
    i === 0 && m.role === 'system'
      ? { ...m, content: buildSystemPrompt(workspaceId, m.content) }
      : m
  );

  const system = wrappedMessages[0]?.role === 'system' ? wrappedMessages[0].content : undefined;
  const aiMessages = (system ? wrappedMessages.slice(1) : wrappedMessages) as Array<{ role: 'user' | 'assistant'; content: string }>;

  const result = await callAI({
    operation,
    system,
    messages: aiMessages,
    maxTokens,
    workspaceId,
  });
  onExecution?.({ execution: result.execution, inputFingerprint: fingerprint(system, aiMessages) });
  return stripCodeFences(result.text);
}

function stripCodeFences(text: string): string {
  const trimmed = text.trim();
  if (!/^```(?:json|html|xml)?\s*/i.test(trimmed)) return trimmed;
  return trimmed
    .replace(/^```(?:json|html|xml)?\s*/i, '')
    .replace(/\s*```\s*$/i, '');
}
