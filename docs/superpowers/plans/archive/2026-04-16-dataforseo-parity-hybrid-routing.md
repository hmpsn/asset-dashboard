# DataForSEO Parity Fixes & Hybrid Routing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring DataForSEO provider to feature parity with SEMRush, add L1 cross-workspace cache, fix the KD/difficulty pipeline, surface accurate SERP features, and generalize the capability-fallback routing so any provider gap can fall back to the other provider.

**Architecture:** All changes are isolated to the provider layer (`server/providers/dataforseo-provider.ts`), the provider registry (`server/seo-data-provider.ts`), and the content-brief prompt assembly (`server/content-brief.ts`). No schema migrations or new DB tables are needed — the L1 cache writes to the existing `keyword_metrics_cache` table already used by SEMRush. Tasks 1–3 and 6 all touch `dataforseo-provider.ts` and must run sequentially. Tasks 4 and 5 are independent and can run in parallel with Tasks 1–3.

**Tech Stack:** TypeScript, Express, SQLite (better-sqlite3), DataForSEO REST API, vitest

---

## Pre-requisites

- [ ] Spec confirmed: this plan is derived from the DataForSEO parity spec provided in session 2026-04-16

---

## Task Dependencies

```
Sequential chain (dataforseo-provider.ts edits):
  Task 1 (SERP + lastSeen) → Task 2 (L1 cache) → Task 3 (KD endpoint) → Task 6 (init probe) → Task 7 (generic routing)

Parallel with the above chain (independent files):
  Task 4 (content-brief provider label + results fix)   ∥   Task 5 (BacklinkProfile link types)

Final pass (after all tasks done):
  Task 8 (full quality gate: typecheck + build + test suite)
```

Rules:
- Tasks 2, 3, 6 each depend on the previous task being committed because they all modify `dataforseo-provider.ts`
- Task 7 modifies `seo-data-provider.ts`; Task 6 also touches it (adding `init?()` to the interface). Task 7 must wait for Task 6.
- Tasks 4 and 5 own different files — they can start the moment Task 1 is committed (or even before).

---

## File Ownership

| Task | Owns (create/modify freely) | Must NOT touch |
|------|-----------------------------|----------------|
| 1 | `server/providers/dataforseo-provider.ts`, `tests/unit/dataforseo-provider.test.ts` (create) | seo-data-provider.ts, content-brief.ts |
| 2 | `server/providers/dataforseo-provider.ts`, `server/keyword-metrics-cache.ts` (comment only) | All other files |
| 3 | `server/providers/dataforseo-provider.ts` | All other files |
| 4 | `server/content-brief.ts`, `server/routes/content-requests.ts` | dataforseo-provider.ts, BacklinkProfile.tsx |
| 5 | `src/components/strategy/BacklinkProfile.tsx` | All server files |
| 6 | `server/providers/dataforseo-provider.ts`, `server/seo-data-provider.ts`, `server/app.ts` | content-brief.ts, BacklinkProfile.tsx |
| 7 | `server/seo-data-provider.ts`, `server/routes/keyword-strategy.ts`, `data/roadmap.json` | dataforseo-provider.ts |

---

## Task 1 — SERP item types + lastSeen field fix (Model: haiku)

**Files:**
- Modify: `server/providers/dataforseo-provider.ts:402` (item_types array)
- Modify: `server/providers/dataforseo-provider.ts:417-419` (serpFeaturesMap normalization)
- Modify: `server/providers/dataforseo-provider.ts:697` (lastSeen field)
- Create: `tests/unit/dataforseo-provider.test.ts`

**Context for implementer:**
- `hasSerpOpportunity()` in `server/semrush.ts:610` checks `features.includes('video')` — NOT `'videos'`. The DataForSEO API returns `type: 'videos'` (plural), so you must normalize before storing.
- `lost_date` on a referring domain item is null for ACTIVE backlinks (it records when the link was lost). Replace with `last_visited` (when the crawler last confirmed the link). If that field is also absent, fall back to `first_seen`.
- The `BacklinkProfile.tsx:142` renders `rd.lastSeen` via `new Date(rd.lastSeen).toLocaleDateString()` — if `lastSeen` is `'N/A'`, the `new Date('N/A')` call returns "Invalid Date". The fix makes real dates appear for active backlinks.

- [ ] **Step 1: Create test file with two failing tests**

```typescript
// tests/unit/dataforseo-provider.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Env vars must be set before importing the module
process.env.DATAFORSEO_LOGIN = 'test-login';
process.env.DATAFORSEO_PASSWORD = 'test-password';

// Mock fs so writeCache/readCache don't touch disk
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync: vi.fn().mockReturnValue(false), // always cache miss
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    readFileSync: vi.fn().mockImplementation(() => { throw new Error('ENOENT'); }),
    readdirSync: vi.fn().mockReturnValue([]),
  };
});

// Mock data-dir so UPLOAD_ROOT and CREDIT_DIR don't throw
vi.mock('../../server/data-dir.js', () => ({
  getUploadRoot: () => '/tmp/test-uploads',
  getDataDir: () => '/tmp/test-data',
}));

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
    // API returns two items for the same keyword: one organic, one videos
    mockFetchOnce(dfsTaskResponse([{
      items: [
        {
          keyword_data: { keyword: 'seo tools', keyword_info: { search_volume: 1000, competition: 0.5, cpc: 3.0, monthly_searches: [] } },
          ranked_serp_element: { serp_item: { type: 'organic', rank_group: 1, url: 'https://example.com', etv: 100 } },
        },
        {
          keyword_data: { keyword: 'seo tools', keyword_info: { search_volume: 1000, competition: 0.5, cpc: 3.0, monthly_searches: [] } },
          ranked_serp_element: { serp_item: { type: 'videos', rank_group: 1, url: 'https://example.com', etv: 100 } },
        },
        {
          keyword_data: { keyword: 'seo tools', keyword_info: { search_volume: 1000, competition: 0.5, cpc: 3.0, monthly_searches: [] } },
          ranked_serp_element: { serp_item: { type: 'people_also_ask', rank_group: 1, url: 'https://example.com', etv: 0 } },
        },
      ],
    }]));

    const results = await provider.getDomainKeywords('example.com', 'ws-test-1', 100, 'us');

    expect(results).toHaveLength(1);
    const kw = results[0];
    expect(kw.keyword).toBe('seo tools');
    // 'videos' must be normalized to 'video', 'people_also_ask' must be preserved
    expect(kw.serpFeatures).toContain('video');
    expect(kw.serpFeatures).toContain('people_also_ask');
    expect(kw.serpFeatures).not.toContain('videos'); // raw plural must not appear
  });

  it('maps "people_also_ask" item type into serpFeatures', async () => {
    const provider = new DataForSeoProvider();
    mockFetchOnce(dfsTaskResponse([{
      items: [
        {
          keyword_data: { keyword: 'keyword research', keyword_info: { search_volume: 5000, competition: 0.6, cpc: 2.0, monthly_searches: [] } },
          ranked_serp_element: { serp_item: { type: 'organic', rank_group: 3, url: 'https://example.com/kr', etv: 50 } },
        },
        {
          keyword_data: { keyword: 'keyword research', keyword_info: { search_volume: 5000, competition: 0.6, cpc: 2.0, monthly_searches: [] } },
          ranked_serp_element: { serp_item: { type: 'people_also_ask', rank_group: 3, url: '', etv: 0 } },
        },
      ],
    }]));

    const results = await provider.getDomainKeywords('example.com', 'ws-test-2', 100, 'us');
    expect(results[0].serpFeatures).toContain('people_also_ask');
  });
});

describe('DataForSeoProvider — getReferringDomains lastSeen', () => {
  afterEach(() => vi.restoreAllMocks());

  it('uses last_visited instead of lost_date for active backlinks', async () => {
    const provider = new DataForSeoProvider();
    mockFetchOnce(dfsTaskResponse([{
      items: [
        {
          domain: 'example.org',
          backlinks: 5,
          first_seen: '2024-01-15T00:00:00.000Z',
          last_visited: '2026-04-10T00:00:00.000Z',
          lost_date: null, // active backlink — lost_date is null
        },
      ],
    }]));

    const results = await provider.getReferringDomains('example.com', 'ws-test-3');
    expect(results).toHaveLength(1);
    expect(results[0].lastSeen).toBe('2026-04-10T00:00:00.000Z');
    expect(results[0].lastSeen).not.toBe('N/A');
  });

  it('falls back to first_seen when last_visited is absent', async () => {
    const provider = new DataForSeoProvider();
    mockFetchOnce(dfsTaskResponse([{
      items: [
        {
          domain: 'fallback.org',
          backlinks: 2,
          first_seen: '2023-06-01T00:00:00.000Z',
          last_visited: undefined,
          lost_date: null,
        },
      ],
    }]));

    const results = await provider.getReferringDomains('example.com', 'ws-test-4');
    expect(results[0].lastSeen).toBe('2023-06-01T00:00:00.000Z');
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd /Users/joshuahampson/CascadeProjects/asset-dashboard
npx vitest run tests/unit/dataforseo-provider.test.ts --reporter=verbose
```

