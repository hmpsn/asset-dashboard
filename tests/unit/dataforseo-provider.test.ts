import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { isCapabilityDisabled, clearCapabilityDisabled } from '../../server/seo-data-provider.js';

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

import fs from 'fs';
import { DataForSeoProvider } from '../../server/providers/dataforseo-provider.js';
import { getCachedMetricsBatch, cacheMetricsBatch } from '../../server/keyword-metrics-cache.js';

function mockFetchOnce(json: unknown): void {
  vi.spyOn(global, 'fetch').mockResolvedValueOnce({
    ok: true,
    json: () => Promise.resolve(json),
  } as Response);
}

function dfsTaskResponse(result: unknown[]): unknown {
  return { tasks: [{ status_code: 20000, cost: 0.001, result }] };
}

/**
 * Re-apply fs mock defaults after vi.restoreAllMocks() clears them.
 * vi.restoreAllMocks() removes spy/mock implementations from vi.fn() instances,
 * so we must re-spy on the real fs functions before each test that needs them.
 */
function reapplyFsMocks(): void {
  vi.spyOn(fs, 'existsSync').mockReturnValue(false);
  vi.spyOn(fs, 'mkdirSync').mockReturnValue(undefined as never);
  vi.spyOn(fs, 'writeFileSync').mockReturnValue(undefined);
  vi.spyOn(fs, 'readFileSync').mockImplementation(() => { throw new Error('ENOENT'); });
  vi.spyOn(fs, 'readdirSync').mockReturnValue([]);
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

describe('DataForSeoProvider — ranked_keywords/live request contract', () => {
  afterEach(() => vi.restoreAllMocks());

  // Regression: `dataforseo_labs/google/ranked_keywords/live` rejects the
  // `item_types` field with error 40501. Including it makes every call throw,
  // which the outer catch swallows and returns [] (or null for the overview
  // variant). Both getDomainKeywords and getDomainOverview hit this endpoint,
  // so both must be kept free of the forbidden field.
  it('getDomainKeywords does NOT include item_types in the ranked_keywords payload', async () => {
    reapplyFsMocks();
    const provider = new DataForSeoProvider();
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(dfsTaskResponse([{ items: [] }])),
    } as Response);

    await provider.getDomainKeywords('example.com', 'ws-contract-kw', 100, 'us');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toContain('dataforseo_labs/google/ranked_keywords/live');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(Array.isArray(body)).toBe(true);
    expect(body[0]).toHaveProperty('target', 'example.com');
    expect(body[0]).toHaveProperty('location_code');
    expect(body[0]).toHaveProperty('language_code', 'en');
    expect(body[0]).toHaveProperty('limit', 100);
    expect(body[0]).not.toHaveProperty('item_types');
  });

  it('getDomainOverview does NOT include item_types in the ranked_keywords payload', async () => {
    reapplyFsMocks();
    const provider = new DataForSeoProvider();
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(dfsTaskResponse([{
        metrics: { organic: { count: 10, etv: 100, estimated_paid_traffic_cost: 5 } },
      }])),
    } as Response);

    await provider.getDomainOverview('example.com', 'ws-contract-overview', 'us');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toContain('dataforseo_labs/google/ranked_keywords/live');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body[0]).toHaveProperty('target', 'example.com');
    expect(body[0]).toHaveProperty('limit', 1);
    expect(body[0]).not.toHaveProperty('item_types');
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

describe('DataForSeoProvider — keyword difficulty endpoint', () => {
  beforeEach(() => {
    reapplyFsMocks();
    vi.mocked(getCachedMetricsBatch).mockReturnValue(new Map());
    vi.mocked(cacheMetricsBatch).mockReset();
  });

  afterEach(() => vi.restoreAllMocks());

  it('uses keyword_difficulty from KD endpoint instead of competition_index', async () => {
    const provider = new DataForSeoProvider();

    // First call = volume endpoint, second = KD endpoint
    vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ tasks: [{ status_code: 20000, cost: 0.001, result: [
          { keyword: 'buy shoes online', search_volume: 8000, competition_index: 20, cpc: 1.5, competition: 0.2, monthly_searches: [] },
        ]}] }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ tasks: [{ status_code: 20000, cost: 0.0005, result: [
          { keyword: 'buy shoes online', keyword_difficulty: 73 },
        ]}] }),
      } as Response);

    const results = await provider.getKeywordMetrics(['buy shoes online'], 'ws-kd-test', 'us');

    expect(results).toHaveLength(1);
    expect(results[0].difficulty).toBe(73); // from KD endpoint, not competition_index (20)
  });

  it('falls back to competition_index when KD endpoint fails', async () => {
    const provider = new DataForSeoProvider();

    vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ tasks: [{ status_code: 20000, cost: 0.001, result: [
          { keyword: 'some keyword', search_volume: 1000, competition_index: 45, cpc: 0.5, competition: 0.45, monthly_searches: [] },
        ]}] }),
      } as Response)
      .mockRejectedValueOnce(new Error('KD endpoint unavailable'));

    const results = await provider.getKeywordMetrics(['some keyword'], 'ws-kd-fallback', 'us');
    expect(results[0].difficulty).toBe(45); // falls back to competition_index
  });

  it('uses keyword_difficulty from keyword_info in getRelatedKeywords', async () => {
    const provider = new DataForSeoProvider();

    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ tasks: [{ status_code: 20000, cost: 0.001, result: [{
        items: [{
          keyword_data: {
            keyword: 'related seo',
            keyword_info: { search_volume: 2000, competition: 0.5, cpc: 1.0, keyword_difficulty: 61 },
          },
        }],
      }] }] }),
    } as Response);

    const results = await provider.getRelatedKeywords('seo', 'ws-related', 5, 'us');
    expect(results[0].difficulty).toBe(61);
  });
});

