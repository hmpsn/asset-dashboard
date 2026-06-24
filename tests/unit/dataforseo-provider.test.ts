import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { isCapabilityDisabled, clearCapabilityDisabled, _resetRegistryForTest } from '../../server/seo-data-provider.js';

const loggerMocks = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

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

vi.mock('../../server/logger.js', () => ({
  createLogger: () => loggerMocks,
}));

// Set env vars before importing the provider
process.env.DATAFORSEO_LOGIN = 'test-login';
process.env.DATAFORSEO_PASSWORD = 'test-password';

import fs from 'fs';
import { DataForSeoProvider, flushCreditsToDisk } from '../../server/providers/dataforseo-provider.js';
import { getCachedMetricsBatch, cacheMetricsBatch } from '../../server/keyword-metrics-cache.js';

beforeEach(() => {
  loggerMocks.info.mockReset();
  loggerMocks.warn.mockReset();
  loggerMocks.error.mockReset();
  loggerMocks.debug.mockReset();
});

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

  it('uses the supplied geo location code for search volume and keyword difficulty payloads', async () => {
    const provider = new DataForSeoProvider();

    const fetchSpy = vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ tasks: [{ status_code: 20000, cost: 0.001, result: [
          { keyword: 'teeth whitening', search_volume: 300, competition_index: 20, cpc: 1.5, competition: 0.2, monthly_searches: [] },
        ]}] }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ tasks: [{ status_code: 20000, cost: 0.0005, result: [
          { keyword: 'teeth whitening', keyword_difficulty: 48 },
        ]}] }),
      } as Response);

    await provider.getKeywordMetrics(['teeth whitening'], 'ws-geo-test', 'us', 1022162);

    const volumePayload = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    const difficultyPayload = JSON.parse((fetchSpy.mock.calls[1][1] as RequestInit).body as string);
    expect(volumePayload[0].location_code).toBe(1022162);
    expect(difficultyPayload[0].location_code).toBe(1022162);
    // P1: cache region is versioned + language-aware (v2:<locationCode>:<lang>).
    expect(getCachedMetricsBatch).toHaveBeenCalledWith(['teeth whitening'], 'v2:1022162:en', expect.any(Number));
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

  it('returns cached related keywords without making a provider call', async () => {
    const cached: Array<{ keyword: string; volume: number; difficulty: number; cpc: number }> = [
      { keyword: 'cached related keyword', volume: 400, difficulty: 22, cpc: 1.1 },
    ];
    vi.spyOn(fs, 'existsSync').mockImplementation(pathLike => String(pathLike).includes('.dataforseo-cache'));
    vi.spyOn(fs, 'mkdirSync').mockReturnValue(undefined as never);
    vi.spyOn(fs, 'readFileSync').mockImplementation(() => JSON.stringify({
      cachedAt: new Date().toISOString(),
      data: cached,
    }));
    const fetchSpy = vi.spyOn(global, 'fetch');
    const provider = new DataForSeoProvider();

    const results = await provider.getRelatedKeywords('seo', 'ws-related-cache', 5, 'us');

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(results).toEqual(cached);
  });

  // ── P1 / G13: language threading at the pool-path sites ──
  // Behavioral (fetch-body) assertions — NOT source-text sniffing. Each pool-path
  // method must send the threaded language_code, not the hardcoded 'en'. A single
  // fetch spy queued with all responses (no mid-test restore, so credit flushing
  // is not disturbed); each sub-call's request body is read by call index.
  it('threads the resolved language_code into pool-path provider requests (not hardcoded en)', async () => {
    const provider = new DataForSeoProvider();
    const empty = () => ({ ok: true, json: () => Promise.resolve(dfsTaskResponse([{ items: [] }])) } as Response);
    const fetchSpy = vi.spyOn(global, 'fetch')
      // getKeywordMetrics → search_volume + keyword_difficulty
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(dfsTaskResponse([{ keyword: 'k', search_volume: 100, competition_index: 10, cpc: 1, competition: 0.1, monthly_searches: [] }])) } as Response)
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(dfsTaskResponse([{ keyword: 'k', keyword_difficulty: 20 }])) } as Response)
      .mockResolvedValueOnce(empty())  // getRelatedKeywords
      .mockResolvedValueOnce(empty())  // getQuestionKeywords
      .mockResolvedValueOnce(empty())  // getKeywordSuggestions
      .mockResolvedValueOnce(empty())  // getKeywordIdeas
      .mockResolvedValueOnce(empty()); // getKeywordsForSite

    const langOf = (call: number) => JSON.parse((fetchSpy.mock.calls[call][1] as RequestInit).body as string)[0].language_code;

    // P1 signature: (..., database?, locationCode?, languageCode?). The 5 discovery
    // methods now take an explicit locationCode slot before languageCode (mirroring
    // getKeywordMetrics) — language must thread through regardless of geo.
    await provider.getKeywordMetrics(['k'], 'ws-de-1', 'us', 2276, 'de');
    expect(langOf(0)).toBe('de');
    expect(langOf(1)).toBe('de');
    await provider.getRelatedKeywords('seo', 'ws-de-2', 5, 'us', 2276, 'de');
    expect(langOf(2)).toBe('de');
    await provider.getQuestionKeywords('seo', 'ws-de-3', 5, 'us', 2276, 'de');
    expect(langOf(3)).toBe('de');
    await provider.getKeywordSuggestions('seo', 'ws-de-4', 5, 'us', 2276, 'de');
    expect(langOf(4)).toBe('de');
    await provider.getKeywordIdeas(['seo'], 'ws-de-5', 5, 'us', 2276, 'de');
    expect(langOf(5)).toBe('de');
    await provider.getKeywordsForSite('example.com', 'ws-de-6', 5, 'us', 2276, 'de');
    expect(langOf(6)).toBe('de');
    // Drain queued credit writes now (fs ENOENT mock active) so they don't flush
    // into a later test whose readFileSync mock returns a non-array cache value.
    flushCreditsToDisk();
  });

  it('defaults pool-path language to en when no languageCode is passed', async () => {
    const provider = new DataForSeoProvider();
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(dfsTaskResponse([{ items: [] }])) } as Response);
    await provider.getRelatedKeywords('seo', 'ws-default-lang', 5, 'us');
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body[0].language_code).toBe('en');
  });

  // ── C1: geo threading at the 5 discovery pool-path sites ──
  // The whole-pool-US fix: when an explicit non-US locationCode is threaded, it
  // must reach the request body's location_code for ALL 5 discovery methods (not
  // the US default derived from the `database` slot).
  it('threads a non-US locationCode into location_code for all 5 discovery methods', async () => {
    const provider = new DataForSeoProvider();
    const empty = () => ({ ok: true, json: () => Promise.resolve(dfsTaskResponse([{ items: [] }])) } as Response);
    const fetchSpy = vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce(empty())  // getRelatedKeywords
      .mockResolvedValueOnce(empty())  // getQuestionKeywords
      .mockResolvedValueOnce(empty())  // getKeywordSuggestions
      .mockResolvedValueOnce(empty())  // getKeywordIdeas
      .mockResolvedValueOnce(empty()); // getKeywordsForSite

    const geoOf = (call: number) => JSON.parse((fetchSpy.mock.calls[call][1] as RequestInit).body as string)[0].location_code;
    const UK = 2826;

    // database='us' is intentionally still passed: the explicit locationCode must
    // WIN over locationCodeFromDatabase('us')=2840 (the exact whole-pool-US bug).
    await provider.getRelatedKeywords('seo', 'ws-uk-1', 5, 'us', UK);
    expect(geoOf(0)).toBe(UK);
    await provider.getQuestionKeywords('seo', 'ws-uk-2', 5, 'us', UK);
    expect(geoOf(1)).toBe(UK);
    await provider.getKeywordSuggestions('seo', 'ws-uk-3', 5, 'us', UK);
    expect(geoOf(2)).toBe(UK);
    await provider.getKeywordIdeas(['seo'], 'ws-uk-4', 5, 'us', UK);
    expect(geoOf(3)).toBe(UK);
    await provider.getKeywordsForSite('example.com', 'ws-uk-5', 5, 'us', UK);
    expect(geoOf(4)).toBe(UK);
    flushCreditsToDisk();
  });

  it('falls back to locationCodeFromDatabase when no locationCode is passed (flag-OFF parity)', async () => {
    const provider = new DataForSeoProvider();
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(dfsTaskResponse([{ items: [] }])) } as Response);
    // No locationCode → location_code derives from database ('us' → 2840), exactly
    // as the legacy flag-OFF callers (which pass neither locationCode nor database).
    await provider.getKeywordsForSite('example.com', 'ws-default-geo', 5);
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body[0].location_code).toBe(2840);
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

  it('falls back to legacy national L1 cache keys before making an API call', async () => {
    vi.mocked(getCachedMetricsBatch).mockClear();
    vi.mocked(getCachedMetricsBatch)
      .mockReturnValueOnce(new Map())
      .mockReturnValueOnce(new Map([
        ['legacy keyword', { keyword: 'legacy keyword', volume: 1200, difficulty: 35, cpc: 1.1, competition: 0.2, results: 0, trend: [] }],
      ]));

    const fetchSpy = vi.spyOn(global, 'fetch');

    const provider = new DataForSeoProvider();
    const results = await provider.getKeywordMetrics(['legacy keyword'], 'ws-legacy-cache', 'us');

    expect(fetchSpy).not.toHaveBeenCalled();
    // P1: primary lookup is the versioned/language-aware region; the legacy
    // fallback now reads the pre-version language-blind geo region (2840) so an
    // 'en' caller's already-warmed rows stay reachable.
    expect(getCachedMetricsBatch).toHaveBeenNthCalledWith(1, ['legacy keyword'], 'v2:2840:en', expect.any(Number));
    expect(getCachedMetricsBatch).toHaveBeenNthCalledWith(2, ['legacy keyword'], '2840', expect.any(Number));
    expect(cacheMetricsBatch).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ keyword: 'legacy keyword', volume: 1200 })]),
      'v2:2840:en',
    );
    expect(results[0].volume).toBe(1200);
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
      'v2:2840:en'
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

  it('degrades backlinks overview subscription errors to null', async () => {
    reapplyFsMocks();
    const provider = new DataForSeoProvider();
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        tasks: [{ status_code: 40204, status_message: 'subscription required — 40204', cost: 0 }],
      }),
    } as Response);

    await expect(provider.getBacklinksOverview('example.test', 'ws-backlinks-subscription', 'us')).resolves.toBeNull();
  });

  it('does not emit competitor discovery logs for cached competitor results', async () => {
    const cached = [
      {
        domain: 'cached-competitor.test',
        competitorRelevance: 73,
        commonKeywords: 11,
        organicKeywords: 320,
        organicTraffic: 1400,
        organicCost: 92,
      },
    ];
    vi.spyOn(fs, 'existsSync').mockImplementation(pathLike => String(pathLike).includes('.dataforseo-cache'));
    vi.spyOn(fs, 'mkdirSync').mockReturnValue(undefined as never);
    vi.spyOn(fs, 'readFileSync').mockImplementation(() => JSON.stringify({
      cachedAt: new Date().toISOString(),
      data: cached,
    }));
    const fetchSpy = vi.spyOn(global, 'fetch');
    const provider = new DataForSeoProvider();

    const result = await provider.getCompetitors('example.test', 'ws-competitors-cache', 10, 'us');

    expect(result).toEqual(cached);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(loggerMocks.info).not.toHaveBeenCalledWith('Found 1 competitors for "example.test"');
  });
});

