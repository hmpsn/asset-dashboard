import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GoogleProviderError,
  googleJson,
  isGoogleProviderError,
} from '../../server/google-provider-client.js';

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('googleJson', () => {
  it('sends bearer auth and JSON bodies for provider reads/writes', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await googleJson<{ ok: boolean }>({
      endpoint: 'https://example.test/google',
      source: 'ga4',
      token: 'test-token',
      body: { propertyId: '123' },
    });

    expect(result).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://example.test/google');
    expect(init.method).toBe('POST');
    const headers = new Headers(init.headers);
    expect(headers.get('Authorization')).toBe('Bearer test-token');
    expect(headers.get('Content-Type')).toBe('application/json');
    expect(init.body).toBe(JSON.stringify({ propertyId: '123' }));
  });

  it('preserves URLSearchParams form bodies for OAuth exchanges', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ access_token: 'x' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: 'refresh-me',
    });

    await googleJson<{ access_token: string }>({
      endpoint: 'https://oauth2.googleapis.com/token',
      source: 'google-oauth',
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.body).toBe(body);
    expect(new Headers(init.headers).get('Content-Type')).toBe('application/x-www-form-urlencoded');
  });

  it.each([
    { status: 401, retryable: false },
    { status: 403, retryable: false },
    { status: 429, retryable: true },
    { status: 500, retryable: true },
  ])('classifies HTTP status $status correctly', async ({ status, retryable }) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(`provider-${status}`, {
      status,
      headers: { 'Content-Type': 'text/plain' },
    })));

    try {
      await googleJson({
        endpoint: 'https://www.googleapis.com/webmasters/v3/sites',
        source: 'gsc',
        token: 'test-token',
      });
      throw new Error('Expected googleJson() to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(GoogleProviderError);
      expect(isGoogleProviderError(error)).toBe(true);
      if (!isGoogleProviderError(error)) return;
      expect(error.kind).toBe('http');
      expect(error.status).toBe(status);
      expect(error.body).toBe(`provider-${status}`);
      expect(error.retryable).toBe(retryable);
    }
  });

  it('wraps network failures with the original cause', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('socket hang up');
    }));

    try {
      await googleJson({
        endpoint: 'https://analyticsdata.googleapis.com/v1beta/properties/123:runReport',
        source: 'ga4',
        token: 'test-token',
      });
      throw new Error('Expected googleJson() to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(GoogleProviderError);
      if (!isGoogleProviderError(error)) return;
      expect(error.kind).toBe('network');
      expect(error.retryable).toBe(true);
      expect(error.cause).toBeInstanceOf(TypeError);
    }
  });

  it('wraps abort failures as timeout errors', async () => {
    const abortError = new Error('aborted');
    abortError.name = 'AbortError';
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw abortError;
    }));

    try {
      await googleJson({
        endpoint: 'https://searchconsole.googleapis.com/v1/urlInspection/index:inspect',
        source: 'gsc',
        token: 'test-token',
      });
      throw new Error('Expected googleJson() to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(GoogleProviderError);
      if (!isGoogleProviderError(error)) return;
      expect(error.kind).toBe('timeout');
      expect(error.retryable).toBe(true);
      expect(error.cause).toBe(abortError);
    }
  });

  it('classifies invalid JSON separately from HTTP transport errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not-json', {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })));

    try {
      await googleJson({
        endpoint: 'https://example.test/not-json',
        source: 'ga4',
      });
      throw new Error('Expected googleJson() to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(GoogleProviderError);
      if (!isGoogleProviderError(error)) return;
      expect(error.kind).toBe('invalid-json');
      expect(error.retryable).toBe(false);
    }
  });
});
