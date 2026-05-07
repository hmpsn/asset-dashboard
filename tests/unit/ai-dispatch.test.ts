import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  callOpenAI: vi.fn(),
  callAnthropic: vi.fn(),
}));

vi.mock('../../server/openai-helpers.js', () => ({
  callOpenAI: mocks.callOpenAI,
}));

vi.mock('../../server/anthropic-helpers.js', () => ({
  callAnthropic: mocks.callAnthropic,
}));

import { callAI } from '../../server/ai.js';

describe('callAI', () => {
  beforeEach(() => {
    mocks.callOpenAI.mockReset();
    mocks.callAnthropic.mockReset();
  });

  it('passes OpenAI JSON response format through the dispatcher', async () => {
    mocks.callOpenAI.mockResolvedValue({
      text: '{"ok":true}',
      promptTokens: 10,
      completionTokens: 4,
      totalTokens: 14,
    });

    await callAI({
      model: 'gpt-5.4-mini',
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
      model: 'gpt-5.4-mini',
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
      model: 'gpt-5.4-mini',
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
      model: 'claude-sonnet-4-6',
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
    }));
  });
});
