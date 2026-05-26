/**
 * Unit tests for server/keyword-metrics-cache.ts
 *
 * This module provides a global cross-workspace SQLite cache for keyword
 * volume/difficulty/CPC data so we don't burn provider API credits when
 * multiple workspaces ask for the same keyword.
 *
 * Tests exercise the real SQLite DB (same shared instance as the rest of the
 * unit suite) via the module's public API — no mocking of better-sqlite3.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import db from '../../server/db/index.js';
import {
  getCachedMetrics,
  getCachedMetricsBatch,
  cacheMetrics,
  cacheMetricsBatch,
  cleanupStaleEntries,
  type CachedKeywordMetrics,
} from '../../server/keyword-metrics-cache.js';
import { keywordComparisonKey } from '../../shared/keyword-normalization.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Build a metrics fixture with sensible defaults. */
function makeMetrics(keyword: string, overrides: Partial<CachedKeywordMetrics> = {}): CachedKeywordMetrics {
  return {
    keyword,
    volume: 1000,
    difficulty: 42,
    cpc: 1.5,
    competition: 0.7,
    results: 5_000_000,
    trend: [900, 950, 1000, 1050, 1100, 1000, 950, 900, 850, 950, 1000, 1050],
    ...overrides,
  };
}

/**
 * Directly insert a row with an explicit cached_at so we can simulate stale
 * entries without waiting real time or faking timers.
 */
function insertWithTimestamp(metrics: CachedKeywordMetrics, database: string, cachedAt: string): void {
  db.prepare(`
    INSERT INTO keyword_metrics_cache
      (keyword, database_region, volume, difficulty, cpc, competition, results, trend, cached_at)
    VALUES
      (@keyword, @database_region, @volume, @difficulty, @cpc, @competition, @results, @trend, @cached_at)
    ON CONFLICT(keyword, database_region) DO UPDATE SET
      volume = excluded.volume,
      difficulty = excluded.difficulty,
      cpc = excluded.cpc,
      competition = excluded.competition,
      results = excluded.results,
      trend = excluded.trend,
      cached_at = excluded.cached_at
  `).run({
    keyword: keywordComparisonKey(metrics.keyword),
    database_region: database,
    volume: metrics.volume,
    difficulty: metrics.difficulty,
    cpc: metrics.cpc,
    competition: metrics.competition,
    results: metrics.results,
    trend: JSON.stringify(metrics.trend),
    cached_at: cachedAt,
  });
}

/** Remove all test keywords so tests don't pollute the shared DB. */
function deleteTestKeywords(keywords: string[], database = 'us'): void {
  const stmt = db.prepare(
    `DELETE FROM keyword_metrics_cache WHERE keyword = ? AND database_region = ?`
  );
  for (const kw of keywords) {
    stmt.run(keywordComparisonKey(kw), database);
  }
}

// ── Test keywords — use unique region suffix to avoid cross-test collisions ──

const DB_US = 'us';
const DB_UK = 'uk';

// Keywords used across tests — cleaned up in afterAll.
const TEST_KEYWORDS: string[] = [];
function trackKw(kw: string): string {
  if (!TEST_KEYWORDS.includes(kw)) TEST_KEYWORDS.push(kw);
  return kw;
}

beforeAll(() => {
  // Ensure table exists (migrations run on DB import, but be explicit)
  db.prepare(`CREATE TABLE IF NOT EXISTS keyword_metrics_cache (
    keyword TEXT NOT NULL,
    database_region TEXT NOT NULL DEFAULT 'us',
    volume INTEGER NOT NULL DEFAULT 0,
    difficulty REAL NOT NULL DEFAULT 0,
    cpc REAL NOT NULL DEFAULT 0,
    competition REAL NOT NULL DEFAULT 0,
    results INTEGER NOT NULL DEFAULT 0,
    trend TEXT NOT NULL DEFAULT '[]',
    cached_at TEXT NOT NULL,
    PRIMARY KEY (keyword, database_region)
  )`).run();
});

afterAll(() => {
  // Clean up every keyword the tests wrote
  deleteTestKeywords(TEST_KEYWORDS, DB_US);
  deleteTestKeywords(TEST_KEYWORDS, DB_UK);
  // Also clean up any stale-test keywords inserted with the old DB region
  deleteTestKeywords(TEST_KEYWORDS, 'test-region');
});

// ── getCachedMetrics ──────────────────────────────────────────────────────────

describe('getCachedMetrics — cache miss', () => {
  it('returns null for a keyword that has never been stored', () => {
    const result = getCachedMetrics(trackKw('nonexistent-keyword-xyz-abc-123'));
    expect(result).toBeNull();
  });

  it('does not throw on an empty string keyword', () => {
    expect(() => getCachedMetrics('')).not.toThrow();
    const result = getCachedMetrics('');
    // Empty string normalises to '', which shouldn't exist in tests
    expect(result === null || typeof result === 'object').toBe(true);
  });
});