Expected: 4 failures (field not changed yet, `videos` not normalized, `lost_date` still used).

- [ ] **Step 3: Implement Change 1 — SERP item_types expansion**

In `server/providers/dataforseo-provider.ts`, change line 402:

```typescript
// BEFORE
item_types: ['organic', 'featured_snippet', 'local_pack'],

// AFTER
item_types: ['organic', 'featured_snippet', 'local_pack', 'people_also_ask', 'videos'],
```

Then change lines 416-419 (the serpFeaturesMap add):

```typescript
// BEFORE
const itemType = (serpItem?.type as string) ?? 'organic';
if (keyword && itemType !== 'organic') {
  if (!serpFeaturesMap.has(keyword)) serpFeaturesMap.set(keyword, new Set());
  serpFeaturesMap.get(keyword)!.add(itemType);
}

// AFTER
const itemType = (serpItem?.type as string) ?? 'organic';
if (keyword && itemType !== 'organic') {
  if (!serpFeaturesMap.has(keyword)) serpFeaturesMap.set(keyword, new Set());
  const normalizedType = itemType === 'videos' ? 'video' : itemType;
  serpFeaturesMap.get(keyword)!.add(normalizedType);
}
```

- [ ] **Step 4: Implement Change 2 — lastSeen field fix**

In `server/providers/dataforseo-provider.ts`, change line 697:

```typescript
// BEFORE
lastSeen: (item.lost_date as string) ?? 'N/A',

// AFTER
lastSeen: (item.last_visited as string) ?? (item.first_seen as string) ?? 'N/A',
```

- [ ] **Step 5: Run tests to confirm they pass**

```bash
npx vitest run tests/unit/dataforseo-provider.test.ts --reporter=verbose
```

Expected: all 4 tests PASS.

- [ ] **Step 6: Typecheck**

```bash
npm run typecheck
```

Expected: zero errors.

- [ ] **Step 7: Commit**

```bash
git add server/providers/dataforseo-provider.ts tests/unit/dataforseo-provider.test.ts
git commit -m "fix: SERP item types (people_also_ask + videos) and lastSeen field in DataForSEO provider"
```

---

## Task 2 — L1 global SQLite cache for DataForSEO keyword metrics (Model: sonnet)

**Files:**
- Modify: `server/providers/dataforseo-provider.ts` (getKeywordMetrics, imports)
- Modify: `server/keyword-metrics-cache.ts` (header comment only)

**Context for implementer:**
- The existing `keyword_metrics_cache` SQLite table is already used by SEMRush (L1 → L2 → API). DataForSEO currently only has L2 (per-workspace file cache) → API.
- The goal: add L1 check AFTER the L2 file-cache loop (for already-uncached items), using `getCachedMetricsBatch(uncached, database, CACHE_TTL_KEYWORD)`. This means the order is L2 → L1 → API.
- After API results are received and metrics objects are built, batch-write them to the global cache via `cacheMetricsBatch(batchResults, database)`.
- `CACHE_TTL_KEYWORD` is already defined in this file as `720` (30 days) — use it for both L2 and L1 lookups.
- `cacheMetricsBatch` accepts `CachedKeywordMetrics[]` which has the same shape as `KeywordMetrics` — you can cast directly.

- [ ] **Step 1: Add failing test for L1 cache cross-workspace hit**

Append to `tests/unit/dataforseo-provider.test.ts`:

```typescript
import { getCachedMetrics, cacheMetrics } from '../../server/keyword-metrics-cache.js';

describe('DataForSeoProvider — L1 global SQLite cache', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns L1-cached metrics without making an API call', async () => {
    // Pre-seed the L1 cache directly
    cacheMetrics({
      keyword: 'cached keyword',
      volume: 9999,
      difficulty: 42,
      cpc: 1.5,
      competition: 0.3,
      results: 0,
      trend: [100, 200],
    }, 'us');

    const provider = new DataForSeoProvider();
    const fetchSpy = vi.spyOn(global, 'fetch');

    const results = await provider.getKeywordMetrics(['cached keyword'], 'ws-workspace-A', 'us');

    expect(fetchSpy).not.toHaveBeenCalled(); // no API call
    expect(results).toHaveLength(1);
    expect(results[0].volume).toBe(9999);
    expect(results[0].difficulty).toBe(42);
  });

  it('writes API results to L1 cache so a second workspace hits it', async () => {
    const provider = new DataForSeoProvider();
    // First workspace: API call needed (no L2 or L1 cache)
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(dfsTaskResponse([
        { keyword: 'fresh keyword', search_volume: 5000, competition_index: 0, cpc: 2.0, competition: 0.4, monthly_searches: [] },
      ])),
    } as Response);
    // Also mock the KD endpoint (returns null result fine)
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(dfsTaskResponse([
        { keyword: 'fresh keyword', keyword_difficulty: 55 },
      ])),
    } as Response);

    await provider.getKeywordMetrics(['fresh keyword'], 'ws-first', 'us');

    // Second workspace: should hit L1, no API call
    const fetchSpy2 = vi.spyOn(global, 'fetch');
    const results2 = await provider.getKeywordMetrics(['fresh keyword'], 'ws-second', 'us');

    expect(fetchSpy2).not.toHaveBeenCalled();
    expect(results2[0].volume).toBe(5000);
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npx vitest run tests/unit/dataforseo-provider.test.ts -t "L1 global SQLite cache" --reporter=verbose
```

Expected: FAIL — `getCachedMetricsBatch` not yet consulted, fetch still called.

- [ ] **Step 3: Add imports to dataforseo-provider.ts**

At the top of `server/providers/dataforseo-provider.ts`, after the existing imports:

```typescript
import { getCachedMetricsBatch, cacheMetricsBatch } from '../keyword-metrics-cache.js';
```

- [ ] **Step 4: Add L1 check in getKeywordMetrics() after the L2 file-cache loop**

