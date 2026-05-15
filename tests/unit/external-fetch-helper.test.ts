import { afterEach, describe, expect, it, vi } from 'vitest';

import { STUDIO_BOT_UA } from '../../server/constants.js';
import {
  ExternalFetchError,
  fetchExternal,
  fetchExternalText,
  isExternalFetchError,
  normalizeExternalUrl,
} from '../../server/external-fetch.js';

describe('external fetch helper', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('normalizes external URLs and strips hash fragments', () => {
    const normalized = normalizeExternalUrl('  https://example.com/docs/page?a=1#section  ');
    expect(normalized).toBe('https://example.com/docs/page?a=1');
  });

  it('rejects invalid or unsupported URLs', () => {
    expect(() => normalizeExternalUrl('not a url')).toThrow(ExternalFetchError);
    expect(() => normalizeExternalUrl('ftp://example.com/file')).toThrow(ExternalFetchError);
  });

  it('applies default headers and user-agent on outbound fetches', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('<html></html>', { status: 200, headers: { 'Content-Type': 'text/html' } }),
    );

    await fetchExternalText({
      url: 'https://example.com/sitemap.xml',
      defaultHeaders: { Accept: 'application/xml' },
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, init] = fetchSpy.mock.calls[0];
    const headers = new Headers((init?.headers ?? {}) as HeadersInit);
    expect(headers.get('Accept')).toBe('application/xml');
    expect(headers.get('User-Agent')).toBe(STUDIO_BOT_UA);
  });

  it('classifies timeout-like failures as timeout', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new DOMException('Aborted', 'AbortError'));

    await expect(fetchExternal({ url: 'https://example.com', timeoutMs: 10 })).rejects.toMatchObject({
      kind: 'timeout',
      url: 'https://example.com/',
    });
  });

  it('classifies network failures as network', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('getaddrinfo ENOTFOUND example.com'));

    await expect(fetchExternal({ url: 'https://example.com' })).rejects.toMatchObject({
      kind: 'network',
      url: 'https://example.com/',
    });
  });

  it('classifies non-2xx responses as http and preserves status/snippet', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('upstream unavailable', { status: 503, statusText: 'Service Unavailable' }),
    );

    await expect(fetchExternal({ url: 'https://example.com/unhealthy' })).rejects.toMatchObject({
      kind: 'http',
      status: 503,
      statusText: 'Service Unavailable',
      responseBodySnippet: 'upstream unavailable',
      url: 'https://example.com/unhealthy',
    });
  });

  it('provides a reliable type guard for helper errors', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('socket hang up'));
    try {
      await fetchExternal({ url: 'https://example.com' });
    } catch (err) {
      expect(isExternalFetchError(err)).toBe(true);
      if (isExternalFetchError(err)) expect(err.kind).toBe('network');
    }
  });
});
