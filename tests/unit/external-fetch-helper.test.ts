import { afterEach, describe, expect, it, vi } from 'vitest';

const { mockLookup } = vi.hoisted(() => ({
  mockLookup: vi.fn(),
}));

vi.mock('node:dns/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:dns/promises')>();
  return {
    ...actual,
    lookup: mockLookup,
    default: {
      ...(actual as unknown as { default?: Record<string, unknown> }).default,
      lookup: mockLookup,
    },
  };
});

import { STUDIO_BOT_UA } from '../../server/constants.js';
import {
  ExternalFetchError,
  fetchExternalBytes,
  fetchExternal,
  fetchProviderText,
  fetchPublicWebText,
  fetchExternalText,
  isExternalFetchError,
  normalizeExternalUrl,
} from '../../server/external-fetch.js';

describe('external fetch helper', () => {
  function mockPublicDns(address = '93.184.216.34'): void {
    mockLookup.mockResolvedValue([{ address, family: 4 }]);
  }

  afterEach(() => {
    vi.restoreAllMocks();
    mockLookup.mockReset();
  });

  it('normalizes external URLs and strips hash fragments', () => {
    const normalized = normalizeExternalUrl('  https://example.com/docs/page?a=1#section  ');
    expect(normalized).toBe('https://example.com/docs/page?a=1');
  });

  it('rejects invalid or unsupported URLs', () => {
    expect(() => normalizeExternalUrl('not a url')).toThrow(ExternalFetchError);
    expect(() => normalizeExternalUrl('ftp://example.com/file')).toThrow(ExternalFetchError);
  });

  it('rejects unsafe hosts for public-web mode and allows them for provider mode', () => {
    expect(() => normalizeExternalUrl('http://localhost:8080/path', { safety: 'public-web' })).toThrow(ExternalFetchError);
    expect(normalizeExternalUrl('http://localhost:8080/path', { safety: 'allow-private' })).toBe('http://localhost:8080/path');
  });

  it('applies default headers and user-agent on outbound fetches', async () => {
    mockPublicDns();
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
    mockPublicDns();
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new DOMException('Aborted', 'AbortError'));

    await expect(fetchExternal({ url: 'https://example.com', timeoutMs: 10 })).rejects.toMatchObject({
      kind: 'timeout',
      url: 'https://example.com/',
    });
  });

  it('classifies network failures as network', async () => {
    mockPublicDns();
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('getaddrinfo ENOTFOUND example.com'));

    await expect(fetchExternal({ url: 'https://example.com' })).rejects.toMatchObject({
      kind: 'network',
      url: 'https://example.com/',
    });
  });

  it('classifies non-2xx responses as http and preserves status/snippet', async () => {
    mockPublicDns();
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
    mockPublicDns();
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('socket hang up'));
    try {
      await fetchExternal({ url: 'https://example.com' });
    } catch (err) {
      expect(isExternalFetchError(err)).toBe(true);
      if (isExternalFetchError(err)) expect(err.kind).toBe('network');
    }
  });

  it('returns byte payloads for binary fetches', async () => {
    mockPublicDns();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'Content-Type': 'application/octet-stream' } }),
    );

    const bytes = await fetchExternalBytes({ url: 'https://example.com/logo.png' });
    expect(Array.from(bytes)).toEqual([1, 2, 3]);
  });

  it('blocks localhost when using public web presets', async () => {
    await expect(fetchPublicWebText({ url: 'http://localhost:3000/private' })).rejects.toMatchObject({
      kind: 'unsafe_url',
    });
  });

  it('allows provider-mode requests to private hosts', async () => {
    mockPublicDns();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('ok', { status: 200, headers: { 'Content-Type': 'text/plain' } }),
    );

    const text = await fetchProviderText({ url: 'http://localhost:8080/health' });
    expect(text).toBe('ok');
  });

  it('blocks redirect chains that hop to private hosts in public-web mode', async () => {
    mockPublicDns();
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { Location: 'http://127.0.0.1/admin' } }),
    );

    await expect(fetchPublicWebText({ url: 'https://example.com/start' })).rejects.toMatchObject({
      kind: 'unsafe_url',
    });
  });

  it('blocks domain targets that resolve to private addresses in public-web mode', async () => {
    mockLookup.mockResolvedValue([{ address: '10.0.0.8', family: 4 }]);
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    await expect(fetchPublicWebText({ url: 'https://dns-rebind.example/test' })).rejects.toMatchObject({
      kind: 'unsafe_url',
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('blocks IPv6-mapped loopback hosts in hex form for public-web mode', async () => {
    await expect(fetchPublicWebText({ url: 'http://[::ffff:7f00:1]/admin' })).rejects.toMatchObject({
      kind: 'unsafe_url',
    });
  });
});
