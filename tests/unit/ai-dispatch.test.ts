import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  callOpenAI: vi.fn(),
  callAnthropic: vi.fn(),
  recordOperationTrace: vi.fn(),
}));

vi.mock('../../server/openai-helpers.js', () => ({
  callOpenAI: mocks.callOpenAI,
}));

vi.mock('../../server/anthropic-helpers.js', () => ({
  callAnthropic: mocks.callAnthropic,
}));
vi.mock('../../server/platform-observability.js', () => ({ recordOperationTrace: mocks.recordOperationTrace }));

import { callAI } from '../../server/ai.js';

describe('callAI', () => {
  beforeEach(() => {
    mocks.callOpenAI.mockReset();
    mocks.callAnthropic.mockReset();
    mocks.recordOperationTrace.mockReset();
  });

  it('passes OpenAI JSON response format through the dispatcher', async () => {
    mocks.callOpenAI.mockResolvedValue({
      text: '{"ok":true}',
      promptTokens: 10,
      completionTokens: 4,
      totalTokens: 14,
    });

    await callAI({
      model: 'gpt-5.6-luna',
      messages: [{ role: 'user', content: 'Return JSON.' }],
      feature: 'unit-test',
      responseFormat: { type: 'json_object' },
    });

    expect(mocks.callOpenAI).toHaveBeenCalledWith(expect.objectContaining({
      responseFormat: { type: 'json_object' },
      messages: [{ role: 'user', content: 'Return JSON.' }],
    }));
  });

  it('injects OpenAI system prompts while preserving JSON response format', async () => {
    mocks.callOpenAI.mockResolvedValue({
      text: '{"ok":true}',
      promptTokens: 12,
      completionTokens: 3,
      totalTokens: 15,
    });

    await callAI({
      model: 'gpt-5.6-luna',
      system: 'Return only valid JSON.',
      messages: [{ role: 'user', content: 'Classify this note.' }],
      feature: 'unit-test-system-json',
      responseFormat: { type: 'json_object' },
    });

    expect(mocks.callOpenAI).toHaveBeenCalledWith(expect.objectContaining({
      responseFormat: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'Return only valid JSON.' },
        { role: 'user', content: 'Classify this note.' },
      ],
    }));
  });

  it('passes OpenAI cancellation and retry options through the dispatcher', async () => {
    mocks.callOpenAI.mockResolvedValue({
      text: 'ok',
      promptTokens: 8,
      completionTokens: 2,
      totalTokens: 10,
    });
    const controller = new AbortController();

    await callAI({
      model: 'gpt-5.6-luna',
      messages: [{ role: 'user', content: 'Draft this.' }],
      feature: 'unit-test-options',
      maxRetries: 1,
      timeoutMs: 12_000,
      signal: controller.signal,
    });

    expect(mocks.callOpenAI).toHaveBeenCalledWith(expect.objectContaining({
      maxRetries: 1,
      timeoutMs: 12_000,
      signal: controller.signal,
      cachePolicy: { mode: 'none' },
    }));
  });

  it('adds research-mode instructions to OpenAI system prompts', async () => {
    mocks.callOpenAI.mockResolvedValue({
      text: 'ok',
      promptTokens: 8,
      completionTokens: 2,
      totalTokens: 10,
    });

    await callAI({
      model: 'gpt-5.6-luna',
      system: 'Return JSON.',
      messages: [{ role: 'user', content: 'Summarize this evidence.' }],
      feature: 'unit-test-research-openai',
      researchMode: true,
    });

    expect(mocks.callOpenAI).toHaveBeenCalledWith(expect.objectContaining({
      messages: [
        expect.objectContaining({
          role: 'system',
          content: expect.stringContaining('RESEARCH MODE'),
        }),
        { role: 'user', content: 'Summarize this evidence.' },
      ],
    }));
  });

  it('adds research-mode instructions to Anthropic system prompts', async () => {
    mocks.callAnthropic.mockResolvedValue({
      text: 'ok',
      promptTokens: 9,
      completionTokens: 3,
      totalTokens: 12,
    });

    await callAI({
      provider: 'anthropic',
      model: 'claude-opus-4-8',
      system: 'Write carefully.',
      messages: [{ role: 'user', content: 'Draft this.' }],
      feature: 'unit-test-research-anthropic',
      researchMode: true,
    });

    expect(mocks.callAnthropic).toHaveBeenCalledWith(expect.objectContaining({
      system: expect.stringContaining('RESEARCH MODE'),
    }));
  });

  it('passes Anthropic cancellation and retry options through the dispatcher', async () => {
    mocks.callAnthropic.mockResolvedValue({
      text: 'ok',
      promptTokens: 9,
      completionTokens: 3,
      totalTokens: 12,
    });
    const controller = new AbortController();

    await callAI({
      provider: 'anthropic',
      model: 'claude-opus-4-8',
      system: 'Write clearly.',
      messages: [{ role: 'user', content: 'Draft this.' }],
      feature: 'unit-test-anthropic-options',
      maxRetries: 2,
      timeoutMs: 45_000,
      signal: controller.signal,
    });

    expect(mocks.callAnthropic).toHaveBeenCalledWith(expect.objectContaining({
      maxRetries: 2,
      timeoutMs: 45_000,
      signal: controller.signal,
      cachePolicy: { mode: 'none' },
    }));
  });

  it('hydrates defaults from the AI operation registry', async () => {
    mocks.callOpenAI.mockResolvedValue({
      text: '{"ok":true}',
      promptTokens: 8,
      completionTokens: 2,
      totalTokens: 10,
    });

    await callAI({
      operation: 'schema-plan',
      messages: [{ role: 'user', content: 'classify these pages' }],
      workspaceId: 'ws_registry_test',
    });

    expect(mocks.callOpenAI).toHaveBeenCalledWith(expect.objectContaining({
      model: 'gpt-5.6-luna',
      feature: 'schema-plan',
      maxRetries: 3,
      timeoutMs: 90_000,
      responseFormat: { type: 'json_object' },
      cachePolicy: { mode: 'ttl', ttlMs: 300_000 },
      runId: expect.any(String),
      operation: 'schema-plan',
    }));
  });

  it('preserves the result shape and adds safe execution metadata', async () => {
    mocks.callAnthropic.mockResolvedValue({
      text: 'ok', promptTokens: 9, completionTokens: 3, totalTokens: 12,
      execution: { attempts: 1, cacheOutcome: 'miss' },
    });

    const result = await callAI({
      operation: 'copy-generation',
      messages: [{ role: 'user', content: 'Draft.' }],
      workspaceId: 'ws_metadata',
    });

    expect(result).toMatchObject({
      text: 'ok',
      tokens: { prompt: 9, completion: 3, total: 12 },
      execution: {
        runId: expect.any(String),
        operation: 'copy-generation',
        provider: 'anthropic',
        model: 'claude-opus-4-8',
        attempts: 1,
        cacheOutcome: 'miss',
        startedAt: expect.any(String),
        completedAt: expect.any(String),
        durationMs: expect.any(Number),
      },
    });
    expect(mocks.callAnthropic).toHaveBeenCalledWith(expect.objectContaining({
      cachePolicy: { mode: 'inflight' },
      runId: expect.any(String),
      operation: 'copy-generation',
    }));
    expect(result.execution).not.toHaveProperty('fallbackUsed');
  });

  it('links a cache consumer run to the provider run that produced the result', async () => {
    mocks.callOpenAI.mockResolvedValue({
      text: 'cached', promptTokens: 2, completionTokens: 1, totalTokens: 3,
      execution: { attempts: 1, cacheOutcome: 'hit', originRunId: 'origin-run' },
    });
    const result = await callAI({ operation: 'schema-plan', messages: [{ role: 'user', content: 'same' }] });
    expect(result.execution).toMatchObject({ cacheOutcome: 'hit', originRunId: 'origin-run' });
    expect(result.execution.runId).not.toBe('origin-run');
    expect(mocks.recordOperationTrace).toHaveBeenCalledWith(expect.objectContaining({
      runId: result.execution.runId, originRunId: 'origin-run', cacheOutcome: 'hit', provider: 'openai',
    }));
  });

  it('reports a proven fallback on execution metadata and provider options', async () => {
    mocks.callOpenAI.mockResolvedValue({ text: 'fallback', promptTokens: 2, completionTokens: 1, totalTokens: 3 });
    const result = await callAI({
      operation: 'copy-generation', messages: [{ role: 'user', content: 'draft' }],
      provider: 'openai',
      executionChainId: 'creative-chain', fallbackUsed: true,
    });
    expect(result.execution).toMatchObject({ executionChainId: 'creative-chain', fallbackUsed: true });
    expect(mocks.callOpenAI).toHaveBeenCalledWith(expect.objectContaining({ executionChainId: 'creative-chain', fallbackUsed: true }));
  });

  it('lets explicit options override registry defaults', async () => {
    mocks.callOpenAI.mockResolvedValue({
      text: '{"ok":true}',
      promptTokens: 8,
      completionTokens: 2,
      totalTokens: 10,
    });

    await callAI({
      operation: 'schema-plan',
      model: 'gpt-5.6-terra',
      maxRetries: 1,
      timeoutMs: 12_000,
      messages: [{ role: 'user', content: 'override defaults' }],
      feature: 'schema-plan-override',
      workspaceId: 'ws_registry_override',
    });

    expect(mocks.callOpenAI).toHaveBeenCalledWith(expect.objectContaining({
      model: 'gpt-5.6-terra',
      feature: 'schema-plan-override',
      operation: 'schema-plan',
      cachePolicy: { mode: 'ttl', ttlMs: 300_000 },
      maxRetries: 1,
      timeoutMs: 12_000,
    }));
  });

  it('throws when both feature and operation are omitted', async () => {
    await expect(callAI({
      messages: [{ role: 'user', content: 'missing metadata' }],
    })).rejects.toThrow('callAI requires either feature or operation');
  });

  it('defaults unregistered feature calls to inflight-only caching', async () => {
    mocks.callOpenAI.mockResolvedValue({ text: 'ok', promptTokens: 1, completionTokens: 1, totalTokens: 2 });
    await callAI({ feature: 'legacy-generation', messages: [{ role: 'user', content: 'Generate.' }] });
    expect(mocks.callOpenAI).toHaveBeenCalledWith(expect.objectContaining({
      operation: 'legacy-generation',
      cachePolicy: { mode: 'inflight' },
    }));
  });
});
