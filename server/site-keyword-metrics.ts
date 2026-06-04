/**
 * site-keyword-metrics — CRUD for the site_keyword_metrics table (#19b).
 *
 * Normalizes keywordStrategy.siteKeywordMetrics[] out of the workspace JSON blob
 * into indexed SQLite rows keyed by (workspace_id, normalized_query) where
 * normalized_query = keywordComparisonKey(keyword).
 *
 * Wave 3b-i is the ADDITIVE half: this module is wired in as a DUAL-WRITE (the
 * persist path keeps writing the blob too) and a DUAL-READ source (readers read
 * the table first, falling back to the blob via `resolveSiteKeywordMetrics`).
 * The blob write at keyword-strategy-persistence.ts:102 and every read fallback
 * are KEPT. The forced strip (cut the blob write + the generation
 * `existingStrategy?.siteKeywordMetrics` source + remove the fallbacks) is the
 * follow-up owner-gated 3b-ii PR.
 */
import db from './db/index.js';
import { createLogger } from './logger.js';
import { parseJsonFallback } from './db/json-validation.js';
import { createStmtCache } from './db/stmt-cache.js';
import { keywordComparisonKey } from '../shared/keyword-normalization.js';
import { dedupeByLast } from './utils/collections.js';
import type { KeywordStrategySiteKeywordMetric } from './keyword-strategy-enrichment.js';

const log = createLogger('site-keyword-metrics');

// ── Row <-> Model mapping ──

