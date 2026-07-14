import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  lookup: vi.fn(),
  fetchMock: vi.fn(),
}));

vi.stubGlobal('fetch', mocks.fetchMock);

vi.mock('node:dns/promises', () => ({
  lookup: mocks.lookup,
}));

import {
  ExternalFetchError,
  fetchExternal,
  fetchPublicWebText,
  fetchPublicWebTextBounded,
  normalizeExternalUrl,
} from '../../server/external-fetch.js';

describe('external-fetch failure-path behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('rejects urls with embedded credentials', () => {
    expect(() => normalizeExternalUrl('https://user:pass@example.com/secret')).toThrow(ExternalFetchError);
    expect(() => normalizeExternalUrl('https://user:pass@example.com/secret')).toThrow('must not include embedded credentials');
  });

  it('rejects unsupported URL protocols', () => {
    expect(() => normalizeExternalUrl('ftp://example.com/file.txt')).toThrow(ExternalFetchError);
    expect(() => normalizeExternalUrl('ftp://example.com/file.txt')).toThrow('Unsupported URL protocol');
  });

  it('classifies timeout-like message failures as timeout', async () => {
    mocks.fetchMock.mockRejectedValueOnce(new Error('request timed out after 1000ms'));

    await expect(fetchExternal({ url: 'https://example.com/resource' })).rejects.toMatchObject({
      kind: 'timeout',
      url: 'https://example.com/resource',
    });
  });

  it('classifies AbortError by name as timeout', async () => {
    const err = new Error('aborted by signal');
    (err as Error & { name: string }).name = 'AbortError';
    mocks.fetchMock.mockRejectedValueOnce(err);

    await expect(fetchExternal({ url: 'https://example.com/abort' })).rejects.toMatchObject({
      kind: 'timeout',
    });
  });

  it('blocks DNS failures before network fetch in public-web mode', async () => {
    mocks.lookup.mockRejectedValueOnce(new Error('ENOTFOUND example.com'));

    await expect(fetchPublicWebText({ url: 'https://example.com' })).rejects.toMatchObject({
      kind: 'network',
      message: expect.stringContaining('DNS lookup failed'),
    });

    expect(mocks.fetchMock).not.toHaveBeenCalled();
  });

  it('blocks DNS rebinding to private addresses in public-web mode', async () => {
    mocks.lookup.mockResolvedValueOnce([{ address: '10.0.0.2', family: 4 }]);

    await expect(fetchPublicWebText({ url: 'https://rebind.example/path' })).rejects.toMatchObject({
      kind: 'unsafe_url',
      message: expect.stringContaining('Unsafe resolved address'),
    });

    expect(mocks.fetchMock).not.toHaveBeenCalled();
  });

  it('blocks mixed DNS answers when any resolved address is private', async () => {
    mocks.lookup.mockResolvedValueOnce([
      { address: '93.184.216.34', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ]);

    await expect(fetchPublicWebText({ url: 'https://mixed.example/path' })).rejects.toMatchObject({
      kind: 'unsafe_url',
      message: expect.stringContaining('127.0.0.1'),
    });
    expect(mocks.fetchMock).not.toHaveBeenCalled();
  });

  it('errors when redirect response omits location header', async () => {
    mocks.fetchMock.mockResolvedValueOnce(new Response(null, { status: 302 }));

    await expect(fetchPublicWebText({ url: 'https://example.com/start' })).rejects.toMatchObject({
      kind: 'http',
      status: 302,
      message: expect.stringContaining('missing redirect location'),
    });
  });

  it('halts redirect loops after max hops', async () => {
    mocks.fetchMock.mockImplementation(async (_url: string) => new Response(null, {
      status: 302,
      headers: { location: 'https://example.com/loop' },
    }));

    await expect(fetchPublicWebText({ url: 'https://example.com/loop' })).rejects.toMatchObject({
      kind: 'http',
      message: expect.stringContaining('Too many redirects'),
    });

    expect(mocks.fetchMock).toHaveBeenCalledTimes(6);
  });

  it('preserves explicit headers over default headers', async () => {
    mocks.fetchMock.mockResolvedValueOnce(new Response('ok', { status: 200 }));

    await fetchExternal({
      url: 'https://example.com/headers',
      headers: { Accept: 'application/custom' },
      defaultHeaders: { Accept: 'application/json', 'X-Default': 'yes' },
    });

    const [, init] = mocks.fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = new Headers((init?.headers ?? {}) as HeadersInit);
    expect(headers.get('Accept')).toBe('application/custom');
    expect(headers.get('X-Default')).toBe('yes');
  });

  it('returns bounded response snippet for http errors', async () => {
    const longBody = 'x'.repeat(500);
    mocks.fetchMock.mockResolvedValueOnce(new Response(longBody, {
      status: 502,
      statusText: 'Bad Gateway',
    }));

    await expect(fetchExternal({ url: 'https://example.com/downstream' })).rejects.toMatchObject({
      kind: 'http',
      status: 502,
      statusText: 'Bad Gateway',
      responseBodySnippet: 'x'.repeat(300),
    });
  });

  it('times out and cancels a bounded response body that stalls after headers', async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('<urlset>'));
      },
      pull: () => new Promise<void>(() => {}),
      cancel,
    });
    mocks.fetchMock.mockResolvedValueOnce(new Response(stream, { status: 200 }));

    await expect(fetchPublicWebTextBounded({
      url: 'https://example.com/stalled-sitemap.xml',
      timeoutMs: 20,
    }, 1_024)).rejects.toMatchObject({
      kind: 'timeout',
      url: 'https://example.com/stalled-sitemap.xml',
    });
    expect(cancel).toHaveBeenCalledOnce();
  });
});