describe('getCachedMetrics — cache hit', () => {
  const kw = trackKw('best seo tools 2024 cache-hit-test');

  beforeAll(() => {
    cacheMetrics(makeMetrics(kw), DB_US);
  });

  it('returns a CachedKeywordMetrics object after storing', () => {
    const result = getCachedMetrics(kw, DB_US);
    expect(result).not.toBeNull();
    expect(result).toBeTypeOf('object');
  });

  it('returns correct volume', () => {
    const result = getCachedMetrics(kw, DB_US);
    expect(result?.volume).toBe(1000);
  });

  it('returns correct difficulty', () => {
    const result = getCachedMetrics(kw, DB_US);
    expect(result?.difficulty).toBe(42);
  });

  it('returns correct cpc', () => {
    const result = getCachedMetrics(kw, DB_US);
    expect(result?.cpc).toBe(1.5);
  });

  it('returns correct competition', () => {
    const result = getCachedMetrics(kw, DB_US);
    expect(result?.competition).toBe(0.7);
  });

  it('returns correct results count', () => {
    const result = getCachedMetrics(kw, DB_US);
    expect(result?.results).toBe(5_000_000);
  });

  it('returns trend as a parsed number array, not a JSON string', () => {
    const result = getCachedMetrics(kw, DB_US);
    expect(Array.isArray(result?.trend)).toBe(true);
    expect(result?.trend).toHaveLength(12);
    expect(result?.trend[0]).toBe(900);
  });

  it('returns all expected fields on the metrics object', () => {
    const result = getCachedMetrics(kw, DB_US);
    expect(result).toHaveProperty('keyword');
    expect(result).toHaveProperty('volume');
    expect(result).toHaveProperty('difficulty');
    expect(result).toHaveProperty('cpc');
    expect(result).toHaveProperty('competition');
    expect(result).toHaveProperty('results');
    expect(result).toHaveProperty('trend');
  });
});

// ── Keyword normalization ─────────────────────────────────────────────────────

describe('getCachedMetrics — keyword normalization', () => {
  const kw = trackKw('SEO Tips Guide normalize-test');

  beforeAll(() => {
    // Store with mixed case; the module normalizes via keywordComparisonKey
    cacheMetrics(makeMetrics(kw, { volume: 777 }), DB_US);
  });

  it('lookup with identical casing hits the cache', () => {
    expect(getCachedMetrics(kw, DB_US)?.volume).toBe(777);
  });

  it('lookup with all-lowercase hits the same cache entry', () => {
    const result = getCachedMetrics(kw.toLowerCase(), DB_US);
    expect(result?.volume).toBe(777);
  });

  it('lookup with all-uppercase hits the same cache entry', () => {
    const result = getCachedMetrics(kw.toUpperCase(), DB_US);
    expect(result?.volume).toBe(777);
  });

  it('lookup with mixed whitespace normalizes to same key', () => {
    // Extra internal spaces collapse to single space after normalization
    const spacey = 'SEO  Tips  Guide  normalize-test';
    const result = getCachedMetrics(spacey, DB_US);
    expect(result?.volume).toBe(777);
  });
});

// ── TTL / expiry ──────────────────────────────────────────────────────────────

describe('getCachedMetrics — TTL / staleness', () => {
  const kw = trackKw('expiry test keyword ttl-test');

  it('returns null for an entry whose cached_at is older than maxAgeHours', () => {
    // Insert with a timestamp 800 hours ago (exceeds default 720-hour TTL)
    const oldDate = new Date(Date.now() - 800 * 60 * 60 * 1000).toISOString();
    insertWithTimestamp(makeMetrics(kw, { volume: 555 }), DB_US, oldDate);

    const result = getCachedMetrics(kw, DB_US, 720);
    expect(result).toBeNull();
  });

  it('returns the entry when cached_at is within maxAgeHours', () => {
    // Insert with a timestamp 1 hour ago
    const recentDate = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString();
    insertWithTimestamp(makeMetrics(kw, { volume: 888 }), DB_US, recentDate);

    const result = getCachedMetrics(kw, DB_US, 720);
    expect(result?.volume).toBe(888);
  });

  it('respects a custom short maxAgeHours of 2 hours', () => {
    // Insert with a 3-hour-old timestamp
    const date3hAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    insertWithTimestamp(makeMetrics(kw, { volume: 999 }), DB_US, date3hAgo);

    // 2-hour TTL → should be stale
    const result = getCachedMetrics(kw, DB_US, 2);
    expect(result).toBeNull();
  });
});