interface SiteKeywordMetricRow {
  workspace_id: string;
  normalized_query: string;
  keyword: string;
  volume: number | null;
  difficulty: number | null;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** NULL columns map to the model's required numeric fields via a 0 default —
 *  never `null`, so the serialized shape matches the blob path. */
function rowToModel(row: SiteKeywordMetricRow): KeywordStrategySiteKeywordMetric {
  return {
    keyword: row.keyword,
    volume: row.volume ?? 0,
    difficulty: row.difficulty ?? 0,
  };
}

function modelToParams(workspaceId: string, metric: KeywordStrategySiteKeywordMetric) {
  return {
    workspace_id: workspaceId,
    normalized_query: keywordComparisonKey(metric.keyword),
    keyword: metric.keyword,
    volume: metric.volume ?? null,
    difficulty: metric.difficulty ?? null,
  };
}

/** Normalize an unknown blob entry into a valid metric (drops blanks/non-finite). */
function normalizeMetric(raw: unknown): KeywordStrategySiteKeywordMetric | null {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as Record<string, unknown>;
  const keyword = typeof candidate.keyword === 'string' ? candidate.keyword.trim() : '';
  if (!keyword || !keywordComparisonKey(keyword)) return null;
  return {
    keyword,
    volume: finiteNumber(candidate.volume) ?? 0,
    difficulty: finiteNumber(candidate.difficulty) ?? 0,
  };
}

// ── Lazy prepared statements ──

const stmts = createStmtCache(() => ({
  listByWs: db.prepare<[workspaceId: string]>(
    'SELECT * FROM site_keyword_metrics WHERE workspace_id = ? ORDER BY volume DESC NULLS LAST, keyword ASC',
  ),
  insert: db.prepare(`
    INSERT INTO site_keyword_metrics (
      workspace_id, normalized_query, keyword, volume, difficulty
    ) VALUES (
      @workspace_id, @normalized_query, @keyword, @volume, @difficulty
    )
  `),
  deleteAll: db.prepare<[workspaceId: string]>(
    'DELETE FROM site_keyword_metrics WHERE workspace_id = ?',
  ),
  countByWs: db.prepare<[workspaceId: string]>(
    'SELECT COUNT(*) as cnt FROM site_keyword_metrics WHERE workspace_id = ?',
  ),
}));

// ── Public API ──

/** All site keyword metrics for a workspace (volume DESC, keyword ASC). */
export function listSiteKeywordMetrics(workspaceId: string): KeywordStrategySiteKeywordMetric[] {
  const rows = stmts().listByWs.all(workspaceId) as SiteKeywordMetricRow[];
  return rows.map(rowToModel);
}

/** Count site keyword metrics rows for a workspace. */
export function countSiteKeywordMetrics(workspaceId: string): number {
  return (stmts().countByWs.get(workspaceId) as { cnt: number }).cnt;
}

/** Replace all site keyword metrics for a workspace (delete + insert in a txn).
 *  Deduplicates by normalized_query — the last occurrence wins (matches the
 *  blob-path dedup semantics the readers historically relied on). */
export function replaceAllSiteKeywordMetrics(workspaceId: string, metrics: KeywordStrategySiteKeywordMetric[]): void {
  const run = db.transaction(() => {
    stmts().deleteAll.run(workspaceId);
    const normalized = metrics
      .map(normalizeMetric)
      .filter((m): m is KeywordStrategySiteKeywordMetric => m != null);
    const deduped = dedupeByLast(normalized, m => keywordComparisonKey(m.keyword));
    const stmt = stmts().insert;
    for (const metric of deduped) {
      stmt.run(modelToParams(workspaceId, metric));
    }
  });
  run();
}

/** Delete all site keyword metrics for a workspace. */
export function deleteAllSiteKeywordMetrics(workspaceId: string): void {
  stmts().deleteAll.run(workspaceId);
}

/**
 * DUAL-READ resolver — table-first, blob fallback.
 *
 * Returns the table rows when the table is populated; otherwise the legacy blob
 * array (so un-migrated legacy workspaces don't lose data before the forced
 * strip). The fallback is removed only in the 3b-ii strip PR, never here.
 */
export function resolveSiteKeywordMetrics(
  workspaceId: string,
  blobMetrics: KeywordStrategySiteKeywordMetric[] | undefined,
): KeywordStrategySiteKeywordMetric[] {
  const fromTable = listSiteKeywordMetrics(workspaceId);
  return fromTable.length > 0 ? fromTable : (blobMetrics ?? []);
}

/**
 * Boot backfill — populate site_keyword_metrics from each workspace's blob.
 *
 * Idempotent: skips workspaces whose table is already populated. CAS-guarded
 * per the audit's lost-update hazard — the per-workspace transaction runs as
 * BEGIN IMMEDIATE and re-checks `countSiteKeywordMetrics(...) === 0` after
 * acquiring the write lock, so a concurrent persist that already populated the
 * table cannot be double-inserted.
 *
 * ADDITIVE: this step ONLY populates the table. It does NOT strip the blob
 * `siteKeywordMetrics` array (that is the 3b-ii strip). There is no CAS on the
 * `keyword_strategy` column because the blob is left untouched.
 */
export function migrateSiteKeywordMetricsFromBlob(): void {
  const rows = db.prepare(`
    SELECT id, keyword_strategy FROM workspaces
    WHERE keyword_strategy IS NOT NULL AND keyword_strategy != ''
  `).all() as { id: string; keyword_strategy: string }[];

  let migrated = 0;
  let skipped = 0;

  for (const row of rows) {
    try {
      const strategy = parseJsonFallback<Record<string, unknown> | null>(row.keyword_strategy, null);
      if (!strategy) continue;
      const metrics = strategy.siteKeywordMetrics;
      if (!Array.isArray(metrics) || metrics.length === 0) continue;

      const normalized = dedupeByLast(
        metrics.map(normalizeMetric).filter((m): m is KeywordStrategySiteKeywordMetric => m != null),
        m => keywordComparisonKey(m.keyword),
      );
      if (normalized.length === 0) continue;

      const migrateOne = db.transaction((): 'migrated' | 'already-migrated' => {
        // CAS re-check under the write lock: a concurrent persist may have
        // populated the table between the unlocked read above and now.
        if (countSiteKeywordMetrics(row.id) > 0) return 'already-migrated';
        const insert = stmts().insert;
        for (const metric of normalized) {
          insert.run(modelToParams(row.id, metric));
        }
        return 'migrated';
      });

      const outcome = migrateOne.immediate();
      if (outcome === 'already-migrated') {
        skipped++;
        continue;
      }

      migrated++;
      log.info({ workspaceId: row.id, metrics: normalized.length }, 'Backfilled siteKeywordMetrics into site_keyword_metrics table');
    } catch (err) {
      log.error({ err, workspaceId: row.id }, 'Failed to backfill siteKeywordMetrics');
    }
  }

  if (migrated > 0 || skipped > 0) {
    log.info({ migrated, skipped }, 'siteKeywordMetrics backfill complete');
  }
}
