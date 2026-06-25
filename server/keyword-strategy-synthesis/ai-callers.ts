import { callAI } from '../ai.js';
import type { AIOperationId } from '../ai-operation-registry.js';
import { buildSystemPrompt } from '../prompt-assembly.js';

export async function callKeywordStrategyAI(
  workspaceId: string,
  messages: Array<{ role: string; content: string }>,
  maxTokens: number,
  _label?: string,
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
    model: 'gpt-5.4-mini',
    system,
    messages: aiMessages,
    maxTokens,
    temperature: 0.3,
    workspaceId,
    maxRetries: 3,
    timeoutMs: 90_000,
  });
  return stripCodeFences(result.text);
}

export async function callNamedStrategyAI(
  workspaceId: string,
  operation: Extract<AIOperationId, 'keyword-page-assignment' | 'keyword-site-synthesis' | 'keyword-topic-clusters'>,
  messages: Array<{ role: string; content: string }>,
  maxTokens: number,
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
    temperature: 0.3,
    workspaceId,
  });
  return stripCodeFences(result.text);
}

function stripCodeFences(text: string): string {
  const trimmed = text.trim();
  if (!/^```(?:json|html|xml)?\s*/i.test(trimmed)) return trimmed;
  return trimmed
    .replace(/^```(?:json|html|xml)?\s*/i, '')
    .replace(/\s*```\s*$/i, '');
}