// ── Database region isolation ─────────────────────────────────────────────────

describe('getCachedMetrics — database/region isolation', () => {
  const kw = trackKw('region isolation keyword test');

  beforeAll(() => {
    cacheMetrics(makeMetrics(kw, { volume: 100 }), DB_US);
    cacheMetrics(makeMetrics(kw, { volume: 200 }), DB_UK);
  });

  it('returns US metrics when querying us region', () => {
    const result = getCachedMetrics(kw, DB_US);
    expect(result?.volume).toBe(100);
  });

  it('returns UK metrics when querying uk region', () => {
    const result = getCachedMetrics(kw, DB_UK);
    expect(result?.volume).toBe(200);
  });

  it('returns null for an untouched region', () => {
    const result = getCachedMetrics(kw, 'ca');
    expect(result).toBeNull();
  });
});

// ── cacheMetrics — update / upsert ───────────────────────────────────────────

describe('cacheMetrics — upsert / overwrite', () => {
  const kw = trackKw('upsert test keyword overwrite');

  it('stores metrics and allows subsequent read', () => {
    cacheMetrics(makeMetrics(kw, { volume: 300 }), DB_US);
    expect(getCachedMetrics(kw, DB_US)?.volume).toBe(300);
  });

  it('overwrites an existing entry with newer data', () => {
    cacheMetrics(makeMetrics(kw, { volume: 300 }), DB_US);
    cacheMetrics(makeMetrics(kw, { volume: 450, difficulty: 60 }), DB_US);

    const result = getCachedMetrics(kw, DB_US);
    expect(result?.volume).toBe(450);
    expect(result?.difficulty).toBe(60);
  });

  it('handles trend as an empty array', () => {
    cacheMetrics(makeMetrics(kw, { trend: [] }), DB_US);
    const result = getCachedMetrics(kw, DB_US);
    expect(result?.trend).toEqual([]);
  });

  it('round-trips a full 12-month trend array correctly', () => {
    const trend = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100, 1200];
    cacheMetrics(makeMetrics(kw, { trend }), DB_US);
    const result = getCachedMetrics(kw, DB_US);
    expect(result?.trend).toEqual(trend);
  });
});

// ── getCachedMetricsBatch ─────────────────────────────────────────────────────

describe('getCachedMetricsBatch', () => {
  const kwA = trackKw('batch keyword alpha test');
  const kwB = trackKw('batch keyword beta test');
  const kwMissing = trackKw('batch keyword that was never stored xyz');

  beforeAll(() => {
    cacheMetrics(makeMetrics(kwA, { volume: 111 }), DB_US);
    cacheMetrics(makeMetrics(kwB, { volume: 222 }), DB_US);
  });

  it('returns an empty Map for an empty keyword list', () => {
    const result = getCachedMetricsBatch([], DB_US);
    expect(result).toBeInstanceOf(Map);
    expect(result.size).toBe(0);
  });

  it('returns hits for cached keywords', () => {
    const result = getCachedMetricsBatch([kwA, kwB], DB_US);
    expect(result.size).toBe(2);
  });

  it('maps normalized comparison key → metrics for kwA', () => {
    const result = getCachedMetricsBatch([kwA], DB_US);
    const entry = result.get(keywordComparisonKey(kwA));
    expect(entry?.volume).toBe(111);
  });

  it('maps normalized comparison key → metrics for kwB', () => {
    const result = getCachedMetricsBatch([kwB], DB_US);
    const entry = result.get(keywordComparisonKey(kwB));
    expect(entry?.volume).toBe(222);
  });

  it('silently skips keywords not in cache (no entry in map)', () => {
    const result = getCachedMetricsBatch([kwA, kwMissing], DB_US);
    expect(result.size).toBe(1);
    expect(result.has(keywordComparisonKey(kwMissing))).toBe(false);
  });

  it('skips stale batch entries', () => {
    const kwStale = trackKw('batch stale keyword test');
    const oldDate = new Date(Date.now() - 800 * 60 * 60 * 1000).toISOString();
    insertWithTimestamp(makeMetrics(kwStale, { volume: 333 }), DB_US, oldDate);

    const result = getCachedMetricsBatch([kwStale], DB_US, 720);
    expect(result.has(keywordComparisonKey(kwStale))).toBe(false);
  });

  it('does not throw for a single unknown keyword', () => {
    expect(() => getCachedMetricsBatch([trackKw('never-stored-single-batch-kw')], DB_US)).not.toThrow();
  });
});

// ── cacheMetricsBatch ─────────────────────────────────────────────────────────