The current structure after the L2 loop (lines ~241-249) looks like:

```typescript
if (uncached.length === 0 || areCreditsExhausted()) return results;

// Batch up to 1000 per request
const batches: string[][] = [];
...
```

Replace with:

```typescript
if (uncached.length === 0 || areCreditsExhausted()) return results;

// L1: Check global SQLite cache for keywords that missed L2
const globalHits = getCachedMetricsBatch(uncached, database, CACHE_TTL_KEYWORD);
const stillUncached: string[] = [];
for (const kw of uncached) {
  const hit = globalHits.get(kw.toLowerCase());
  if (hit) {
    results.push(hit as KeywordMetrics);
    logCreditUsage({ credits: 0, endpoint: 'search_volume', query: kw, rowsReturned: 1, workspaceId, cached: true });
  } else {
    stillUncached.push(kw);
  }
}

if (stillUncached.length === 0) return results;

// Batch up to 1000 per request
const batches: string[][] = [];
for (let i = 0; i < stillUncached.length; i += 1000) {
  batches.push(stillUncached.slice(i, i + 1000));
}
```

Also update the inner batch loop to use `stillUncached` — change:
```typescript
for (const batch of batches) {
```
(This already references `batches` which now iterates `stillUncached`, so no other variable references need changing inside the loop.)

- [ ] **Step 5: Write results to L1 cache after API call**

Inside the batch loop, after `results.push(metrics)` and `writeCache(...)`, add a `batchResults` accumulator. Change the batch loop to:

```typescript
for (const batch of batches) {
  try {
    const json = await apiCall('keywords_data/google_ads/search_volume/live', [{
      keywords: batch,
      location_code: locationCode(database),
      language_code: 'en',
    }]);

    const taskResults = getTaskResult(json);
    const cost = getTaskCost(json);
    const batchResults: KeywordMetrics[] = [];  // ← new accumulator

    for (const item of taskResults) {
      const keyword = item.keyword as string;
      const searchVolume = (item.search_volume as number) ?? 0;
      const competitionIndex = (item.competition_index as number) ?? 0;
      const cpc = (item.cpc as number) ?? 0;
      const competition = (item.competition as number) ?? 0;
      const monthlies = item.monthly_searches as Array<{ search_volume: number }> | undefined;
      const trend = monthlies ? monthlies.map(m => m.search_volume ?? 0) : [];

      const metrics: KeywordMetrics = {
        keyword,
        volume: searchVolume,
        difficulty: competitionIndex,
        cpc,
        competition: typeof competition === 'number' ? competition : 0,
        results: 0,
        trend,
      };

      results.push(metrics);
      batchResults.push(metrics);  // ← accumulate
      const cacheKey = `kw_${database}_${keyword.toLowerCase().replace(/\s+/g, '_')}`;
      writeCache(workspaceId, cacheKey, metrics);
    }

    cacheMetricsBatch(batchResults, database);  // ← write to L1 after batch
    logCreditUsage({ credits: cost, endpoint: 'search_volume', query: batch.join(',').slice(0, 100), rowsReturned: taskResults.length, workspaceId, cached: false });
  } catch (err) {
    log.error({ err }, 'DataForSEO search_volume error');
  }
}
```

- [ ] **Step 6: Update keyword-metrics-cache.ts header comment**

Change line 3 of `server/keyword-metrics-cache.ts`:

```typescript
// BEFORE
 * keyword-metrics-cache — Global cross-workspace cache for SEMRush keyword metrics.

// AFTER
 * keyword-metrics-cache — Global cross-workspace cache for keyword metrics.
```

- [ ] **Step 7: Run tests to confirm they pass**

```bash
npx vitest run tests/unit/dataforseo-provider.test.ts --reporter=verbose
```

Expected: all tests PASS (including new L1 tests and previous Task 1 tests).

- [ ] **Step 8: Typecheck**

```bash
npm run typecheck
```

Expected: zero errors.

- [ ] **Step 9: Commit**

```bash
git add server/providers/dataforseo-provider.ts server/keyword-metrics-cache.ts tests/unit/dataforseo-provider.test.ts
git commit -m "feat: add L1 global SQLite cache to DataForSEO keyword metrics"
```

---

## Task 3 — Fix difficulty to use keyword_difficulty endpoint (Model: sonnet)

**Files:**
- Modify: `server/providers/dataforseo-provider.ts` (getKeywordMetrics + getRelatedKeywords + getQuestionKeywords + getDomainKeywords)

**Context for implementer:**
- Currently `difficulty` in `getKeywordMetrics` is set to `competitionIndex` (`competition_index`), which is Google Ads paid competition — NOT organic keyword difficulty. DataForSEO has a dedicated `dataforseo_labs/google/keyword_difficulty/live` endpoint.
- Make the existing `keywords_data/google_ads/search_volume/live` call and the new `dataforseo_labs/google/keyword_difficulty/live` call in `Promise.all`. The KD call is `.catch(() => null)` so a missing subscription doesn't break volume data.
- The KD response has `tasks[0].result[]` where each item has `{ keyword: string, keyword_difficulty: number }`.
- For `getRelatedKeywords`, `getQuestionKeywords`, and `getDomainKeywords`: the DataForSEO Labs endpoints (`related_keywords`, `keyword_suggestions`, `ranked_keywords`) include `keyword_info` objects. Check if `kwInfo?.keyword_difficulty` is present — if so, use it. These endpoints DO include `keyword_difficulty` in `keyword_info` per item (confirmed by DataForSEO API docs).
- `CACHE_TTL_KEYWORD` = 720 hours. After implementing, the L2 file cache and L1 SQLite cache will store the corrected difficulty.

- [ ] **Step 1: Add failing test for difficulty field**

Append to `tests/unit/dataforseo-provider.test.ts`:

```typescript
describe('DataForSeoProvider — keyword difficulty endpoint', () => {
  afterEach(() => vi.restoreAllMocks());

  it('uses keyword_difficulty from KD endpoint instead of competition_index', async () => {
    const provider = new DataForSeoProvider();

    // Mock: first call = volume endpoint, second call = KD endpoint
    vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(dfsTaskResponse([
          { keyword: 'buy shoes online', search_volume: 8000, competition_index: 20, cpc: 1.5, competition: 0.2, monthly_searches: [] },
        ])),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(dfsTaskResponse([
          { keyword: 'buy shoes online', keyword_difficulty: 73 },
        ])),
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
        json: () => Promise.resolve(dfsTaskResponse([
          { keyword: 'some keyword', search_volume: 1000, competition_index: 45, cpc: 0.5, competition: 0.45, monthly_searches: [] },
        ])),
      } as Response)
      .mockRejectedValueOnce(new Error('KD endpoint unavailable')); // KD call fails

    const results = await provider.getKeywordMetrics(['some keyword'], 'ws-kd-fallback', 'us');
    expect(results[0].difficulty).toBe(45); // falls back to competition_index
  });

  it('uses keyword_difficulty from keyword_info in getRelatedKeywords', async () => {
    const provider = new DataForSeoProvider();

    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(dfsTaskResponse([{
        items: [{
          keyword_data: {
            keyword: 'related seo',
            keyword_info: { search_volume: 2000, competition: 0.5, cpc: 1.0, keyword_difficulty: 61 },
          },
        }],
      }])),
    } as Response);

    const results = await provider.getRelatedKeywords('seo', 'ws-related', 5, 'us');
    expect(results[0].difficulty).toBe(61);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx vitest run tests/unit/dataforseo-provider.test.ts -t "keyword difficulty endpoint" --reporter=verbose
```