describe('DataForSeoProvider — L1 global SQLite cache', () => {
  beforeEach(() => {
    // vi.restoreAllMocks() in earlier afterEach calls removes vi.fn() implementations
    // from module mocks. Re-apply all mock defaults before each test in this block.
    reapplyFsMocks();
    vi.mocked(getCachedMetricsBatch).mockReturnValue(new Map());
    vi.mocked(cacheMetricsBatch).mockReset();
  });

  afterEach(() => vi.restoreAllMocks());

  it('returns L1-cached metrics without making an API call', async () => {
    vi.mocked(getCachedMetricsBatch).mockReturnValueOnce(new Map([
      ['cached keyword', { keyword: 'cached keyword', volume: 9999, difficulty: 42, cpc: 1.5, competition: 0.3, results: 0, trend: [100, 200] }]
    ]));

    const fetchSpy = vi.spyOn(global, 'fetch');

    const provider = new DataForSeoProvider();
    const results = await provider.getKeywordMetrics(['cached keyword'], 'ws-workspace-A', 'us');

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(results).toHaveLength(1);
    expect(results[0].volume).toBe(9999);
    expect(results[0].difficulty).toBe(42);
  });

  it('writes API results to L1 cache after fetching', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        tasks: [{ status_code: 20000, cost: 0.001, result: [
          { keyword: 'l1-write-test-kw', search_volume: 5000, competition_index: 30, cpc: 2.0, competition: 0.3, monthly_searches: [] }
        ]}]
      }),
    } as Response);

    const cacheSpy = vi.mocked(cacheMetricsBatch);

    const provider = new DataForSeoProvider();
    await provider.getKeywordMetrics(['l1-write-test-kw'], 'ws-l1-write-test', 'us');

    expect(global.fetch).toHaveBeenCalled();
    expect(cacheSpy).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ keyword: 'l1-write-test-kw', volume: 5000 })]),
      'us'
    );
  });
});

describe('DataForSeoProvider — init() capability probe', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    clearCapabilityDisabled('dataforseo', 'backlinks');
  });

  it('marks backlinks disabled when probe returns subscription error', async () => {
    const provider = new DataForSeoProvider();

    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        tasks: [{ status_code: 40204, status_message: 'subscription required — 40204', cost: 0 }],
      }),
    } as Response);

    await provider.init();

    expect(isCapabilityDisabled('dataforseo', 'backlinks')).toBe(true);
  });

  it('does not mark backlinks disabled when probe succeeds', async () => {
    const provider = new DataForSeoProvider();

    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(dfsTaskResponse([{ target: 'example.com', backlinks: 0 }])),
    } as Response);

    await provider.init();

    expect(isCapabilityDisabled('dataforseo', 'backlinks')).toBe(false);
  });

  it('is a no-op when provider is not configured', async () => {
    const savedLogin = process.env.DATAFORSEO_LOGIN;
    const savedPwd = process.env.DATAFORSEO_PASSWORD;
    delete process.env.DATAFORSEO_LOGIN;
    delete process.env.DATAFORSEO_PASSWORD;

    try {
      const provider = new DataForSeoProvider();
      const fetchSpy = vi.spyOn(global, 'fetch');
      await provider.init();
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      if (savedLogin !== undefined) process.env.DATAFORSEO_LOGIN = savedLogin;
      else delete process.env.DATAFORSEO_LOGIN;
      if (savedPwd !== undefined) process.env.DATAFORSEO_PASSWORD = savedPwd;
      else delete process.env.DATAFORSEO_PASSWORD;
    }
  });

  it('skips API probe when a recent probe result exists on disk', async () => {
    const provider = new DataForSeoProvider();
    const fresh = { outcome: 'backlinks-disabled', probedAt: new Date().toISOString() };

    // readFileSync returns a fresh cached probe result → init() must not call fetch.
    vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify(fresh));
    const fetchSpy = vi.spyOn(global, 'fetch');

    await provider.init();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(isCapabilityDisabled('dataforseo', 'backlinks')).toBe(true);
  });

  it('re-probes when the cached probe result is older than the 24h TTL', async () => {
    const provider = new DataForSeoProvider();
    const stale = { outcome: 'backlinks-disabled', probedAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString() };

    vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify(stale));
    vi.spyOn(fs, 'writeFileSync').mockReturnValue(undefined);
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(dfsTaskResponse([{ target: 'example.com', backlinks: 0 }])),
    } as Response);

    await provider.init();

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(isCapabilityDisabled('dataforseo', 'backlinks')).toBe(false);
  });
});
