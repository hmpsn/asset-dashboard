/**
 * Silent-drop observability (2026-07-20 P0 follow-up).
 *
 * Dropping a caller's sampling parameter without a word is what allowed ~50
 * dead `temperature:` arguments to accumulate across the codebase — each one
 * asserting a behavior that never occurred — and it is why the mismatch stayed
 * invisible until a model began rejecting the parameter outright with a 400.
 *
 * The helpers now warn when policy drops a caller-supplied param. These tests
 * pin that, so the drop can never quietly become silent again.
 *
 * Lives in its own file because the assertion requires the logger module to be
 * mocked at hoist time — `createLogger` is called at module scope in both
 * helpers, so a per-test spy would race module initialization.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const warn = vi.fn();

vi.mock('../logger.js', () => ({
  createLogger: () => ({ info: vi.fn(), warn, error: vi.fn(), debug: vi.fn() }),
}));

describe('sampling-param drop is observable', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    warn.mockClear();
    originalFetch = globalThis.fetch;
    process.env.OPENAI_API_KEY = 'test-key-for-drop-warning';
    process.env.ANTHROPIC_API_KEY = 'test-key-for-drop-warning';
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('warns when OpenAI drops a caller-supplied temperature', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { content: 'ok' } }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
    });
    const { callOpenAI } = await import('../openai-helpers.js'); // dynamic-import-ok — resolves after the hoisted logger mock

    await callOpenAI({
      model: 'gpt-5.6-terra',
      messages: [{ role: 'user', content: 'test' }],
      feature: 'test-openai-drop',
      temperature: 0.5,
      maxRetries: 0,
    });

    const dropWarning = warn.mock.calls.find(
      ([, message]) => typeof message === 'string' && /temperature ignored/i.test(message),
    );
    expect(dropWarning, 'expected a warning naming the ignored temperature').toBeDefined();
    const [meta] = dropWarning as [Record<string, unknown>, string];
    expect(meta.model).toBe('gpt-5.6-terra');
    expect(meta.requestedTemperature).toBe(0.5);
  });

  it('does not warn when the OpenAI caller supplied no temperature', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { content: 'ok' } }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
    });
    const { callOpenAI } = await import('../openai-helpers.js'); // dynamic-import-ok — resolves after the hoisted logger mock

    await callOpenAI({
      model: 'gpt-5.6-terra',
      messages: [{ role: 'user', content: 'test' }],
      feature: 'test-openai-no-drop',
      maxRetries: 0,
    });

    expect(
      warn.mock.calls.some(([, m]) => typeof m === 'string' && /temperature ignored/i.test(m)),
    ).toBe(false);
  });

  it('warns when Anthropic drops a caller-supplied temperature (Opus rejects sampling params)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        content: [{ type: 'text', text: 'ok' }],
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    });
    const { callAnthropic } = await import('../anthropic-helpers.js'); // dynamic-import-ok — resolves after the hoisted logger mock

    await callAnthropic({
      model: 'claude-opus-4-8',
      messages: [{ role: 'user', content: 'test' }],
      feature: 'test-anthropic-drop',
      temperature: 0.7,
      maxRetries: 0,
    });

    const dropWarning = warn.mock.calls.find(
      ([, message]) => typeof message === 'string' && /temperature ignored/i.test(message),
    );
    expect(dropWarning, 'expected a warning naming the ignored temperature').toBeDefined();
    const [meta] = dropWarning as [Record<string, unknown>, string];
    expect(meta.model).toBe('claude-opus-4-8');
  });

  it('does not warn on Haiku, which genuinely honors temperature', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        content: [{ type: 'text', text: 'ok' }],
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    });
    const { callAnthropic } = await import('../anthropic-helpers.js'); // dynamic-import-ok — resolves after the hoisted logger mock

    await callAnthropic({
      model: 'claude-haiku-4-5',
      messages: [{ role: 'user', content: 'test' }],
      feature: 'test-haiku-honored',
      temperature: 0.7,
      maxRetries: 0,
    });

    expect(
      warn.mock.calls.some(([, m]) => typeof m === 'string' && /temperature ignored/i.test(m)),
    ).toBe(false);
  });
});