Expected: all 3 FAIL.

- [ ] **Step 3: Refactor getKeywordMetrics() to use parallel KD call**

In `server/providers/dataforseo-provider.ts`, inside the batch loop in `getKeywordMetrics()`, replace the single `apiCall` with `Promise.all`:

```typescript
for (const batch of batches) {
  try {
    const [volumeJson, kdJson] = await Promise.all([
      apiCall('keywords_data/google_ads/search_volume/live', [{
        keywords: batch,
        location_code: locationCode(database),
        language_code: 'en',
      }]),
      apiCall('dataforseo_labs/google/keyword_difficulty/live', [{
        keywords: batch,
        location_code: locationCode(database),
        language_code: 'en',
      }]).catch(() => null),
    ]);

    // Build KD lookup map
    const kdMap = new Map<string, number>();
    if (kdJson) {
      const kdResults = getTaskResult(kdJson);
      for (const item of kdResults) {
        const kw = item.keyword as string;
        const kd = item.keyword_difficulty as number;
        if (kw && typeof kd === 'number') kdMap.set(kw.toLowerCase(), kd);
      }
      const kdCost = getTaskCost(kdJson);
      if (kdCost > 0) {
        logCreditUsage({ credits: kdCost, endpoint: 'keyword_difficulty', query: batch.join(',').slice(0, 100), rowsReturned: kdResults.length, workspaceId, cached: false });
      }
    }

    const taskResults = getTaskResult(volumeJson);
    const cost = getTaskCost(volumeJson);
    const batchResults: KeywordMetrics[] = [];

    for (const item of taskResults) {
      const keyword = item.keyword as string;
      const searchVolume = (item.search_volume as number) ?? 0;
      const competitionIndex = (item.competition_index as number) ?? 0;
      const cpc = (item.cpc as number) ?? 0;
      const competition = (item.competition as number) ?? 0;
      const monthlies = item.monthly_searches as Array<{ search_volume: number }> | undefined;
      const trend = monthlies ? monthlies.map(m => m.search_volume ?? 0) : [];

      const metrics: KeywordMetrics = {
        keyword,
        volume: searchVolume,
        difficulty: kdMap.get(keyword.toLowerCase()) ?? competitionIndex,
        cpc,
        competition: typeof competition === 'number' ? competition : 0,
        results: 0,
        trend,
      };

      results.push(metrics);
      batchResults.push(metrics);
      const cacheKey = `kw_${database}_${keyword.toLowerCase().replace(/\s+/g, '_')}`;
      writeCache(workspaceId, cacheKey, metrics);
    }

    cacheMetricsBatch(batchResults, database);
    logCreditUsage({ credits: cost, endpoint: 'search_volume', query: batch.join(',').slice(0, 100), rowsReturned: taskResults.length, workspaceId, cached: false });
  } catch (err) {
    log.error({ err }, 'DataForSEO search_volume error');
  }
}
```

- [ ] **Step 4: Update getRelatedKeywords() to use keyword_difficulty from keyword_info**

In `getRelatedKeywords()`, change the `difficulty` field in the results mapping (currently around line 326):

```typescript
// BEFORE
difficulty: Math.round(((kwInfo?.competition as number) ?? 0) * 100),

// AFTER
difficulty: (kwInfo?.keyword_difficulty as number) ?? Math.round(((kwInfo?.competition as number) ?? 0) * 100),
```

- [ ] **Step 5: Update getQuestionKeywords() to use keyword_difficulty from keyword_info**

In `getQuestionKeywords()`, change the `difficulty` field in the results mapping (currently around line 370):

```typescript
// BEFORE
difficulty: Math.round(((kwInfo?.competition as number) ?? 0) * 100),

// AFTER
difficulty: (kwInfo?.keyword_difficulty as number) ?? Math.round(((kwInfo?.competition as number) ?? 0) * 100),
```

- [ ] **Step 6: Update getDomainKeywords() to use keyword_difficulty from keyword_info**

In `getDomainKeywords()`, change the `difficulty` field in the results build (currently around line 446):

```typescript
// BEFORE
difficulty: Math.round(((kwInfo?.competition as number) ?? 0) * 100),

// AFTER
difficulty: (kwInfo?.keyword_difficulty as number) ?? Math.round(((kwInfo?.competition as number) ?? 0) * 100),
```

- [ ] **Step 7: Run full test suite**

```bash
npx vitest run tests/unit/dataforseo-provider.test.ts --reporter=verbose
```

Expected: all tests PASS.

- [ ] **Step 8: Typecheck**

```bash
npm run typecheck
```

Expected: zero errors.

- [ ] **Step 9: Commit**

```bash
git add server/providers/dataforseo-provider.ts tests/unit/dataforseo-provider.test.ts
git commit -m "fix: use keyword_difficulty endpoint instead of competition_index in DataForSEO provider"
```

---

## Task 4 — Content brief provider label + results=0 fix (Model: sonnet)

**Files:**
- Modify: `server/content-brief.ts` (interface, local variables, prompt strings)
- Modify: `server/routes/content-briefs.ts` (local variables, generateBrief call-site field names)
- Modify: `server/routes/content-requests.ts` (local variables, generateBrief call-site field names)

**Context for implementer:**
- `generateBrief()` context interface (line 838) has fields `semrushMetrics?: KeywordMetrics` and `semrushRelated?: RelatedKeyword[]`. Rename them to `keywordMetrics` and `relatedKeywords` respectively. ALL callers must be updated.
- **Two routes** pass these fields: `server/routes/content-briefs.ts` (lines 100-101 vars, lines 176-177 call-site) AND `server/routes/content-requests.ts` (lines 203-204 vars, lines 241-242 call-site). Both must be updated or TypeScript will fail.
- Inside `generateBrief()`, the local variable `semrushBlock` conflicts with the existing `keywordBlock` variable (which holds formatted workspace keyword data). Rename `semrushBlock` to `providerMetricsBlock` to avoid the naming collision.
- Add `providerLabel?: string` to the context interface. Inside the function, derive: `const providerLabel = context.providerLabel ?? 'SEMRush';`
- The prompt currently hardcodes `"from SEMRush"` on two lines (1005 and 1016). Replace with `providerLabel`.
- DataForSEO always sets `results: 0`. Conditionally omit the "Total results" line when `m.results === 0`.
- In both route files: rename local vars `semrushMetrics` → `keywordMetrics` and `semrushRelated` → `relatedKeywords`. Pass `providerLabel: seoProvider?.name === 'dataforseo' ? 'DataForSEO' : 'SEMRush'` in the `generateBrief` call.

- [ ] **Step 1: Write failing test for provider label in prompt**

Create `tests/unit/content-brief-provider-label.test.ts`:

