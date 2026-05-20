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
    vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          tasks: [{ status_code: 20000, cost: 0.001, result: [
            { keyword: 'l1-write-test-kw', search_volume: 5000, competition_index: 30, cpc: 2.0, competition: 0.3, monthly_searches: [] }
          ]}]
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          tasks: [{ status_code: 20000, cost: 0.0005, result: [
            { keyword: 'l1-write-test-kw', keyword_difficulty: 30 }
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

describe('DataForSeoProvider — getDomainKeywords order_by contract', () => {
  afterEach(() => vi.restoreAllMocks());

  it('includes explicit search_volume DESC order_by in the ranked_keywords payload', async () => {
    reapplyFsMocks();
    const provider = new DataForSeoProvider();
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => dfsTaskResponse([{ items: [] }]),
    } as Response);

    await provider.getDomainKeywords('example.com', 'ws-order-by', 100, 'us');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const call = fetchSpy.mock.calls[0];
    const body = JSON.parse(call[1]!.body as string);
    expect(body[0].order_by).toEqual(['keyword_data.keyword_info.search_volume,desc']);
  });
});

describe('DataForSeoProvider — keyword discovery endpoints', () => {
  afterEach(() => vi.restoreAllMocks());

  it('normalizes keyword_ideas results into source evidence', async () => {
    reapplyFsMocks();
    const provider = new DataForSeoProvider();
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => dfsTaskResponse([{
        items: [{
          keyword: 'best seo dashboard',
          keyword_info: {
            search_volume: 1200,
            keyword_difficulty: 44,
            competition: 0.32,
            cpc: 5.25,
            monthly_searches: [{ search_volume: 1000 }, { search_volume: 1200 }],
          },
          search_intent_info: { main_intent: 'commercial' },
          serp_info: { serp_item_types: ['organic', 'people_also_ask'] },
        }],
      }]),
    } as Response);

    const results = await provider.getKeywordIdeas(['seo dashboard'], 'ws-discovery-ideas', 25, 'us');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toContain('dataforseo_labs/google/keyword_ideas/live');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body[0]).toMatchObject({
      keywords: ['seo dashboard'],
      limit: 25,
      language_code: 'en',
    });
    expect(body[0]).not.toHaveProperty('order_by');
    expect(results).toEqual([
      expect.objectContaining({
        keyword: 'best seo dashboard',
        volume: 1200,
        difficulty: 44,
        cpc: 5.25,
        competition: 0.32,
        provider: 'dataforseo',
        sourceKind: 'keyword_ideas',
        seed: 'seo dashboard',
        intent: 'commercial',
        serpFeatures: 'organic,people_also_ask',
      }),
    ]);
    expect(results[0].trend).toEqual([1000, 1200]);
  });

  it('normalizes keywords_for_site results with source target evidence', async () => {
    reapplyFsMocks();
    const provider = new DataForSeoProvider();
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => dfsTaskResponse([{
        items: [{
          keyword: 'dental implants austin',
          keyword_info: { search_volume: 900, keyword_difficulty: 38, competition: 0.4, cpc: 8 },
        }],
      }]),
    } as Response);

    const results = await provider.getKeywordsForSite('https://www.example.com/services', 'ws-site-discovery', 10, 'us');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toContain('dataforseo_labs/google/keywords_for_site/live');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body[0]).toMatchObject({
      target: 'example.com',
      limit: 10,
    });
    expect(body[0]).not.toHaveProperty('order_by');
    expect(results[0]).toEqual(expect.objectContaining({
      keyword: 'dental implants austin',
      sourceKind: 'keywords_for_site',
      sourceTarget: 'example.com',
      confidence: 'high',
    }));
  });

  it('normalizes general keyword_suggestions without question filtering', async () => {
    reapplyFsMocks();
    const provider = new DataForSeoProvider();
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => dfsTaskResponse([{
        items: [{
          keyword_data: {
            keyword: 'seo dashboard software',
            keyword_info: { search_volume: 700, keyword_difficulty: 41, cpc: 4.5 },
          },
        }],
      }]),
    } as Response);

    const results = await provider.getKeywordSuggestions('seo dashboard', 'ws-suggestions', 20, 'us');

    const [, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body[0]).not.toHaveProperty('filters');
    expect(results[0]).toEqual(expect.objectContaining({
      keyword: 'seo dashboard software',
      sourceKind: 'keyword_suggestions',
      seed: 'seo dashboard',
    }));
  });

  it('normalizes Google Ads keywords_for_keywords results', async () => {
    reapplyFsMocks();
    const provider = new DataForSeoProvider();
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => dfsTaskResponse([
        { keyword: 'seo rank tracking software', search_volume: 1300, competition_index: 52, cpc: 6.1, competition: 0.52, monthly_searches: [] },
      ]),
    } as Response);

    const results = await provider.getKeywordsForKeywords(['rank tracking'], 'ws-google-ads', 50, 'us');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toContain('keywords_data/google_ads/keywords_for_keywords/live');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body[0]).toMatchObject({ keywords: ['rank tracking'], sort_by: 'relevance' });
    expect(body[0]).not.toHaveProperty('limit');
    expect(results[0]).toEqual(expect.objectContaining({
      keyword: 'seo rank tracking software',
      difficulty: 52,
      sourceKind: 'google_ads_keywords_for_keywords',
      seed: 'rank tracking',
    }));
  });

  it('returns cached discovery candidates without a provider call', async () => {
    const cached = [{
      keyword: 'cached discovery keyword',
      volume: 500,
      difficulty: 24,
      cpc: 3.2,
      provider: 'dataforseo',
      sourceKind: 'keyword_ideas' as const,
      seed: 'cached seed',
      confidence: 'medium' as const,
    }];
    vi.spyOn(fs, 'existsSync').mockImplementation(pathLike => String(pathLike).includes('.dataforseo-cache'));
    vi.spyOn(fs, 'mkdirSync').mockReturnValue(undefined as never);
    vi.spyOn(fs, 'readFileSync').mockImplementation(() => JSON.stringify({
      cachedAt: new Date().toISOString(),
      data: cached,
    }));
    const fetchSpy = vi.spyOn(global, 'fetch');
    const provider = new DataForSeoProvider();

    const results = await provider.getKeywordIdeas(['cached seed'], 'ws-discovery-cache', 25, 'us');

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(results).toEqual(cached);
  });

  it('degrades malformed discovery payloads to an empty result', async () => {
    reapplyFsMocks();
    const provider = new DataForSeoProvider();
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => dfsTaskResponse([{ items: [{ keyword_info: { search_volume: 100 } }] }]),
    } as Response);

    await expect(provider.getKeywordsForSite('example.com', 'ws-malformed-discovery', 10, 'us')).resolves.toEqual([]);
  });

  it('returns an empty result when a discovery endpoint fails', async () => {
    reapplyFsMocks();
    const provider = new DataForSeoProvider();
    vi.spyOn(global, 'fetch').mockRejectedValueOnce(new Error('provider unavailable'));

    await expect(provider.getKeywordSuggestions('seo dashboard', 'ws-discovery-failure', 20, 'us')).resolves.toEqual([]);
  });
});

