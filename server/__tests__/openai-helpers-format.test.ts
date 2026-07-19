import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// We test that the request body includes response_format when provided.
// This requires intercepting the fetch call.
describe('callOpenAI response_format', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { content: '{"test": true}' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('includes response_format in request body when provided', async () => {
    process.env.OPENAI_API_KEY = 'test-key-for-format-test';

    const { callOpenAI } = await import('../openai-helpers.js'); // dynamic-import-ok — vitest isolation: fetch mock must be in place before module resolves

    try {
      await callOpenAI({
        messages: [{ role: 'user', content: 'test' }],
        feature: 'test-format',
        responseFormat: { type: 'json_object' },
        maxRetries: 0,
      });
    } catch { // catch-ok — test intentionally ignores mock-fetch errors
      // Expected — mock fetch may not return perfect shape
    }

    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0);
    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(call[1].body);
    expect(body.response_format).toEqual({ type: 'json_object' });
  });

  it('omits response_format from request body when not provided', async () => {
    process.env.OPENAI_API_KEY = 'test-key-for-format-test';
    const { callOpenAI } = await import('../openai-helpers.js'); // dynamic-import-ok — vitest isolation

    try {
      await callOpenAI({
        messages: [{ role: 'user', content: 'test' }],
        feature: 'test-no-format',
        maxRetries: 0,
      });
    } catch { // catch-ok — test intentionally ignores mock-fetch errors
      // Expected — mock fetch may not return perfect shape
    }

    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0);
    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(call[1].body);
    expect(body.response_format).toBeUndefined();
  });

  it('uses max_completion_tokens for GPT-5 chat models', async () => {
    process.env.OPENAI_API_KEY = 'test-key-for-format-test';
    const { callOpenAI } = await import('../openai-helpers.js'); // dynamic-import-ok — vitest isolation

    await callOpenAI({
      model: 'gpt-5.6-terra',
      messages: [{ role: 'user', content: 'test' }],
      feature: 'test-gpt5-token-limit',
      maxTokens: 321,
      maxRetries: 0,
    });

    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.at(-1);
    const body = JSON.parse(call?.[1].body);
    expect(body.max_completion_tokens).toBe(321);
    expect(body.max_tokens).toBeUndefined();
  });

  it('omits custom temperature for gpt-5.6-sol (default-temperature-only family)', async () => {
    process.env.OPENAI_API_KEY = 'test-key-for-format-test';
    const { callOpenAI } = await import('../openai-helpers.js'); // dynamic-import-ok — vitest isolation

    await callOpenAI({
      model: 'gpt-5.6-sol',
      messages: [{ role: 'user', content: 'test' }],
      feature: 'test-gpt5-temperature',
      temperature: 0.7,
      maxRetries: 0,
    });

    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.at(-1);
    const body = JSON.parse(call?.[1].body);
    expect(body.temperature).toBeUndefined();
  });

  it('keeps custom temperature for gpt-5.6-terra (gpt-5.4 lineage)', async () => {
    process.env.OPENAI_API_KEY = 'test-key-for-format-test';
    const { callOpenAI } = await import('../openai-helpers.js'); // dynamic-import-ok — vitest isolation

    await callOpenAI({
      model: 'gpt-5.6-terra',
      messages: [{ role: 'user', content: 'test' }],
      feature: 'test-gpt54-temperature',
      temperature: 0.25,
      maxRetries: 0,
    });

    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.at(-1);
    const body = JSON.parse(call?.[1].body);
    expect(body.temperature).toBe(0.25);
  });

});