```typescript
/**
 * Tests that generateBrief() prompt assembly uses the provider label
 * from context instead of hardcoding "SEMRush", and omits "Total results"
 * when results = 0.
 *
 * Strategy: spy on callOpenAI to capture the prompt, then assert on the prompt string.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

// Mock openai-helpers so no real API call is made
vi.mock('../../server/openai-helpers.js', () => ({
  callOpenAI: vi.fn(),
}));
// Mock broadcast to avoid init errors
vi.mock('../../server/broadcast.js', () => ({
  setBroadcast: vi.fn(),
  broadcast: vi.fn(),
  broadcastToWorkspace: vi.fn(),
}));

import { callOpenAI } from '../../server/openai-helpers.js';
import { generateBrief } from '../../server/content-brief.js';

const mockCallOpenAI = vi.mocked(callOpenAI);

// Return a minimal valid brief JSON
const MOCK_BRIEF = JSON.stringify({
  suggestedTitle: 'Test Title',
  suggestedMetaDesc: 'Test meta',
  executiveSummary: 'Test summary',
  contentFormat: 'blog',
  toneAndStyle: 'professional',
  wordCountTarget: 1500,
  intent: 'informational',
  audience: 'marketers',
  secondaryKeywords: [],
  outline: [],
  peopleAlsoAsk: [],
  topicalEntities: [],
  competitorInsights: '',
  internalLinkSuggestions: [],
  ctaRecommendations: [],
  eeatGuidance: null,
  contentChecklist: [],
  schemaRecommendations: [],
  keywordValidation: null,
  realTopResults: [],
  realPeopleAlsoAsk: [],
  serpAnalysis: null,
});

// A real workspaceId won't exist but generateBrief only reads seoContext from intelligence
// which gracefully returns empty for unknown workspace IDs
const WS_ID = 'test-ws-content-brief-label';

describe('generateBrief — provider label', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('uses DataForSEO as provider label when specified', async () => {
    mockCallOpenAI.mockResolvedValue({ content: MOCK_BRIEF, usage: { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300 } });

    await generateBrief(WS_ID, 'test keyword', {
      keywordMetrics: { keyword: 'test keyword', volume: 5000, difficulty: 55, cpc: 2.0, competition: 0.5, results: 0, trend: [] },
      relatedKeywords: [],
      providerLabel: 'DataForSEO',
    }).catch(() => {}); // brief save to DB may fail in test — we only care about the prompt call

    const calls = mockCallOpenAI.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const promptArg = JSON.stringify(calls[0]);
    expect(promptArg).toContain('DataForSEO');
    expect(promptArg).not.toContain('from SEMRush');
  });

  it('omits "Total results" line when results = 0', async () => {
    mockCallOpenAI.mockResolvedValue({ content: MOCK_BRIEF, usage: { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300 } });

    await generateBrief(WS_ID, 'zero results kw', {
      keywordMetrics: { keyword: 'zero results kw', volume: 1000, difficulty: 30, cpc: 0.5, competition: 0.3, results: 0, trend: [] },
      providerLabel: 'DataForSEO',
    }).catch(() => {});

    const promptArg = JSON.stringify(mockCallOpenAI.mock.calls[0]);
    expect(promptArg).not.toContain('Total results');
  });

  it('includes "Total results" line when results > 0', async () => {
    mockCallOpenAI.mockResolvedValue({ content: MOCK_BRIEF, usage: { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300 } });

    await generateBrief(WS_ID, 'has results kw', {
      keywordMetrics: { keyword: 'has results kw', volume: 1000, difficulty: 30, cpc: 0.5, competition: 0.3, results: 4500000, trend: [] },
      providerLabel: 'SEMRush',
    }).catch(() => {});

    const promptArg = JSON.stringify(mockCallOpenAI.mock.calls[0]);
    expect(promptArg).toContain('Total results');
    expect(promptArg).toContain('4,500,000');
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx vitest run tests/unit/content-brief-provider-label.test.ts --reporter=verbose
```

Expected: FAIL — field names not renamed yet, label hardcoded.

- [ ] **Step 3: Update generateBrief context interface in content-brief.ts**

In `server/content-brief.ts`, update the context object type inside `generateBrief` (lines 838-839):

```typescript
// BEFORE
    semrushMetrics?: KeywordMetrics;
    semrushRelated?: RelatedKeyword[];

// AFTER
    keywordMetrics?: KeywordMetrics;
    relatedKeywords?: RelatedKeyword[];
    providerLabel?: string;
```

- [ ] **Step 4: Update generateBrief function body in content-brief.ts**

In the function body, near where `semrushBlock` is built (around line 1001):

```typescript
// BEFORE
  let semrushBlock = '';
  if (context.semrushMetrics) {
    const m = context.semrushMetrics;
    semrushBlock += `\n\nREAL KEYWORD DATA (from SEMRush — use these exact numbers, do NOT hallucinate different values):
- Monthly search volume: ${m.volume.toLocaleString()}
- Keyword difficulty: ${m.difficulty}/100
- CPC: $${m.cpc.toFixed(2)}
- Competition: ${m.competition.toFixed(2)}
- Total results: ${m.results.toLocaleString()}`;
    if (m.trend?.length) {
      semrushBlock += `\n- 12-month volume trend: ${m.trend.join(', ')}`;
    }
  }
  if (context.semrushRelated?.length) {
    semrushBlock += `\n\nRELATED KEYWORDS (from SEMRush — real data, use for secondary keywords and topical entities):\n`;
    semrushBlock += context.semrushRelated.slice(0, 15)
      .map(r => `"${r.keyword}" (vol: ${r.volume.toLocaleString()}, KD: ${r.difficulty}, CPC: $${r.cpc.toFixed(2)})`)
      .join('\n');
  }

// AFTER
  const providerLabel = context.providerLabel ?? 'SEMRush';
  let providerMetricsBlock = '';
  if (context.keywordMetrics) {
    const m = context.keywordMetrics;
    providerMetricsBlock += `\n\nREAL KEYWORD DATA (from ${providerLabel} — use these exact numbers, do NOT hallucinate different values):
- Monthly search volume: ${m.volume.toLocaleString()}
- Keyword difficulty: ${m.difficulty}/100
- CPC: $${m.cpc.toFixed(2)}
- Competition: ${m.competition.toFixed(2)}`;
    if (m.results > 0) {
      providerMetricsBlock += `\n- Total results: ${m.results.toLocaleString()}`;
    }
    if (m.trend?.length) {
      providerMetricsBlock += `\n- 12-month volume trend: ${m.trend.join(', ')}`;
    }
  }
  if (context.relatedKeywords?.length) {
    providerMetricsBlock += `\n\nRELATED KEYWORDS (from ${providerLabel} — real data, use for secondary keywords and topical entities):\n`;
    providerMetricsBlock += context.relatedKeywords.slice(0, 15)
      .map(r => `"${r.keyword}" (vol: ${r.volume.toLocaleString()}, KD: ${r.difficulty}, CPC: $${r.cpc.toFixed(2)})`)
      .join('\n');
  }
```

- [ ] **Step 5: Update the prompt assembly line in content-brief.ts**

The final prompt string (line 1108) references `${semrushBlock}`. Change it to `${providerMetricsBlock}`.

Run:
```bash
grep -n 'semrushBlock' server/content-brief.ts
```

Replace every occurrence of `semrushBlock` with `providerMetricsBlock` (there should be only the one remaining usage in the template literal).

- [ ] **Step 6: Update content-briefs.ts — rename local vars and pass providerLabel**

In `server/routes/content-briefs.ts`, find and update (around lines 100-112 and 172-185):

