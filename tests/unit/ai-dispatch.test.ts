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
      model: 'gpt-4.1-mini',
      messages: [{ role: 'user', content: 'Return JSON.' }],
      feature: 'unit-test',
      responseFormat: { type: 'json_object' },
    });

    expect(mocks.callOpenAI).toHaveBeenCalledWith(expect.objectContaining({
      responseFormat: { type: 'json_object' },
      messages: [{ role: 'user', content: 'Return JSON.' }],
    }));
  });
});
