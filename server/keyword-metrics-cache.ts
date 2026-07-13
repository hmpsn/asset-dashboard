/**
 * keyword-metrics-cache — Global cross-workspace cache for keyword metrics.
 *
 * Keyword volume/difficulty/CPC is the same regardless of which workspace asks,
 * so this shared SQLite table eliminates duplicate provider API calls across workspaces
 * (used by SEO data providers). Acts as an L1 cache checked after the
 * per-workspace file cache (L2) and before the external API call.
 */
import db from './db/index.js';
import { parseJsonFallback } from './db/json-validation.js';
import { createLogger } from './logger.js';
import { keywordIdentityKeyV2 } from '../shared/keyword-normalization.js';
import { KEYWORD_IDENTITY_VERSIONS } from '../shared/types/keyword-identity.js';

const log = createLogger('keyword-metrics-cache');

export interface CachedKeywordMetrics {
  keyword: string;
  volume: number;
  difficulty: number;
  cpc: number;
  competition: number;
  results: number;
  trend: number[];
}

interface MetricRow {
  identity_version: string;
  identity_key: string;
  raw_keyword: string;
  database_region: string;
  volume: number;
  difficulty: number;
  cpc: number;
  competition: number;
  results: number;
  trend: string;
  cached_at: string;
}

// ── Lazy-init prepared statements ──

let _getOne: ReturnType<typeof db.prepare> | null = null;
function getOneStmt() {
  return (_getOne ??= db.prepare(
    `SELECT * FROM keyword_metrics_cache_v2
     WHERE identity_version = ? AND identity_key = ? AND database_region = ?`
  ));
}

let _upsert: ReturnType<typeof db.prepare> | null = null;
function upsertStmt() {
  return (_upsert ??= db.prepare(`
    INSERT INTO keyword_metrics_cache_v2 (
      identity_version, identity_key, raw_keyword, database_region,
      volume, difficulty, cpc, competition, results, trend, cached_at
    ) VALUES (
      @identity_version, @identity_key, @raw_keyword, @database_region,
      @volume, @difficulty, @cpc, @competition, @results, @trend, @cached_at
    )
    ON CONFLICT(identity_version, identity_key, database_region) DO UPDATE SET
      raw_keyword = CASE
        WHEN excluded.raw_keyword < keyword_metrics_cache_v2.raw_keyword COLLATE BINARY
          THEN excluded.raw_keyword
        ELSE keyword_metrics_cache_v2.raw_keyword
      END,
      volume = excluded.volume,
      difficulty = excluded.difficulty,
      cpc = excluded.cpc,
      competition = excluded.competition,
      results = excluded.results,
      trend = excluded.trend,
      cached_at = excluded.cached_at
  `));
}

let _cleanup: ReturnType<typeof db.prepare> | null = null;
function cleanupStmt() {
  return (_cleanup ??= db.prepare(
    `DELETE FROM keyword_metrics_cache_v2 WHERE cached_at < ?`
  ));
}

// ── Helpers ──

function rowToMetrics(r: MetricRow, requestedKeyword: string): CachedKeywordMetrics {
  return {
    keyword: requestedKeyword,
    volume: r.volume,
    difficulty: r.difficulty,
    cpc: r.cpc,
    competition: r.competition,
    results: r.results,
    trend: parseJsonFallback(r.trend, [] as number[]),
  };
}

function isStale(cachedAt: string, maxAgeHours: number): boolean {
  const age = (Date.now() - new Date(cachedAt).getTime()) / (1000 * 60 * 60);
  return age > maxAgeHours;
}

// ── Public API ──

/**
 * Look up a single keyword in the global cache.
 * Returns null if not found or stale.
 */
export function getCachedMetrics(
  keyword: string,
  database = 'us',
  maxAgeHours = 720 // 30 days
): CachedKeywordMetrics | null {
  const identityKey = keywordIdentityKeyV2(keyword);
  if (!identityKey) return null;
  const row = getOneStmt().get(KEYWORD_IDENTITY_VERSIONS.V2, identityKey, database) as MetricRow | undefined;
  if (!row) return null;
  if (isStale(row.cached_at, maxAgeHours)) return null;
  return rowToMetrics(row, keyword);
}

/**
 * Look up multiple keywords in the global cache.
 * Returns a Map of explicit v2 identity key → metrics for found/fresh entries.
 */
export function getCachedMetricsBatch(
  keywords: string[],
  database = 'us',
  maxAgeHours = 720
): Map<string, CachedKeywordMetrics> {
  const result = new Map<string, CachedKeywordMetrics>();
  if (keywords.length === 0) return result;

  // Use individual lookups (SQLite prepared statements are fast, avoids dynamic IN clause)
  const stmt = getOneStmt();
  for (const kw of keywords) {
    const key = keywordIdentityKeyV2(kw);
    if (!key) continue;
    const row = stmt.get(KEYWORD_IDENTITY_VERSIONS.V2, key, database) as MetricRow | undefined;
    if (row && !isStale(row.cached_at, maxAgeHours)) {
      result.set(key, rowToMetrics(row, kw));
    }
  }
  return result;
}

/**
 * Write a single keyword's metrics to the global cache.
 */
export function cacheMetrics(
  metrics: CachedKeywordMetrics,
  database = 'us'
): void {
  const identityKey = keywordIdentityKeyV2(metrics.keyword);
  if (!identityKey) return;
  upsertStmt().run({
    identity_version: KEYWORD_IDENTITY_VERSIONS.V2,
    identity_key: identityKey,
    raw_keyword: metrics.keyword,
    database_region: database,
    volume: metrics.volume,
    difficulty: metrics.difficulty,
    cpc: metrics.cpc,
    competition: metrics.competition,
    results: metrics.results,
    trend: JSON.stringify(metrics.trend || []),
    cached_at: new Date().toISOString(),
  });
}

/**
 * Write multiple keywords' metrics to the global cache in a single transaction.
 */
export function cacheMetricsBatch(
  items: CachedKeywordMetrics[],
  database = 'us'
): void {
  if (items.length === 0) return;
  const run = db.transaction(() => {
    const stmt = upsertStmt();
    const now = new Date().toISOString();
    for (const m of items) {
      const identityKey = keywordIdentityKeyV2(m.keyword);
      if (!identityKey) continue;
      stmt.run({
        identity_version: KEYWORD_IDENTITY_VERSIONS.V2,
        identity_key: identityKey,
        raw_keyword: m.keyword,
        database_region: database,
        volume: m.volume,
        difficulty: m.difficulty,
        cpc: m.cpc,
        competition: m.competition,
        results: m.results,
        trend: JSON.stringify(m.trend || []),
        cached_at: now,
      });
    }
  });
  run();
  log.info(`Cached ${items.length} keyword metrics globally`);
}

/**
 * Remove entries older than maxAgeDays (housekeeping).
 */
export function cleanupStaleEntries(maxAgeDays = 60): number {
  const cutoff = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000).toISOString();
  const result = cleanupStmt().run(cutoff);
  if (result.changes > 0) {
    log.info(`Cleaned up ${result.changes} stale keyword metrics entries`);
  }
  return result.changes;
}