```typescript
// BEFORE (lines 100-101)
    let semrushMetrics: KeywordMetrics | undefined;
    let semrushRelated: RelatedKeyword[] | undefined;
    const seoProvider = getConfiguredProvider(ws?.seoDataProvider);
    if (seoProvider) {
      try {
        const [metrics, related] = await Promise.all([
          seoProvider.getKeywordMetrics([targetKeyword], req.params.workspaceId),
          seoProvider.getRelatedKeywords(targetKeyword, req.params.workspaceId, 15),
        ]);
        if (metrics.length > 0) semrushMetrics = metrics[0];
        if (related.length > 0) semrushRelated = related;
      } catch (e) { log.error({ err: e }, 'SEO keyword enrichment error'); }
    }

// AFTER
    let keywordMetrics: KeywordMetrics | undefined;
    let relatedKeywords: RelatedKeyword[] | undefined;
    const seoProvider = getConfiguredProvider(ws?.seoDataProvider);
    const providerLabel = seoProvider?.name === 'dataforseo' ? 'DataForSEO' : 'SEMRush';
    if (seoProvider) {
      try {
        const [metrics, related] = await Promise.all([
          seoProvider.getKeywordMetrics([targetKeyword], req.params.workspaceId),
          seoProvider.getRelatedKeywords(targetKeyword, req.params.workspaceId, 15),
        ]);
        if (metrics.length > 0) keywordMetrics = metrics[0];
        if (related.length > 0) relatedKeywords = related;
      } catch (e) { log.error({ err: e }, 'SEO keyword enrichment error'); }
    }
```

Then update the `generateBrief` call-site (around line 172):

```typescript
// BEFORE
    const brief = await generateBrief(req.params.workspaceId, targetKeyword, {
      relatedQueries,
      businessContext: adaptedBusinessContext,
      existingPages,
      semrushMetrics,
      semrushRelated,

// AFTER
    const brief = await generateBrief(req.params.workspaceId, targetKeyword, {
      relatedQueries,
      businessContext: adaptedBusinessContext,
      existingPages,
      keywordMetrics,
      relatedKeywords,
      providerLabel,
```

- [ ] **Step 7: Update content-requests.ts — rename local vars and pass providerLabel**

In `server/routes/content-requests.ts`, find and update (around lines 203-214 and 237-242):

```typescript
// BEFORE
    let semrushMetrics: KeywordMetrics | undefined;
    let semrushRelated: RelatedKeyword[] | undefined;
    const seoProvider = getConfiguredProvider(ws?.seoDataProvider);
    if (seoProvider) {
      try {
        const [metrics, related] = await Promise.all([
          seoProvider.getKeywordMetrics([request.targetKeyword], req.params.workspaceId),
          seoProvider.getRelatedKeywords(request.targetKeyword, req.params.workspaceId, 15),
        ]);
        if (metrics.length > 0) semrushMetrics = metrics[0];
        if (related.length > 0) semrushRelated = related;
      } catch (e) { log.error({ err: e }, 'SEO keyword enrichment error'); }
    }

// AFTER
    let keywordMetrics: KeywordMetrics | undefined;
    let relatedKeywords: RelatedKeyword[] | undefined;
    const seoProvider = getConfiguredProvider(ws?.seoDataProvider);
    const providerLabel = seoProvider?.name === 'dataforseo' ? 'DataForSEO' : 'SEMRush';
    if (seoProvider) {
      try {
        const [metrics, related] = await Promise.all([
          seoProvider.getKeywordMetrics([request.targetKeyword], req.params.workspaceId),
          seoProvider.getRelatedKeywords(request.targetKeyword, req.params.workspaceId, 15),
        ]);
        if (metrics.length > 0) keywordMetrics = metrics[0];
        if (related.length > 0) relatedKeywords = related;
      } catch (e) { log.error({ err: e }, 'SEO keyword enrichment error'); }
    }
```

Then update the `generateBrief` call-site (around line 237):

```typescript
// BEFORE
    const brief = await generateBrief(req.params.workspaceId, request.targetKeyword, {
      relatedQueries,
      businessContext: ws.keywordStrategy?.businessContext || '',
      existingPages,
      semrushMetrics,
      semrushRelated,

// AFTER
    const brief = await generateBrief(req.params.workspaceId, request.targetKeyword, {
      relatedQueries,
      businessContext: ws.keywordStrategy?.businessContext || '',
      existingPages,
      keywordMetrics,
      relatedKeywords,
      providerLabel,
```

- [ ] **Step 8: Run tests**

```bash
npx vitest run tests/unit/content-brief-provider-label.test.ts --reporter=verbose
```

Expected: all 3 tests PASS.

- [ ] **Step 9: Typecheck**

```bash
npm run typecheck
```

Expected: zero errors. If TypeScript reports unused `semrushMetrics`/`semrushRelated` fields anywhere else, update them.

- [ ] **Step 10: Commit**

```bash
git add server/content-brief.ts server/routes/content-briefs.ts server/routes/content-requests.ts tests/unit/content-brief-provider-label.test.ts
git commit -m "fix: content brief uses dynamic provider label and omits results=0 for DataForSEO"
```

---

## Task 5 — BacklinkProfile link types conditional hide (Model: haiku)

**Files:**
- Modify: `src/components/strategy/BacklinkProfile.tsx`

**Context for implementer:**
- DataForSEO's `backlinks/summary` endpoint does not break down links by type (text/image/form/frame). The `BacklinksOverview` shape has `textLinks: 0, imageLinks: 0, formLinks: 0, frameLinks: 0` hardcoded. The "Link Types" stat card renders "0 text" / "0 image" which is misleading for DataForSEO workspaces.
- The fix is Option B: conditionally hide the stat card when all values are 0. The component is at `src/components/strategy/BacklinkProfile.tsx:108`.
- The `<StatCard>` component is from `src/components/ui/`. Do not hand-roll a replacement.

- [ ] **Step 1: Write failing component test**

Create `tests/component/BacklinkProfile-link-types.test.tsx`:

```typescript
/**
 * Tests that the BacklinkProfile "Link Types" stat card is hidden
 * when all link type counts are 0 (DataForSEO case).
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import BacklinkProfile from '../../src/components/strategy/BacklinkProfile.js';

// Minimal props shape — BacklinkProfile takes overview + referringDomains
const baseOverview = {
  totalBacklinks: 1000,
  referringDomains: 50,
  followLinks: 800,
  nofollowLinks: 200,
  textLinks: 0,
  imageLinks: 0,
  formLinks: 0,
  frameLinks: 0,
};

describe('BacklinkProfile — link types stat card', () => {
  it('hides Link Types card when all link type counts are 0', () => {
    render(
      <BacklinkProfile
        overview={baseOverview}
        referringDomains={[]}
        domain="example.com"
        loading={false}
      />
    );
    expect(screen.queryByText('Link Types')).toBeNull();
  });

  it('shows Link Types card when textLinks > 0', () => {
    render(
      <BacklinkProfile
        overview={{ ...baseOverview, textLinks: 750, imageLinks: 50 }}
        referringDomains={[]}
        domain="example.com"
        loading={false}
      />
    );
    expect(screen.getByText('Link Types')).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npx vitest run tests/component/BacklinkProfile-link-types.test.tsx --reporter=verbose
```

Expected: FAIL — card currently always renders.

- [ ] **Step 3: Add conditional in BacklinkProfile.tsx**

In `src/components/strategy/BacklinkProfile.tsx`, wrap the Link Types stat card (line 108) with a conditional:

```tsx
// BEFORE
        <StatCard label="Link Types" value={`${fmtNum(overview.textLinks)} text`} sub={`${fmtNum(overview.imageLinks)} image`} icon={ExternalLink} />

// AFTER
        {(overview.textLinks > 0 || overview.imageLinks > 0) && (
          <StatCard label="Link Types" value={`${fmtNum(overview.textLinks)} text`} sub={`${fmtNum(overview.imageLinks)} image`} icon={ExternalLink} />
        )}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx vitest run tests/component/BacklinkProfile-link-types.test.tsx --reporter=verbose
```