describe('DataForSeoProvider — getReferringDomains date normalization', () => {
  afterEach(() => vi.restoreAllMocks());

  it('normalizes first_seen / last_visited via normalizeProviderDate', async () => {
    reapplyFsMocks();
    const provider = new DataForSeoProvider();
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => dfsTaskResponse([{
        items: [
          {
            domain: 'example.com',
            backlinks: 14,
            first_seen: '1747509061',
            last_visited: '1776200795',
          },
        ],
      }]),
    } as Response);

    const result = await provider.getReferringDomains('example.test', 'ws-dfs-date', 15, 'us');
    expect(result[0].firstSeen).toMatch(/^2025-05-17T/);
    expect(result[0].lastSeen).toMatch(/^2026-\d{2}-\d{2}T/);
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

describe('DataForSeoProvider — local visibility', () => {
  afterEach(() => vi.restoreAllMocks());

  const market = {
    id: 'market-austin',
    workspaceId: 'ws-local-provider',
    label: 'Austin, TX',
    city: 'Austin',
    stateOrRegion: 'TX',
    country: 'US',
    providerLocationCode: 1026201,
    providerLocationName: 'Austin,Texas,United States',
    source: 'admin_override' as const,
    status: 'active' as const,
    createdAt: '2026-05-20T00:00:00.000Z',
    updatedAt: '2026-05-20T00:00:00.000Z',
  };

  it('uses Google organic SERP local-pack payload guardrails', async () => {
    reapplyFsMocks();
    const provider = new DataForSeoProvider();
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(dfsTaskResponse([{ items: [] }])),
    } as Response);

    await provider.getLocalVisibility({
      keyword: 'austin dentist',
      market,
      device: 'desktop',
      languageCode: 'en',
      maxResults: 10,
    }, 'ws-local-provider');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toContain('serp/google/organic/live/advanced');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body[0]).toEqual(expect.objectContaining({
      keyword: 'austin dentist',
      location_code: 1026201,
      language_code: 'en',
      device: 'desktop',
    }));
    expect(body[0]).not.toHaveProperty('location_name');
    expect(body[0].depth).toBeGreaterThanOrEqual(10);
  });

  it('uses coordinates when no provider location code or name is available', async () => {
    reapplyFsMocks();
    const provider = new DataForSeoProvider();
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(dfsTaskResponse([{ items: [] }])),
    } as Response);

    await provider.getLocalVisibility({
      keyword: 'austin dentist',
      market: {
        ...market,
        providerLocationCode: undefined,
        providerLocationName: undefined,
        latitude: 30.2672,
        longitude: -97.7431,
      },
      device: 'desktop',
      languageCode: 'en',
      maxResults: 10,
    }, 'ws-local-provider');

    const [, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body[0]).toEqual(expect.objectContaining({
      location_coordinate: '30.2672,-97.7431,10z',
    }));
    expect(body[0]).not.toHaveProperty('location_code');
    expect(body[0]).not.toHaveProperty('location_name');
  });

  it('separates local visibility cache keys by provider location identity', async () => {
    reapplyFsMocks();
    const provider = new DataForSeoProvider();
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(dfsTaskResponse([{ items: [] }])),
    } as Response);

    await provider.getLocalVisibility({
      keyword: 'austin dentist',
      market: {
        ...market,
        id: 'market-austin-name-a',
        providerLocationCode: undefined,
        providerLocationName: 'Austin,Texas,United States',
      },
      device: 'desktop',
      languageCode: 'en',
      maxResults: 10,
    }, 'ws-local-provider');
    await provider.getLocalVisibility({
      keyword: 'austin dentist',
      market: {
        ...market,
        id: 'market-austin-name-b',
        providerLocationCode: undefined,
        providerLocationName: 'Austin,Texas',
      },
      device: 'desktop',
      languageCode: 'en',
      maxResults: 10,
    }, 'ws-local-provider');

    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('normalizes nested local pack items into provider results', async () => {
    reapplyFsMocks();
    const provider = new DataForSeoProvider();
    mockFetchOnce(dfsTaskResponse([{
      items: [{
        type: 'local_pack',
        items: [
          { title: 'Local Dental', rank_group: 1, domain: 'local-dental.example.com', phone: '(512) 555-0123', description: '123 Congress Ave, Austin, TX', cid: 'abc' },
          { title: 'Other Dentist', rank_group: 2, url: 'https://other.example.com' },
        ],
      }],
    }]));

    const result = await provider.getLocalVisibility({
      keyword: 'austin dentist',
      market,
      device: 'mobile',
      languageCode: 'en',
      maxResults: 10,
    }, 'ws-local-provider');

    expect(result.localPackPresent).toBe(true);
    expect(result.sourceEndpoint).toBe('google_organic_serp');
    expect(result.results).toEqual([
      expect.objectContaining({ title: 'Local Dental', rank: 1, domain: 'local-dental.example.com', address: '123 Congress Ave, Austin, TX', cid: 'abc' }),
      expect.objectContaining({ title: 'Other Dentist', rank: 2, domain: 'other.example.com' }),
    ]);
  });

  it('normalizes multiple top-level local pack items into provider results', async () => {
    reapplyFsMocks();
    const provider = new DataForSeoProvider();
    mockFetchOnce(dfsTaskResponse([{
      items: [
        { type: 'local_pack', title: 'Competitor Dental', rank_group: 1, domain: 'competitor.example.com' },
        { type: 'local_pack', title: 'Local Dental', rank_group: 2, domain: 'local-dental.example.com' },
      ],
    }]));

    const result = await provider.getLocalVisibility({
      keyword: 'austin dentist',
      market,
      device: 'desktop',
      languageCode: 'en',
      maxResults: 10,
    }, 'ws-local-provider');

    expect(result.localPackPresent).toBe(true);
    expect(result.results).toEqual([
      expect.objectContaining({ title: 'Competitor Dental', rank: 1, domain: 'competitor.example.com' }),
      expect.objectContaining({ title: 'Local Dental', rank: 2, domain: 'local-dental.example.com' }),
    ]);
  });

  it('degrades provider failures into a typed provider_failed result', async () => {
    reapplyFsMocks();
    const provider = new DataForSeoProvider();
    vi.spyOn(global, 'fetch').mockRejectedValueOnce(new Error('network down'));

    const result = await provider.getLocalVisibility({
      keyword: 'austin dentist',
      market,
      device: 'desktop',
      languageCode: 'en',
      maxResults: 10,
    }, 'ws-local-provider');

    expect(result.status).toBe('provider_failed');
    expect(result.localPackPresent).toBe(false);
    expect(result.results).toEqual([]);
    expect(result.degradedReason).toContain('Network error');
  });
});