describe('DataForSeoProvider — init() capability probe', () => {
  beforeEach(() => {
    _resetRegistryForTest();
    reapplyFsMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    _resetRegistryForTest();
  });

  it('does not probe or disable backlinks when a subscription error would previously be returned', async () => {
    const provider = new DataForSeoProvider();

    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        tasks: [{ status_code: 40204, status_message: 'subscription required — 40204', cost: 0 }],
      }),
    } as Response);

    await provider.init();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(isCapabilityDisabled('dataforseo', 'backlinks')).toBe(false);
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

  it('ignores legacy recent probe cache files and leaves backlinks enabled', async () => {
    const provider = new DataForSeoProvider();
    const fresh = { outcome: 'backlinks-disabled', probedAt: new Date().toISOString() };

    vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify(fresh));
    const fetchSpy = vi.spyOn(global, 'fetch');

    await provider.init();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(isCapabilityDisabled('dataforseo', 'backlinks')).toBe(false);
  });

  it('ignores legacy stale probe cache files and does not re-probe', async () => {
    const provider = new DataForSeoProvider();
    const stale = { outcome: 'backlinks-disabled', probedAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString() };

    vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify(stale));
    vi.spyOn(fs, 'writeFileSync').mockReturnValue(undefined);
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(dfsTaskResponse([{ target: 'example.com', backlinks: 0 }])),
    } as Response);

    await provider.init();

    expect(fetchSpy).not.toHaveBeenCalled();
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

  it('resolves local SEO market input to a DataForSEO location code', async () => {
    reapplyFsMocks();
    const provider = new DataForSeoProvider();
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(dfsTaskResponse([{
        location_code: 1026201,
        location_name: 'Austin,Texas,United States',
        country_iso_code: 'US',
        location_type: 'City',
      }, {
        location_code: 21176,
        location_name: 'Texas,United States',
        country_iso_code: 'US',
        location_type: 'State',
      }])),
    } as Response);

    const result = await provider.resolveLocalSeoLocation({
      city: 'Austin',
      stateOrRegion: 'TX',
      country: 'US',
    }, 'ws-local-provider');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0][0])).toContain('serp/google/locations/us');
    expect(result.status).toBe('matched');
    expect(result.bestCandidate).toEqual(expect.objectContaining({
      providerLocationCode: 1026201,
      providerLocationName: 'Austin,Texas,United States',
    }));
  });

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
      location_coordinate: '30.2672,-97.7431,200',
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
    const firstBody = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(firstBody[0]).toEqual(expect.objectContaining({
      location_name: 'Austin,Texas,United States',
    }));
    expect(firstBody[0]).not.toHaveProperty('location_code');
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
    // Persistent rejection (not Once): P5 bounded retry makes up to 3 attempts on a
    // transient network error; provider_failed is the terminal state once they exhaust.
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('network down'));

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

