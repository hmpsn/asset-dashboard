import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getValidToken: vi.fn(),
  loggerWarn: vi.fn(),
}));

vi.mock('../../server/google-auth.js', () => ({
  getValidToken: mocks.getValidToken,
}));

vi.mock('../../server/logger.js', () => ({
  createLogger: vi.fn(() => ({
    warn: mocks.loggerWarn,
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

describe('search-console behavior', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns null from inspectUrlForRichResults when OAuth token is unavailable', async () => {
    mocks.getValidToken.mockResolvedValue(null);
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const { inspectUrlForRichResults } = await import('../../server/search-console.js');
    const result = await inspectUrlForRichResults('site-1', 'https://example.com/a', 'sc-domain:example.com');

    expect(result).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('treats URL inspection 429 quota errors as soft-unavailable instead of throwing', async () => {
    mocks.getValidToken.mockResolvedValue('token');
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      text: vi.fn().mockResolvedValue('quota exceeded'),
    });
    vi.stubGlobal('fetch', fetchSpy);

    const { inspectUrlForRichResults } = await import('../../server/search-console.js');
    const result = await inspectUrlForRichResults('site-1', 'https://example.com/a', 'sc-domain:example.com');

    expect(result).toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('throws on URL inspection 5xx responses with status in message', async () => {
    mocks.getValidToken.mockResolvedValue('token');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: vi.fn().mockResolvedValue('upstream crashed hard'),
      }),
    );

    const { inspectUrlForRichResults } = await import('../../server/search-console.js');

    await expect(
      inspectUrlForRichResults('site-1', 'https://example.com/a', 'sc-domain:example.com'),
    ).rejects.toThrow('GSC URL Inspection error (500): upstream crashed hard');
  });

  it('throws on URL inspection auth/permission 4xx responses instead of suppressing as no_gsc', async () => {
    mocks.getValidToken.mockResolvedValue('token');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        text: vi.fn().mockResolvedValue('forbidden'),
      }),
    );

    const { inspectUrlForRichResults } = await import('../../server/search-console.js');

    await expect(
      inspectUrlForRichResults('site-1', 'https://example.com/a', 'sc-domain:example.com'),
    ).rejects.toThrow('GSC URL Inspection authentication error (403): forbidden');
  });

  it('builds previous-period dates from custom dateRange length when custom range is supplied', async () => {
    mocks.getValidToken.mockResolvedValue('token');

    const requestBodies: Array<Record<string, unknown>> = [];
    const fetchSpy = vi.fn().mockImplementation(async (_url: string, opts?: RequestInit) => {
      const body = JSON.parse(String(opts?.body ?? '{}')) as Record<string, unknown>;
      requestBodies.push(body);
      return {
        ok: true,
        json: async () => ({
          rows: [
            {
              keys: [],
              clicks: 100,
              impressions: 1000,
              ctr: 0.1,
              position: 4.2,
            },
          ],
        }),
      };
    });
    vi.stubGlobal('fetch', fetchSpy);

    const { getSearchPeriodComparison } = await import('../../server/search-console.js');

    const result = await getSearchPeriodComparison(
      'site-1',
      'sc-domain:example.com',
      7,
      { startDate: '2026-03-01', endDate: '2026-03-31' },
    );

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(requestBodies[0]).toMatchObject({
      startDate: '2026-03-01',
      endDate: '2026-03-31',
      type: 'web',
    });

    expect(requestBodies[1]).toMatchObject({
      startDate: '2026-01-29',
      endDate: '2026-02-28',
      type: 'web',
    });

    expect(result.current.clicks).toBe(100);
    expect(result.previous.clicks).toBe(100);
    expect(result.changePercent.clicks).toBe(0);
  });

  it('continues search-type breakdown when one type fetch fails', async () => {
    mocks.getValidToken.mockResolvedValue('token');

    let callIndex = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => {
        callIndex += 1;
        if (callIndex === 2) {
          return {
            ok: false,
            status: 500,
            text: vi.fn().mockResolvedValue('type failed'),
          };
        }

        return {
          ok: true,
          json: async () => ({
            rows: [
              {
                keys: [],
                clicks: callIndex,
                impressions: callIndex * 10,
                ctr: 0.1,
                position: 2.34,
              },
            ],
          }),
        };
      }),
    );

    const { getSearchTypeBreakdown } = await import('../../server/search-console.js');
    const result = await getSearchTypeBreakdown('site-1', 'sc-domain:example.com', 28);

    expect(result.map((r) => r.searchType)).toEqual(['web', 'video', 'news', 'discover']);
    expect(result).toHaveLength(4);
  });
});