describe('cacheMetricsBatch', () => {
  const kwC = trackKw('batch write keyword c test');
  const kwD = trackKw('batch write keyword d test');
  const kwE = trackKw('batch write keyword e test');

  it('does not throw for an empty array', () => {
    expect(() => cacheMetricsBatch([], DB_US)).not.toThrow();
  });

  it('stores multiple keywords in a single call', () => {
    cacheMetricsBatch([
      makeMetrics(kwC, { volume: 500 }),
      makeMetrics(kwD, { volume: 600 }),
      makeMetrics(kwE, { volume: 700 }),
    ], DB_US);

    expect(getCachedMetrics(kwC, DB_US)?.volume).toBe(500);
    expect(getCachedMetrics(kwD, DB_US)?.volume).toBe(600);
    expect(getCachedMetrics(kwE, DB_US)?.volume).toBe(700);
  });

  it('overwrites existing entries in batch mode', () => {
    cacheMetricsBatch([makeMetrics(kwC, { volume: 500 })], DB_US);
    cacheMetricsBatch([makeMetrics(kwC, { volume: 999 })], DB_US);

    expect(getCachedMetrics(kwC, DB_US)?.volume).toBe(999);
  });

  it('stores keywords with normalized casing via batch', () => {
    const kwCased = trackKw('Batch Cased Keyword F Test');
    cacheMetricsBatch([makeMetrics(kwCased, { volume: 321 })], DB_US);

    // Lower-case lookup should hit
    const result = getCachedMetrics(kwCased.toLowerCase(), DB_US);
    expect(result?.volume).toBe(321);
  });
});

// ── cleanupStaleEntries ───────────────────────────────────────────────────────

describe('cleanupStaleEntries', () => {
  it('does not delete fresh entries', () => {
    // Insert a very recent entry — should survive cleanup
    const kwFresh = trackKw('fresh keyword cleanup test');
    cacheMetrics(makeMetrics(kwFresh), DB_US);

    // Run cleanup with a 1-day window — a 1-second-old entry must survive.
    // The shared test DB may have stale entries from other runs so we can't
    // assert deleted === 0, but the fresh entry must still be present after.
    const deleted = cleanupStaleEntries(1);
    expect(typeof deleted).toBe('number');
    expect(deleted).toBeGreaterThanOrEqual(0);
    expect(getCachedMetrics(kwFresh, DB_US)).not.toBeNull();
  });

  it('deletes entries older than maxAgeDays', () => {
    const kwOld = trackKw('very old keyword cleanup test 2');
    // Insert with a timestamp 90 days ago
    const oldDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    insertWithTimestamp(makeMetrics(kwOld, { volume: 42 }), DB_US, oldDate);

    // Clean anything older than 60 days
    const deleted = cleanupStaleEntries(60);
    expect(deleted).toBeGreaterThanOrEqual(1);

    // The old keyword should now be gone
    // (getCachedMetrics has its own maxAgeHours check, so use a raw DB query)
    const row = db.prepare(
      `SELECT * FROM keyword_metrics_cache WHERE keyword = ? AND database_region = ?`
    ).get(keywordComparisonKey(kwOld), DB_US);
    expect(row).toBeUndefined();
  });

  it('returns the count of deleted rows as a number', () => {
    const result = cleanupStaleEntries(30);
    expect(typeof result).toBe('number');
  });
});

// ── Edge cases ────────────────────────────────────────────────────────────────

describe('edge cases', () => {
  it('handles numeric zero values correctly (not treated as missing)', () => {
    const kw = trackKw('zero values edge case keyword test');
    cacheMetrics(makeMetrics(kw, { volume: 0, difficulty: 0, cpc: 0, competition: 0, results: 0 }), DB_US);

    const result = getCachedMetrics(kw, DB_US);
    expect(result?.volume).toBe(0);
    expect(result?.difficulty).toBe(0);
    expect(result?.cpc).toBe(0);
    expect(result?.competition).toBe(0);
    expect(result?.results).toBe(0);
  });

  it('handles fractional CPC and difficulty values correctly', () => {
    const kw = trackKw('fractional values edge case keyword test');
    cacheMetrics(makeMetrics(kw, { cpc: 0.01, difficulty: 99.9, competition: 0.001 }), DB_US);

    const result = getCachedMetrics(kw, DB_US);
    // Allow tiny floating point tolerance
    expect(result?.cpc).toBeCloseTo(0.01);
    expect(result?.difficulty).toBeCloseTo(99.9);
    expect(result?.competition).toBeCloseTo(0.001);
  });

  it('keyword with special characters normalises and stores correctly', () => {
    const kw = trackKw("what's the best seo? special chars test!");
    cacheMetrics(makeMetrics(kw, { volume: 123 }), DB_US);

    // keywordComparisonKey strips punctuation; both should resolve same key
    const result = getCachedMetrics(kw, DB_US);
    expect(result?.volume).toBe(123);
  });
});