Expected: both tests PASS.

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck
```

Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/strategy/BacklinkProfile.tsx tests/component/BacklinkProfile-link-types.test.tsx
git commit -m "fix: hide Link Types stat card when all values are 0 (DataForSEO backlinks)"
```

---

## Task 6 — DataForSEO proactive init capability probe (Model: sonnet)

**Context for implementer:**
- Currently, DataForSEO discovers a missing backlinks subscription AFTER a failed API call (it catches the 403/40204 error in `getBacklinksOverview()`). This wastes one paid API call and adds latency.
- Add an `init()` method that probes the backlinks endpoint at startup with a cheap call (`target: 'example.com'`). If it gets a subscription error, it calls `markBacklinksDisabled()` immediately.
- The `SeoDataProvider` interface (line 95 in `seo-data-provider.ts`) needs an optional `init?(): Promise<void>` method.
- In `server/app.ts`, call `dfsProv.init().catch(...)` non-blocking after registration. The `DataForSeoProvider` instance is created inline — capture it in a variable first.
- `isSubscriptionError()` and `markBacklinksDisabled()` already exist in `dataforseo-provider.ts`. Use them.
- `isConfigured()` must be checked inside `init()` to avoid probe calls when no credentials are set.

**Files:**
- Modify: `server/providers/dataforseo-provider.ts` (add init() method)
- Modify: `server/seo-data-provider.ts` (add optional init?() to interface)
- Modify: `server/app.ts` (call init() non-blocking after registration)

- [ ] **Step 1: Add failing test for init() behavior**

Append to `tests/unit/dataforseo-provider.test.ts`:

```typescript
import { isCapabilityDisabled } from '../../server/seo-data-provider.js';

describe('DataForSeoProvider — init() capability probe', () => {
  afterEach(() => vi.restoreAllMocks());

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
    // Remove env vars to simulate unconfigured state
    const savedLogin = process.env.DATAFORSEO_LOGIN;
    const savedPwd = process.env.DATAFORSEO_PASSWORD;
    delete process.env.DATAFORSEO_LOGIN;
    delete process.env.DATAFORSEO_PASSWORD;

    const provider = new DataForSeoProvider();
    const fetchSpy = vi.spyOn(global, 'fetch');
    await provider.init();

    expect(fetchSpy).not.toHaveBeenCalled();

    process.env.DATAFORSEO_LOGIN = savedLogin;
    process.env.DATAFORSEO_PASSWORD = savedPwd;
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx vitest run tests/unit/dataforseo-provider.test.ts -t "init() capability probe" --reporter=verbose
```

Expected: FAIL — `init()` method does not exist.

- [ ] **Step 3: Add optional init?() to SeoDataProvider interface**

In `server/seo-data-provider.ts`, after `isConfigured()` in the interface (around line 98):

```typescript
  /** Optional startup probe to detect unavailable capabilities early */
  init?(): Promise<void>;
```

- [ ] **Step 4: Add init() method to DataForSeoProvider**

In `server/providers/dataforseo-provider.ts`, add to the `DataForSeoProvider` class after `isConfigured()`:

```typescript
  async init(): Promise<void> {
    if (!this.isConfigured()) return;
    try {
      await apiCall('backlinks/summary/live', [{ target: 'example.com', include_subdomains: false }]);
    } catch (err) {
      if (isSubscriptionError(err)) {
        markBacklinksDisabled();
        log.info('DataForSEO backlinks subscription not available — proactively falling back to SEMRush');
      }
      // Non-subscription errors (network, rate limit) are silently ignored — reactive detection handles them
    }
  }
```

- [ ] **Step 5: Update app.ts to call init() non-blocking**

In `server/app.ts`, change the provider registration block (lines 115-117):

```typescript
// BEFORE
registerProvider('semrush', new SemrushProvider());
registerProvider('dataforseo', new DataForSeoProvider());

// AFTER
registerProvider('semrush', new SemrushProvider());
const dfsProv = new DataForSeoProvider();
registerProvider('dataforseo', dfsProv);
dfsProv.init().catch((err: unknown) => log.warn({ err }, 'DataForSEO capability probe failed'));
```

Also add the logger import line if not already present — `app.ts` likely already imports a logger, but confirm with `grep -n "createLogger\|import.*log" server/app.ts`. If there's a top-level `log` variable, use it; otherwise add: `import { createLogger } from './logger.js';` and `const log = createLogger('app');`.

- [ ] **Step 6: Run tests to confirm they pass**

```bash
npx vitest run tests/unit/dataforseo-provider.test.ts --reporter=verbose
```

Expected: all tests PASS including the new init() tests.

- [ ] **Step 7: Typecheck**

```bash
npm run typecheck
```

Expected: zero errors.

- [ ] **Step 8: Commit**

```bash
git add server/providers/dataforseo-provider.ts server/seo-data-provider.ts server/app.ts tests/unit/dataforseo-provider.test.ts
git commit -m "feat: proactive DataForSEO backlinks capability probe at init"
```

---

## Task 7 — Generic per-capability fallback routing (Model: sonnet)

**Files:**
- Modify: `server/seo-data-provider.ts` (add getProviderForCapability, refactor getBacklinksProvider)
- Modify: `server/routes/keyword-strategy.ts` (SERP features fallback path)
- Modify: `data/roadmap.json` (mark item done)

**Context for implementer:**
- `getBacklinksProvider()` currently contains inline fallback logic (lines 184-201). Generalize this into `getProviderForCapability(capability, preferred?)` which accepts any capability string. Then refactor `getBacklinksProvider()` to delegate to it.
- The new function should live in `server/seo-data-provider.ts` right after `getBacklinksProvider()`.
- In `server/routes/keyword-strategy.ts`, around lines 1664-1688, add a SERP features fallback path: if the primary provider is DataForSEO AND SEMRush is also configured, try to use SEMRush for SERP feature enrichment via `getProviderForCapability('serp_features', ws.seoDataProvider)`. This is additive — don't break existing DataForSEO SERP feature flow.
- In `data/roadmap.json` at line 4305, change `"status": "pending"` to `"status": "done"` for item `seo-provider-hybrid-capability-routing`, and add a `"shippedAt"` and `"notes"` field.

- [ ] **Step 1: Write failing tests for getProviderForCapability**

Create `tests/unit/seo-provider-routing.test.ts`:

```typescript
/**
 * Tests for generic capability-based provider routing in seo-data-provider.ts.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerProvider,
  markCapabilityDisabled,
  clearCapabilityDisabled,
  getProviderForCapability,
  type SeoDataProvider,
  type ProviderName,
} from '../../server/seo-data-provider.js';

function makeProvider(name: ProviderName, configured = true): SeoDataProvider {
  return {
    name,
    isConfigured: () => configured,
    getKeywordMetrics: async () => [],
    getRelatedKeywords: async () => [],
    getQuestionKeywords: async () => [],
    getDomainKeywords: async () => [],
    getDomainOverview: async () => null,
    getCompetitors: async () => [],
    getKeywordGap: async () => [],
    getBacklinksOverview: async () => null,
    getReferringDomains: async () => [],
  };
}

describe('getProviderForCapability', () => {
  beforeEach(() => {
    clearCapabilityDisabled('dataforseo', 'backlinks');
    clearCapabilityDisabled('semrush', 'backlinks');
    clearCapabilityDisabled('dataforseo', 'serp_features');
  });

  it('returns primary provider when capability is not disabled', () => {
    const dfs = makeProvider('dataforseo');
    registerProvider('dataforseo', dfs);

    const provider = getProviderForCapability('backlinks', 'dataforseo');
    expect(provider).toBe(dfs);
  });

  it('falls back to SEMRush when DataForSEO backlinks is disabled', () => {
    const dfs = makeProvider('dataforseo');
    const semrush = makeProvider('semrush');
    registerProvider('dataforseo', dfs);
    registerProvider('semrush', semrush);

    markCapabilityDisabled('dataforseo', 'backlinks');

    const provider = getProviderForCapability('backlinks', 'dataforseo');
    expect(provider).toBe(semrush);
  });

  it('returns null when no fallback provider is available', () => {
    const dfs = makeProvider('dataforseo');
    const unconfiguredSemrush = makeProvider('semrush', false); // not configured
    registerProvider('dataforseo', dfs);
    registerProvider('semrush', unconfiguredSemrush);

    markCapabilityDisabled('dataforseo', 'backlinks');

    const provider = getProviderForCapability('backlinks', 'dataforseo');
    expect(provider).toBeNull();
  });

  it('getBacklinksProvider delegates to getProviderForCapability', () => {
    // After the refactor, getBacklinksProvider should behave identically
    const { getBacklinksProvider } = await import('../../server/seo-data-provider.js');
    const dfs = makeProvider('dataforseo');
    const semrush = makeProvider('semrush');
    registerProvider('dataforseo', dfs);
    registerProvider('semrush', semrush);

    markCapabilityDisabled('dataforseo', 'backlinks');
    const provider = getBacklinksProvider('dataforseo');
    expect(provider).toBe(semrush);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx vitest run tests/unit/seo-provider-routing.test.ts --reporter=verbose
```

Expected: FAIL — `getProviderForCapability` does not exist yet.

- [ ] **Step 3: Add getProviderForCapability to seo-data-provider.ts**

In `server/seo-data-provider.ts`, add after the existing `getBacklinksProvider()` function (after line 201):

```typescript
/**
 * Generic capability-aware provider resolver.
 * Returns the preferred provider if the capability is available,
 * or falls back to any other configured provider that has it.
 */
export function getProviderForCapability(capability: string, preferred?: ProviderName): SeoDataProvider | null {
  const primary = getConfiguredProvider(preferred);
  if (!primary) return null;

  const primaryName = [...providers.entries()].find(([, p]) => p === primary)?.[0];
  if (primaryName && isCapabilityDisabled(primaryName, capability)) {
    // Primary provider cannot serve this capability — try fallbacks
    for (const [name, p] of providers.entries()) {
      if (name !== primaryName && p.isConfigured() && !isCapabilityDisabled(name, capability)) {
        return p;
      }
    }
    return null; // No fallback available
  }

  return primary;
}
```

- [ ] **Step 4: Refactor getBacklinksProvider to delegate**

Replace the body of `getBacklinksProvider()` (lines 184-201):

```typescript
export function getBacklinksProvider(preferred?: ProviderName): SeoDataProvider | null {
  return getProviderForCapability('backlinks', preferred);
}
```

- [ ] **Step 5: Run tests to confirm they pass**

```bash
npx vitest run tests/unit/seo-provider-routing.test.ts --reporter=verbose
```

Expected: all tests PASS.

- [ ] **Step 6: Update roadmap.json**

In `data/roadmap.json`, find the `seo-provider-hybrid-capability-routing` item (line 4298) and update:

```json
{
  "id": "seo-provider-hybrid-capability-routing",
  "title": "Hybrid SEO provider: DataForSEO primary with SEMRush capability fallback",
  "source": "Session 2026-04-06 — follow-up to provider abstraction (PR #137)",
  "est": "3-5h",
  "priority": "P2",
  "sprint": "D",
  "status": "done",
  "shippedAt": "2026-04-16",
  "notes": "Shipped. getProviderForCapability(capability, preferred?) added to seo-data-provider.ts. getBacklinksProvider() now delegates to it. DataForSEO proactive init probe (Task 6) marks backlinks disabled before the first user request. SERP features fallback path added in keyword-strategy.ts."
}
```

Then sort the roadmap:

```bash
npx tsx scripts/sort-roadmap.ts
```

- [ ] **Step 7: Typecheck**

```bash
npm run typecheck
```

Expected: zero errors.

- [ ] **Step 8: Commit**

```bash
git add server/seo-data-provider.ts server/routes/keyword-strategy.ts data/roadmap.json tests/unit/seo-provider-routing.test.ts
git commit -m "feat: generic capability fallback routing (getProviderForCapability) — closes seo-provider-hybrid-capability-routing"
```

---

## Task 8 — Quality Gate (Model: sonnet)

**Files:** None — verification only.

- [ ] **Step 1: Full typecheck**

```bash
npm run typecheck
```

Expected: zero errors.

- [ ] **Step 2: Full build**

```bash
npx vite build
```

Expected: successful production build.

- [ ] **Step 3: Full test suite**

```bash
npx vitest run --reporter=verbose
```

Expected: all tests pass. Note any pre-existing failures from `Known Issues to Ignore` in CLAUDE.md.

- [ ] **Step 4: pr-check**

```bash
npx tsx scripts/pr-check.ts
```

Expected: zero violations.

- [ ] **Step 5: Invoke code review**

Use `superpowers:requesting-code-review` — changes span multiple files (provider, seo-data-provider, content-brief, BacklinkProfile, app.ts, routes). Code review catches any missed renames, type inconsistencies, or spec coverage gaps.

- [ ] **Step 6: Confirm FEATURE_AUDIT.md**

No new user-visible features were added (all fixes/improvements to existing functionality). No FEATURE_AUDIT.md entry required.

---

## Systemic Improvements

**Shared utilities:** None needed — the L1 cache functions already exist and were reused as-is.

**pr-check rules to consider adding:**
- `competition_index` used as `difficulty` — flag `competition_index` being assigned to `difficulty` without a `kdMap` lookup (prevents regression of Change 4)
- `lost_date` used as `lastSeen` — flag any future `lost_date` → `lastSeen` mapping in referring domain mappers

**Test coverage gaps closed by this plan:**
- DataForSEO SERP feature normalization (`videos` → `video`)
- `lastSeen` field correctness for active backlinks
- L1 global cache hit (cross-workspace)
- Keyword difficulty from dedicated KD endpoint (not competition_index)
- `getProviderForCapability` fallback behavior
- Content brief provider label dynamic substitution
- Content brief "Total results" omission when 0

---

## Verification Strategy

Each task has specific `npx vitest run` commands inline. For the full feature, after Task 8:

- **SERP features:** Create a DataForSEO workspace, run a domain scan, verify `serpFeatures` on keywords includes `video`/`people_also_ask` in the Keyword Strategy table.
- **lastSeen:** Check BacklinkProfile referring domains table — active backlinks should show a real date, not "—".
- **L1 cache:** Run `getKeywordMetrics` for the same keyword in two different workspaces in quick succession; check DataForSEO credit logs — second call should log `cached: true`.
- **Difficulty:** In Keyword Strategy, KD values should reflect organic difficulty (typically higher than competition_index × 100 for competitive keywords).
- **Content brief:** Generate a brief in a DataForSEO workspace; inspect the OpenAI prompt (via server logs with `DEBUG=true`) and confirm "DataForSEO" appears, not "SEMRush".
- **Link Types card:** Open BacklinkProfile for a DataForSEO workspace; "Link Types" stat card should not appear.
- **Capability fallback:** Configure DataForSEO without backlinks subscription, configure SEMRush with valid key; open BacklinkProfile — data should load from SEMRush without error.
