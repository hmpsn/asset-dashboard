/**
 * keyword-metrics-cache — Global cross-workspace cache for keyword metrics.
 *
 * Keyword volume/difficulty/CPC is the same regardless of which workspace asks,
 * so this shared SQLite table eliminates duplicate SEMRush API calls across workspaces.
 * Acts as an L1 cache checked before the per-workspace file cache in semrush.ts.
 */
import db from './db/index.js';
import { parseJsonFallback } from './db/json-validation.js';
import { createLogger } from './logger.js';

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
  keyword: string;
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
    `SELECT * FROM keyword_metrics_cache WHERE keyword = ? AND database_region = ?`
  ));
}

let _upsert: ReturnType<typeof db.prepare> | null = null;
function upsertStmt() {
  return (_upsert ??= db.prepare(`
    INSERT INTO keyword_metrics_cache (keyword, database_region, volume, difficulty, cpc, competition, results, trend, cached_at)
    VALUES (@keyword, @database_region, @volume, @difficulty, @cpc, @competition, @results, @trend, @cached_at)
    ON CONFLICT(keyword, database_region) DO UPDATE SET
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
    `DELETE FROM keyword_metrics_cache WHERE cached_at < ?`
  ));
}

// ── Helpers ──

function rowToMetrics(r: MetricRow): CachedKeywordMetrics {
  return {
    keyword: r.keyword,
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
  const row = getOneStmt().get(keyword.toLowerCase(), database) as MetricRow | undefined;
  if (!row) return null;
  if (isStale(row.cached_at, maxAgeHours)) return null;
  return rowToMetrics(row);
}

/**
 * Look up multiple keywords in the global cache.
 * Returns a Map of keyword (lowercased) → metrics for found/fresh entries.
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
    const row = stmt.get(kw.toLowerCase(), database) as MetricRow | undefined;
    if (row && !isStale(row.cached_at, maxAgeHours)) {
      result.set(kw.toLowerCase(), rowToMetrics(row));
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
  upsertStmt().run({
    keyword: metrics.keyword.toLowerCase(),
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
      stmt.run({
        keyword: m.keyword.toLowerCase(),
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
