import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

// Mock fs so writeCache/readCache don't touch disk
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync: vi.fn().mockReturnValue(false),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    readFileSync: vi.fn().mockImplementation(() => {
      throw new Error('ENOENT');
    }),
    readdirSync: vi.fn().mockReturnValue([]),
  };
});

// Mock data-dir so UPLOAD_ROOT and CREDIT_DIR don't throw
vi.mock('../../server/data-dir.js', () => ({
  getUploadRoot: () => '/tmp/test-uploads',
  getDataDir: () => '/tmp/test-data',
}));

// Mock keyword-metrics-cache so SQLite DB is not accessed in unit tests
vi.mock('../../server/keyword-metrics-cache.js', () => ({
  getCachedMetricsBatch: vi.fn().mockReturnValue(new Map()),
  cacheMetricsBatch: vi.fn(),
  getCachedMetrics: vi.fn().mockReturnValue(null),
  cacheMetrics: vi.fn(),
}));

// Set env vars before importing the provider
process.env.DATAFORSEO_LOGIN = 'test-login';
process.env.DATAFORSEO_PASSWORD = 'test-password';

import { DataForSeoProvider } from '../../server/providers/dataforseo-provider.js';

function mockFetchOnce(json: unknown): void {
  vi.spyOn(global, 'fetch').mockResolvedValueOnce({
    ok: true,
    json: () => Promise.resolve(json),
  } as Response);
}

function dfsTaskResponse(result: unknown[]): unknown {
  return { tasks: [{ status_code: 20000, cost: 0.001, result }] };
}

describe('DataForSeoProvider — SERP features normalization', () => {
  afterEach(() => vi.restoreAllMocks());

  it('maps "videos" item type to "video" in serpFeatures', async () => {
    const provider = new DataForSeoProvider();
    mockFetchOnce(
      dfsTaskResponse([
        {
          items: [
            {
              keyword_data: {
                keyword: 'seo tools',
                keyword_info: {
                  search_volume: 1000,
                  competition: 0.5,
                  cpc: 3.0,
                  monthly_searches: [],
                },
              },
              ranked_serp_element: {
                serp_item: {
                  type: 'organic',
                  rank_group: 1,
                  url: 'https://example.com',
                  etv: 100,
                },
              },
            },
            {
              keyword_data: {
                keyword: 'seo tools',
                keyword_info: {
                  search_volume: 1000,
                  competition: 0.5,
                  cpc: 3.0,
                  monthly_searches: [],
                },
              },
              ranked_serp_element: {
                serp_item: {
                  type: 'videos',
                  rank_group: 1,
                  url: 'https://example.com',
                  etv: 100,
                },
              },
            },
            {
              keyword_data: {
                keyword: 'seo tools',
                keyword_info: {
                  search_volume: 1000,
                  competition: 0.5,
                  cpc: 3.0,
                  monthly_searches: [],
                },
              },
              ranked_serp_element: {
                serp_item: {
                  type: 'people_also_ask',
                  rank_group: 1,
                  url: 'https://example.com',
                  etv: 0,
                },
              },
            },
          ],
        },
      ])
    );

    const results = await provider.getDomainKeywords('example.com', 'ws-test-1', 100, 'us');

    expect(results).toHaveLength(1);
    const kw = results[0];
    expect(kw.keyword).toBe('seo tools');
    expect(kw.serpFeatures).toContain('video');
    expect(kw.serpFeatures).toContain('people_also_ask');
    expect(kw.serpFeatures).not.toContain('videos');
  });

  it('maps "people_also_ask" item type into serpFeatures', async () => {
    const provider = new DataForSeoProvider();
    mockFetchOnce(
      dfsTaskResponse([
        {
          items: [
            {
              keyword_data: {
                keyword: 'keyword research',
                keyword_info: {
                  search_volume: 5000,
                  competition: 0.6,
                  cpc: 2.0,
                  monthly_searches: [],
                },
              },
              ranked_serp_element: {
                serp_item: {
                  type: 'organic',
                  rank_group: 3,
                  url: 'https://example.com/kr',
                  etv: 50,
                },
              },
            },
            {
              keyword_data: {
                keyword: 'keyword research',
                keyword_info: {
                  search_volume: 5000,
                  competition: 0.6,
                  cpc: 2.0,
                  monthly_searches: [],
                },
              },
              ranked_serp_element: {
                serp_item: {
                  type: 'people_also_ask',
                  rank_group: 3,
                  url: '',
                  etv: 0,
                },
              },
            },
          ],
        },
      ])
    );

    const results = await provider.getDomainKeywords('example.com', 'ws-test-2', 100, 'us');
    expect(results[0].serpFeatures).toContain('people_also_ask');
  });
});

