import { afterEach, describe, expect, it, vi } from 'vitest';

import { countInternalLinks, probeCanonical } from '../../server/diagnostic-probe.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('probeCanonical', () => {
  it('extracts canonical across attribute-order variants and ignores query params for self-reference', async () => {
    globalThis.fetch = vi.fn(async () => ({
      status: 200,
      text: async () => '<html><head><link href="https://example.com/page/" rel="canonical" /></head></html>',
    })) as typeof fetch;

    const result = await probeCanonical('https://example.com/page?utm_source=test');

    expect(result).toEqual({
      canonical: 'https://example.com/page/',
      selfReferencing: true,
      statusCode: 200,
      error: null,
    });
  });

  it('returns null canonical when canonical tag is absent', async () => {
    globalThis.fetch = vi.fn(async () => ({
      status: 204,
      text: async () => '<html><head><title>No canonical</title></head><body>ok</body></html>',
    })) as typeof fetch;

    const result = await probeCanonical('https://example.com/no-canonical');

    expect(result).toEqual({
      canonical: null,
      selfReferencing: false,
      statusCode: 204,
      error: null,
    });
  });

  it('marks selfReferencing false when canonical differs by path', async () => {
    globalThis.fetch = vi.fn(async () => ({
      status: 200,
      text: async () => '<html><head><link rel="canonical" href="https://example.com/new-path" /></head></html>',
    })) as typeof fetch;

    const result = await probeCanonical('https://example.com/old-path');

    expect(result).toEqual({
      canonical: 'https://example.com/new-path',
      selfReferencing: false,
      statusCode: 200,
      error: null,
    });
  });

  it('returns failure shape when fetch throws', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('network down');
    }) as typeof fetch;

    const result = await probeCanonical('https://example.com/fail');

    expect(result).toEqual({
      canonical: null,
      selfReferencing: false,
      statusCode: 0,
      error: 'network down',
    });
  });
});

describe('countInternalLinks', () => {
  it('counts linking pages, computes siteMedian/deficit, and ignores failed page fetches', async () => {
    const pagesToCrawl = [
      'https://example.com/source-1',
      'https://example.com/source-2',
      'https://example.com/source-3',
      'https://example.com/source-4',
    ];

    globalThis.fetch = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input.toString();

      if (url.endsWith('/source-1')) {
        return {
          status: 200,
          text: async () => '<a href="/target">Target</a><a href="/other-a">Other A</a>',
        };
      }

      if (url.endsWith('/source-2')) {
        return {
          status: 200,
          text: async () => '<a href="/other-a">Other A</a><a href="/other-b">Other B</a>',
        };
      }

      if (url.endsWith('/source-3')) {
        return {
          status: 200,
          text: async () => '<a href="https://example.com/other-a">Other A</a><a href="/other-b?from=nav">Other B</a>',
        };
      }

      if (url.endsWith('/source-4')) {
        throw new Error('fetch failed for source-4');
      }

      throw new Error(`Unexpected URL: ${url}`);
    }) as typeof fetch;

    const result = await countInternalLinks('/target', pagesToCrawl, 'https://example.com');

    expect(result.count).toBe(1);
    expect(result.siteMedian).toBe(2);
    expect(result.deficit).toBe(1);
    expect(result.topLinkingPages).toEqual(['https://example.com/source-1']);
    expect(globalThis.fetch).toHaveBeenCalledTimes(4);
  });

  it('does not treat lookalike external domains as internal links (regression)', async () => {
    const pagesToCrawl = ['https://example.com/source'];

    globalThis.fetch = vi.fn(async () => ({
      status: 200,
      text: async () => [
        '<a href="https://example.com.evil.org/target">spoof</a>',
        '<a href="https://example.com/target">real-internal</a>',
        '<a href="/also-internal">relative</a>',
      ].join(''),
    })) as typeof fetch;

    const result = await countInternalLinks('/target', pagesToCrawl, 'https://example.com');

    expect(result.count).toBe(1);
    expect(result.topLinkingPages).toEqual(['https://example.com/source']);
    expect(result.siteMedian).toBe(1);
    expect(result.deficit).toBe(0);
  });

  it('ignores malformed absolute href values instead of dropping the whole page', async () => {
    const pagesToCrawl = ['https://example.com/source'];

    globalThis.fetch = vi.fn(async () => ({
      status: 200,
      text: async () => [
        '<a href="https://example.com:bad-port/target">broken</a>',
        '<a href="/target">valid</a>',
      ].join(''),
    })) as typeof fetch;

    const result = await countInternalLinks('/target', pagesToCrawl, 'https://example.com');

    expect(result.count).toBe(1);
    expect(result.topLinkingPages).toEqual(['https://example.com/source']);
    expect(result.siteMedian).toBe(1);
  });

  it('respects MAX_PAGES_TO_CRAWL by fetching only the first 20 pages', async () => {
    const pagesToCrawl = Array.from({ length: 25 }, (_, i) => `https://example.com/p-${i}`);
    const fetchMock = vi.fn(async () => ({
      status: 200,
      text: async () => '<html><body><a href="/unrelated">Unrelated</a></body></html>',
    }));
    globalThis.fetch = fetchMock as typeof fetch;

    await countInternalLinks('/target', pagesToCrawl, 'https://example.com');

    expect(fetchMock).toHaveBeenCalledTimes(20);
    const calledUrls = fetchMock.mock.calls.map(([input]) =>
      typeof input === 'string' ? input : input.toString(),
    );
    expect(calledUrls).toEqual(pagesToCrawl.slice(0, 20));
    expect(calledUrls).not.toContain('https://example.com/p-20');
    expect(calledUrls).not.toContain('https://example.com/p-24');
  });
});
