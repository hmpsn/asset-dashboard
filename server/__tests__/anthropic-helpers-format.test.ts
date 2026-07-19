import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Request-shape contract for the Anthropic helper's per-family param policy
 * (server/model-manifest.ts getAnthropicRequestPolicy, applied inside
 * executeAnthropicCall). This is the riskiest surface of the Opus 4.8
 * migration: reintroducing `temperature` on an Opus/Sonnet-5 request 400s
 * EVERY creative call in production, and dropping the explicit thinking
 * config silently turns thinking off (omitted = OFF on Opus 4.8).
 */
describe('callAnthropic request-body policy', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        content: [{ type: 'text', text: 'ok' }],
        usage: { input_tokens: 10, output_tokens: 5 },
      }),
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  async function lastRequestBody(): Promise<Record<string, unknown>> {
    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.at(-1);
    return JSON.parse(call?.[1].body);
  }

  it('claude-opus-4-8: strips temperature, injects adaptive thinking + high effort, adds thinking headroom', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key-for-format-test';
    const { callAnthropic } = await import('../anthropic-helpers.js'); // dynamic-import-ok — vitest isolation

    await callAnthropic({
      model: 'claude-opus-4-8',
      messages: [{ role: 'user', content: 'opus body shape' }],
      maxTokens: 2000,
      temperature: 0.7, // must NOT reach the wire — 400s on Opus 4.8
      feature: 'test-opus-body',
      maxRetries: 0,
    });

    const body = await lastRequestBody();
    expect(body.temperature).toBeUndefined();
    expect(body.top_p).toBeUndefined();
    expect(body.top_k).toBeUndefined();
    expect(body.thinking).toEqual({ type: 'adaptive' });
    expect(body.output_config).toEqual({ effort: 'high' });
    expect(body.max_tokens).toBe(2000 + 4096);
  });

  it('claude-sonnet-5: strips temperature, sends no thinking field (adaptive is the omitted-field default), adds headroom', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key-for-format-test';
    const { callAnthropic } = await import('../anthropic-helpers.js'); // dynamic-import-ok — vitest isolation

    await callAnthropic({
      model: 'claude-sonnet-5',
      messages: [{ role: 'user', content: 'sonnet body shape' }],
      maxTokens: 1000,
      temperature: 0.5,
      feature: 'test-sonnet5-body',
      maxRetries: 0,
    });

    const body = await lastRequestBody();
    expect(body.temperature).toBeUndefined();
    expect(body.thinking).toBeUndefined();
    expect(body.output_config).toBeUndefined();
    expect(body.max_tokens).toBe(1000 + 4096);
  });

  it('claude-haiku-4-5: keeps the classic surface — temperature default 0.7, no thinking, no headroom', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key-for-format-test';
    const { callAnthropic } = await import('../anthropic-helpers.js'); // dynamic-import-ok — vitest isolation

    await callAnthropic({
      model: 'claude-haiku-4-5',
      messages: [{ role: 'user', content: 'haiku body shape' }],
      maxTokens: 500,
      feature: 'test-haiku-body',
      maxRetries: 0,
    });

    const body = await lastRequestBody();
    expect(body.temperature).toBe(0.7);
    expect(body.thinking).toBeUndefined();
    expect(body.output_config).toBeUndefined();
    expect(body.max_tokens).toBe(500);
  });

  it('defaults to the manifest creative writer (Opus) when no model is passed', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key-for-format-test';
    const { callAnthropic } = await import('../anthropic-helpers.js'); // dynamic-import-ok — vitest isolation

    await callAnthropic({
      messages: [{ role: 'user', content: 'default model shape' }],
      feature: 'test-default-model',
      maxRetries: 0,
    });

    const body = await lastRequestBody();
    expect(body.model).toBe('claude-opus-4-8');
    expect(body.temperature).toBeUndefined();
    expect(body.thinking).toEqual({ type: 'adaptive' });
  });
});

describe('checkModelCurrency verdicts', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    process.env.ANTHROPIC_API_KEY = 'test-key-for-format-test';
    process.env.OPENAI_API_KEY = 'test-key-for-format-test';
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('classifies 404 as retired (the fail-the-run verdict)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404, text: () => Promise.resolve('not found') });
    const { checkModelCurrency } = await import('../model-currency.js'); // dynamic-import-ok — vitest isolation

    const [result] = await checkModelCurrency({ models: [{ provider: 'anthropic', model: 'claude-retired-1' }] });
    expect(result.status).toBe('retired');
  });

  it('classifies auth rejection as inconclusive with the httpStatus preserved (armed mode fails on 401/403)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 401, text: () => Promise.resolve('bad key') });
    const { checkModelCurrency } = await import('../model-currency.js'); // dynamic-import-ok — vitest isolation

    const [result] = await checkModelCurrency({ models: [{ provider: 'openai', model: 'gpt-5.6-terra' }] });
    expect(result.status).toBe('inconclusive');
    expect(result.httpStatus).toBe(401);
  });

  it('surfaces deprecation metadata as a deprecated warning', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ id: 'claude-old', deprecation_date: '2026-12-01' }),
    });
    const { checkModelCurrency } = await import('../model-currency.js'); // dynamic-import-ok — vitest isolation

    const [result] = await checkModelCurrency({ models: [{ provider: 'anthropic', model: 'claude-old' }] });
    expect(result.status).toBe('deprecated');
    expect(result.detail).toContain('deprecation_date');
  });

  it('classifies a resolving model with no deprecation metadata as ok', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ id: 'claude-opus-4-8', display_name: 'Claude Opus 4.8' }),
    });
    const { checkModelCurrency } = await import('../model-currency.js'); // dynamic-import-ok — vitest isolation

    const [result] = await checkModelCurrency({ models: [{ provider: 'anthropic', model: 'claude-opus-4-8' }] });
    expect(result.status).toBe('ok');
  });

  it('classifies network failure as inconclusive, never a crash', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('network down'));
    const { checkModelCurrency } = await import('../model-currency.js'); // dynamic-import-ok — vitest isolation

    const [result] = await checkModelCurrency({ models: [{ provider: 'openai', model: 'gpt-5.6-luna' }] });
    expect(result.status).toBe('inconclusive');
    expect(result.detail).toContain('network down');
  });
});
