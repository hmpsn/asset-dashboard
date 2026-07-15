/**
 * Unit tests for server/anthropic-helpers.ts — pure helpers, API configuration check,
 * local fake provider mode, and response-parsing behaviour via mocked fetch.
 *
 * No real HTTP calls happen — fetch is mocked globally.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Hoist mocks ──────────────────────────────────────────────────────────────
const mocks = vi.hoisted(() => ({
  logTokenUsage: vi.fn(),
  createLogger: vi.fn(() => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() })),
  abortableDelay: vi.fn(),
  composeTimeoutSignal: vi.fn(() => undefined),
  throwIfSignalAborted: vi.fn(),
  isLocalFakeProviderModeEnabled: vi.fn(() => false),
  fetch: vi.fn(),
  recordOperationTrace: vi.fn(),
}));

vi.mock('../../server/openai-helpers.js', () => ({ logTokenUsage: mocks.logTokenUsage }));
vi.mock('../../server/logger.js', () => ({ createLogger: mocks.createLogger }));
vi.mock('../../server/abort-helpers.js', () => ({
  abortableDelay: mocks.abortableDelay,
  composeTimeoutSignal: mocks.composeTimeoutSignal,
  throwIfSignalAborted: mocks.throwIfSignalAborted,
}));
vi.mock('../../server/local-provider-mode.js', () => ({
  isLocalFakeProviderModeEnabled: mocks.isLocalFakeProviderModeEnabled,
}));
vi.mock('../../server/platform-observability.js', () => ({
  recordOperationTrace: mocks.recordOperationTrace,
}));

// Stub global fetch
vi.stubGlobal('fetch', mocks.fetch);

import {
  isAnthropicConfigured,
  callAnthropic,
  callAnthropicWithTools,
  type AnthropicToolDefinition,
} from '../../server/anthropic-helpers.js';

// ── isAnthropicConfigured ───────────────────────────────────────────────────

describe('isAnthropicConfigured', () => {
  it('returns false when ANTHROPIC_API_KEY is not set', () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect(isAnthropicConfigured()).toBe(false);
  });

  it('returns true when ANTHROPIC_API_KEY is set', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test-key';
    expect(isAnthropicConfigured()).toBe(true);
    delete process.env.ANTHROPIC_API_KEY;
  });

  it('returns false for empty string key', () => {
    process.env.ANTHROPIC_API_KEY = '';
    expect(isAnthropicConfigured()).toBe(false);
    delete process.env.ANTHROPIC_API_KEY;
  });
});

// ── callAnthropic — local fake provider mode ─────────────────────────────────

describe('callAnthropic (local fake provider mode)', () => {
  beforeEach(() => {
    mocks.recordOperationTrace.mockClear();
    mocks.isLocalFakeProviderModeEnabled.mockReturnValue(true);
    mocks.logTokenUsage.mockReset();
    delete process.env.ANTHROPIC_API_KEY;
  });

  it('records provider execution metadata for the synthetic path', async () => {
    await callAnthropic({ messages: [{ role: 'user', content: 'Hi' }], feature: 'test', runId: 'run-local', operation: 'op-local' });
    expect(mocks.recordOperationTrace).toHaveBeenCalledWith(expect.objectContaining({
      status: 'success', runId: 'run-local', operation: 'op-local', provider: 'anthropic', attempts: 1,
    }));
  });

  it('returns a synthetic text response without calling fetch', async () => {
    const result = await callAnthropic({
      messages: [{ role: 'user', content: 'Hello' }],
      feature: 'unit-test',
    });
    expect(result.text).toContain('local-fake-providers');
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('logs token usage even in fake mode', async () => {
    await callAnthropic({
      messages: [{ role: 'user', content: 'Write something' }],
      feature: 'content-post',
    });
    expect(mocks.logTokenUsage).toHaveBeenCalledOnce();
    const call = mocks.logTokenUsage.mock.calls[0][0] as { feature: string };
    expect(call.feature).toBe('content-post');
  });

  it('returns positive token counts in fake mode', async () => {
    const result = await callAnthropic({
      messages: [{ role: 'user', content: 'Test' }],
      feature: 'test',
    });
    expect(result.promptTokens).toBeGreaterThan(0);
    expect(result.completionTokens).toBeGreaterThan(0);
    expect(result.totalTokens).toBe(result.promptTokens + result.completionTokens);
  });
});

// ── callAnthropic — real fetch path ─────────────────────────────────────────

describe('callAnthropic (real fetch path)', () => {
  beforeEach(() => {
    mocks.recordOperationTrace.mockClear();
    mocks.isLocalFakeProviderModeEnabled.mockReturnValue(false);
    mocks.logTokenUsage.mockReset();
    mocks.fetch.mockReset();
    mocks.abortableDelay.mockReset();
    mocks.composeTimeoutSignal.mockReset();
    mocks.composeTimeoutSignal.mockReturnValue(undefined);
    mocks.throwIfSignalAborted.mockReset();
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
  });

  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
  });

  it('throws if ANTHROPIC_API_KEY is missing', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    await expect(
      callAnthropic({ messages: [{ role: 'user', content: 'Hi' }], feature: 'test' })
    ).rejects.toThrow('ANTHROPIC_API_KEY not configured');
    expect(mocks.recordOperationTrace).toHaveBeenCalledWith(expect.objectContaining({
      status: 'error', provider: 'anthropic', attempts: 0,
    }));
  });

  it('parses text content from Anthropic response shape', async () => {
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [{ type: 'text', text: 'Hello from Claude' }],
        usage: { input_tokens: 10, output_tokens: 5 },
      }),
    });

    const result = await callAnthropic({
      messages: [{ role: 'user', content: 'Hi' }],
      feature: 'test',
    });

    expect(result.text).toBe('Hello from Claude');
    expect(result.promptTokens).toBe(10);
    expect(result.completionTokens).toBe(5);
    expect(result.totalTokens).toBe(15);
  });

  it('returns empty text when content array has no text block', async () => {
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [{ type: 'tool_use', input: {} }],
        usage: { input_tokens: 8, output_tokens: 4 },
      }),
    });

    const result = await callAnthropic({
      messages: [{ role: 'user', content: 'Hi' }],
      feature: 'test',
    });
    expect(result.text).toBe('');
  });

  it('logs token usage after a successful response', async () => {
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [{ type: 'text', text: 'OK' }],
        usage: { input_tokens: 12, output_tokens: 3 },
      }),
    });

    await callAnthropic({
      messages: [{ role: 'user', content: 'Go' }],
      feature: 'content-section',
      workspaceId: 'ws-99',
    });

    expect(mocks.logTokenUsage).toHaveBeenCalledOnce();
    const logged = mocks.logTokenUsage.mock.calls[0][0] as {
      feature: string; workspaceId: string; promptTokens: number;
    };
    expect(logged.feature).toBe('content-section');
    expect(logged.workspaceId).toBe('ws-99');
    expect(logged.promptTokens).toBe(12);
  });

  it('throws a descriptive error on non-retryable HTTP error', async () => {
    mocks.fetch.mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => 'Bad request',
      headers: { get: () => null },
    });

    await expect(
      callAnthropic({
        messages: [{ role: 'user', content: 'Hi' }],
        feature: 'test',
        maxRetries: 0,
      })
    ).rejects.toThrow('Anthropic 400');
  });

  it('retries 429 responses using retry-after seconds before succeeding', async () => {
    mocks.fetch
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        text: async () => 'rate limited',
        headers: { get: (name: string) => name === 'retry-after' ? '4' : null },
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: [{ type: 'text', text: 'Recovered' }],
          usage: { input_tokens: 16, output_tokens: 7 },
        }),
      });

    const result = await callAnthropic({
      messages: [{ role: 'user', content: 'retry please' }],
      feature: 'anthropic-retry-test',
      maxRetries: 1,
    });

    expect(result.text).toBe('Recovered');
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(mocks.abortableDelay).toHaveBeenCalledWith(4500, undefined, 'AI request cancelled');
  });
});

// ── callAnthropicWithTools — local fake provider mode ──────────────────────

describe('callAnthropicWithTools (local fake provider mode)', () => {
  beforeEach(() => {
    mocks.isLocalFakeProviderModeEnabled.mockReturnValue(true);
    mocks.logTokenUsage.mockReset();
    mocks.fetch.mockReset();
    delete process.env.ANTHROPIC_API_KEY;
  });

  const sampleTool: AnthropicToolDefinition = {
    name: 'get_answer',
    description: 'Returns an answer',
    input_schema: {
      type: 'object',
      properties: { answer: { type: 'string' } },
      required: ['answer'],
    },
  };

  it('returns synthetic toolInput without calling fetch', async () => {
    const result = await callAnthropicWithTools({
      userMessage: 'Test',
      tools: [sampleTool],
      feature: 'test-tool',
    });
    expect(result.toolInput).toBeDefined();
    expect(result.toolInput.mode).toBe('local-fake-providers');
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('returns token counts in fake mode', async () => {
    const result = await callAnthropicWithTools({
      userMessage: 'Test',
      tools: [sampleTool],
      feature: 'test-tool',
    });
    expect(result.promptTokens).toBeGreaterThan(0);
    expect(result.completionTokens).toBeGreaterThan(0);
  });
});

// ── callAnthropicWithTools — real fetch path ────────────────────────────────

describe('callAnthropicWithTools (real fetch path)', () => {
  beforeEach(() => {
    mocks.isLocalFakeProviderModeEnabled.mockReturnValue(false);
    mocks.logTokenUsage.mockReset();
    mocks.fetch.mockReset();
    mocks.abortableDelay.mockReset();
    mocks.composeTimeoutSignal.mockReset();
    mocks.composeTimeoutSignal.mockReturnValue(undefined);
    mocks.throwIfSignalAborted.mockReset();
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
  });

  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
  });

  const sampleTool: AnthropicToolDefinition = {
    name: 'classify',
    description: 'Classify the input',
    input_schema: {
      type: 'object',
      properties: { label: { type: 'string' } },
      required: ['label'],
    },
  };

  it('throws if API key is missing', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    await expect(
      callAnthropicWithTools({ userMessage: 'Hi', tools: [sampleTool], feature: 'test' })
    ).rejects.toThrow('ANTHROPIC_API_KEY not configured');
  });

  it('parses tool_use block from response', async () => {
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [{ type: 'tool_use', input: { label: 'positive' } }],
        usage: { input_tokens: 20, output_tokens: 8 },
      }),
    });

    const result = await callAnthropicWithTools({
      userMessage: 'Classify this',
      tools: [sampleTool],
      feature: 'classify-test',
    });

    expect(result.toolInput).toEqual({ label: 'positive' });
    expect(result.promptTokens).toBe(20);
    expect(result.completionTokens).toBe(8);
  });

  it('does not cache repeated tool calls on the legacy cache-none path', async () => {
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ content: [{ type: 'tool_use', input: { label: 'positive' } }], usage: { input_tokens: 2, output_tokens: 1 } }),
    });
    const opts = { userMessage: 'same', tools: [sampleTool], feature: 'legacy-tools' };
    await callAnthropicWithTools(opts);
    await callAnthropicWithTools(opts);
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });

  it('throws when response contains no tool_use block', async () => {
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [{ type: 'text', text: 'I cannot use tools' }],
        usage: { input_tokens: 10, output_tokens: 5 },
      }),
    });

    await expect(
      callAnthropicWithTools({
        userMessage: 'Test',
        tools: [sampleTool],
        feature: 'test',
        maxRetries: 0,
      })
    ).rejects.toThrow('no tool_use block');
  });

  it('uses the shared retry path for tool_use requests, including caller cancellation signals', async () => {
    const controller = new AbortController();
    mocks.fetch
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        text: async () => 'rate limited',
        headers: { get: (name: string) => name === 'retry-after' ? '3' : null },
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: [{ type: 'tool_use', input: { label: 'recovered' } }],
          usage: { input_tokens: 11, output_tokens: 6 },
        }),
      });

    const result = await callAnthropicWithTools({
      userMessage: 'Retry with tools',
      tools: [sampleTool],
      feature: 'tool-retry-test',
      maxRetries: 1,
      timeoutMs: 42_000,
      signal: controller.signal,
    });

    expect(result.toolInput).toEqual({ label: 'recovered' });
    expect(mocks.composeTimeoutSignal).toHaveBeenCalledWith(42_000, controller.signal);
    expect(mocks.abortableDelay).toHaveBeenCalledWith(3500, controller.signal, 'AI request cancelled');
  });
});