// ── P4: geo correctness for the DOMAIN-analysis methods ──
// Behavioral (request-body + cache-path) assertions. The six domain methods
// (getDomainKeywords / getUrlKeywords / getDomainOverview / getCompetitors /
// getKeywordGap / getKeywordsForKeywords) must (1) thread an explicit
// locationCode+languageCode into the request body, (2) default to US (2840)/'en'
// when none is passed (flag-OFF parity), and (3) keep the flag-OFF cache key on the
// legacy un-versioned `database` token so the 7–14 day domain cache is NOT re-warmed.
describe('DataForSeoProvider — P4 domain-method geo threading', () => {
  afterEach(() => vi.restoreAllMocks());

  const okEmpty = () => ({ ok: true, json: async () => dfsTaskResponse([{ items: [] }]) } as Response);

  it('threads location_code + language_code into all six domain-method request bodies', async () => {
    reapplyFsMocks();
    const provider = new DataForSeoProvider();
    const CA = 2124;
    const fetchSpy = vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce(okEmpty())  // getDomainKeywords
      .mockResolvedValueOnce(okEmpty())  // getUrlKeywords
      .mockResolvedValueOnce(okEmpty())  // getDomainOverview
      .mockResolvedValueOnce(okEmpty())  // getCompetitors
      .mockResolvedValueOnce(okEmpty())  // getKeywordGap → competitor getDomainKeywords
      .mockResolvedValueOnce(okEmpty())  // getKeywordGap → client getDomainKeywords
      .mockResolvedValueOnce(okEmpty()); // getKeywordsForKeywords (google_ads)

    const bodyOf = (call: number) => JSON.parse((fetchSpy.mock.calls[call][1] as RequestInit).body as string)[0];

    await provider.getDomainKeywords('example.com', 'ws-p4-1', 50, undefined, CA, 'fr');
    expect(bodyOf(0)).toMatchObject({ location_code: CA, language_code: 'fr' });

    await provider.getUrlKeywords('https://example.com/page', 'ws-p4-2', 20, undefined, CA, 'fr');
    expect(bodyOf(1)).toMatchObject({ location_code: CA, language_code: 'fr' });

    await provider.getDomainOverview('example.com', 'ws-p4-3', undefined, CA, 'fr');
    expect(bodyOf(2)).toMatchObject({ location_code: CA, language_code: 'fr' });

    await provider.getCompetitors('example.com', 'ws-p4-4', 10, undefined, CA, 'fr');
    expect(bodyOf(3)).toMatchObject({ location_code: CA, language_code: 'fr' });

    // getKeywordGap has no own request body — geo flows through its nested
    // getDomainKeywords calls (competitor queried first → call 4, then the client
    // domain for the dedup set → call 5). BOTH must carry the client geo: a dropped
    // geo on the client call (index 5) would compute the "already ranks" set against
    // the wrong SERP and silently corrupt the gap output, yet the comp-only assert
    // would still pass.
    await provider.getKeywordGap('example.com', ['competitor.com'], 'ws-p4-5', 50, undefined, CA, 'fr');
    expect(String(fetchSpy.mock.calls[4][0])).toContain('ranked_keywords');
    expect(bodyOf(4)).toMatchObject({ location_code: CA, language_code: 'fr', target: 'competitor.com' });
    expect(String(fetchSpy.mock.calls[5][0])).toContain('ranked_keywords');
    expect(bodyOf(5)).toMatchObject({ location_code: CA, language_code: 'fr', target: 'example.com' });

    await provider.getKeywordsForKeywords(['seo'], 'ws-p4-6', 50, undefined, CA, 'fr');
    expect(bodyOf(6)).toMatchObject({ location_code: CA, language_code: 'fr' });

    flushCreditsToDisk();
  });

  it('defaults the domain methods to US (2840) / en when no geo is threaded (flag-OFF parity)', async () => {
    reapplyFsMocks();
    const provider = new DataForSeoProvider();
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce(okEmpty()).mockResolvedValueOnce(okEmpty());
    const bodyOf = (call: number) => JSON.parse((fetchSpy.mock.calls[call][1] as RequestInit).body as string)[0];

    // Pre-P4 call shape: neither database nor geo passed. Exercise a ranked_keywords
    // method AND a separate-endpoint method (competitors_domain) so a per-method
    // omission of the `locationCode ?? locationCodeFromDatabase(database)` default
    // resolution would be caught.
    await provider.getDomainKeywords('example.com', 'ws-p4-default', 50);
    expect(bodyOf(0)).toMatchObject({ location_code: 2840, language_code: 'en' });

    await provider.getCompetitors('example.com', 'ws-p4-default-comp', 10);
    expect(bodyOf(1)).toMatchObject({ location_code: 2840, language_code: 'en' });
    flushCreditsToDisk();
  });

  it('keeps the flag-OFF cache key on the legacy un-versioned database token (no v2 re-warm)', async () => {
    reapplyFsMocks();
    const writeSpy = vi.spyOn(fs, 'writeFileSync');
    const provider = new DataForSeoProvider();
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(okEmpty());
    // No geo → flag-OFF parity. Cache filename must use the legacy `database` token.
    await provider.getDomainKeywords('example.com', 'ws-p4-cache-off', 100);
    const domainWrite = writeSpy.mock.calls.find(c => String(c[0]).includes('domain_ranked'));
    expect(domainWrite).toBeDefined();
    expect(String(domainWrite![0])).toContain('domain_ranked_us_');
    expect(String(domainWrite![0])).not.toContain('v2_');
    flushCreditsToDisk();
  });

  it('versions the flag-ON cache key on v2:<locationCode>:<language> (geo isolation)', async () => {
    reapplyFsMocks();
    const writeSpy = vi.spyOn(fs, 'writeFileSync');
    const provider = new DataForSeoProvider();
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(okEmpty());
    await provider.getDomainKeywords('example.com', 'ws-p4-cache-on', 100, undefined, 2826, 'en');
    const domainWrite = writeSpy.mock.calls.find(c => String(c[0]).includes('domain_ranked'));
    expect(domainWrite).toBeDefined();
    // getCachePath sanitizes ':' → '_', so the v2:2826:en token lands as v2_2826_en.
    expect(String(domainWrite![0])).toContain('domain_ranked_v2_2826_en_');
    flushCreditsToDisk();
  });
});