describe('DataForSeoProvider — getReferringDomains lastSeen', () => {
  afterEach(() => vi.restoreAllMocks());

  it('uses last_visited instead of lost_date for active backlinks', async () => {
    const provider = new DataForSeoProvider();
    mockFetchOnce(
      dfsTaskResponse([
        {
          items: [
            {
              domain: 'example.org',
              backlinks: 5,
              first_seen: '2024-01-15T00:00:00.000Z',
              last_visited: '2026-04-10T00:00:00.000Z',
              lost_date: null,
            },
          ],
        },
      ])
    );

    const results = await provider.getReferringDomains('example.com', 'ws-test-3');
    expect(results).toHaveLength(1);
    expect(results[0].lastSeen).toBe('2026-04-10T00:00:00.000Z');
    expect(results[0].lastSeen).not.toBe('N/A');
  });

  it('falls back to first_seen when last_visited is absent', async () => {
    const provider = new DataForSeoProvider();
    mockFetchOnce(
      dfsTaskResponse([
        {
          items: [
            {
              domain: 'fallback.org',
              backlinks: 2,
              first_seen: '2023-06-01T00:00:00.000Z',
              last_visited: undefined,
              lost_date: null,
            },
          ],
        },
      ])
    );

    const results = await provider.getReferringDomains('example.com', 'ws-test-4');
    expect(results[0].lastSeen).toBe('2023-06-01T00:00:00.000Z');
  });
});

describe('DataForSeoProvider — L1 global SQLite cache', () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('returns L1-cached metrics without making an API call', async () => {
    const { getCachedMetricsBatch } = await import('../../server/keyword-metrics-cache.js');
    vi.mocked(getCachedMetricsBatch).mockReturnValueOnce(new Map([
      ['cached keyword', { keyword: 'cached keyword', volume: 9999, difficulty: 42, cpc: 1.5, competition: 0.3, results: 0, trend: [100, 200] }]
    ]));

    let fetchCallCount = 0;
    global.fetch = async () => {
      fetchCallCount++;
      return { ok: true, json: async () => ({ tasks: [] }) } as Response;
    };

    const provider = new DataForSeoProvider();
    const results = await provider.getKeywordMetrics(['cached keyword'], 'ws-workspace-A', 'us');

    expect(fetchCallCount).toBe(0);
    expect(results).toHaveLength(1);
    expect(results[0].volume).toBe(9999);
    expect(results[0].difficulty).toBe(42);
  });

  it('writes API results to L1 cache after fetching', async () => {
    const origFetch = global.fetch;
    let fetchCalled = false;
    global.fetch = async () => {
      fetchCalled = true;
      return {
        ok: true,
        json: async () => ({
          tasks: [{ status_code: 20000, cost: 0.001, result: [
            { keyword: 'l1-write-test-kw', search_volume: 5000, competition_index: 30, cpc: 2.0, competition: 0.3, monthly_searches: [] }
          ]}]
        }),
      } as Response;
    };

    const { cacheMetricsBatch } = await import('../../server/keyword-metrics-cache.js');
    const cacheSpy = vi.mocked(cacheMetricsBatch);

    const provider = new DataForSeoProvider();
    await provider.getKeywordMetrics(['l1-write-test-kw'], 'ws-first', 'us');

    global.fetch = origFetch;

    expect(fetchCalled).toBe(true);
    expect(cacheSpy).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ keyword: 'l1-write-test-kw', volume: 5000 })]),
      'us'
    );
  });
});
