/**
 * site-keyword-metrics — CRUD for the site_keyword_metrics table (#19b).
 *
 * Normalizes keywordStrategy.siteKeywordMetrics[] out of the workspace JSON blob
 * into indexed SQLite rows keyed by (workspace_id, normalized_query) where
 * normalized_query = keywordComparisonKey(keyword).
 *
 * Wave 3b-ii is the STRIP half (table-as-truth): this table is now the SOLE
 * store for siteKeywordMetrics. The blob `siteKeywordMetrics` write has been cut
 * from keyword-strategy-persistence.ts, the generation carry-forward source reads
 * from the table, and `resolveSiteKeywordMetrics` is table-only (no blob
 * fallback). Only the boot backfill `migrateSiteKeywordMetricsFromBlob` still
 * reads legacy blobs — it is populate-only/idempotent and protects any legacy
 * workspace whose table is still empty (not yet re-persisted post-strip).
 */
import db from './db/index.js';
import { createLogger } from './logger.js';
import { parseJsonFallback } from './db/json-validation.js';
import { createStmtCache } from './db/stmt-cache.js';
import {
  keywordComparisonKey,
  keywordIdentityKeyV1,
  keywordIdentityKeyV2,
} from '../shared/keyword-normalization.js';
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

interface SiteKeywordMetricV2Row {
  workspace_id: string;
  normalized_query_v2: string;
  normalized_query_v1: string;
  keyword: string;
  volume: number | null;
  difficulty: number | null;
  is_canonical: number;
  write_order: number;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function compareBinaryUtf8(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
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

function modelToCompatParams(
  workspaceId: string,
  metric: KeywordStrategySiteKeywordMetric,
  writeOrder: number,
) {
  return {
    workspace_id: workspaceId,
    normalized_query_v2: keywordIdentityKeyV2(metric.keyword),
    normalized_query_v1: keywordIdentityKeyV1(metric.keyword),
    keyword: metric.keyword,
    volume: metric.volume ?? null,
    difficulty: metric.difficulty ?? null,
    is_canonical: 0,
    write_order: writeOrder,
  };
}

/** Normalize an unknown blob entry into a valid metric (drops blanks/non-finite). */
function normalizeMetric(raw: unknown): KeywordStrategySiteKeywordMetric | null {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as Record<string, unknown>;
  const keyword = typeof candidate.keyword === 'string' ? candidate.keyword.trim() : '';
  if (!keyword || !keywordIdentityKeyV2(keyword)) return null;
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
  listCompatByWs: db.prepare<[workspaceId: string]>(`
    SELECT * FROM site_keyword_metrics_v2_compat
    WHERE workspace_id = ? ORDER BY normalized_query_v2 ASC, keyword ASC
  `),
  listCompatCanonicalByWs: db.prepare<[workspaceId: string]>(`
    SELECT * FROM site_keyword_metrics_v2_compat
    WHERE workspace_id = ? AND is_canonical = 1
    ORDER BY volume DESC NULLS LAST, keyword ASC
  `),
  listLegacyFallbackByWs: db.prepare<[workspaceId: string]>(`
    SELECT legacy.* FROM site_keyword_metrics legacy
    WHERE legacy.workspace_id = ?
      AND NOT EXISTS (
        SELECT 1 FROM site_keyword_metrics_v2_compat compat
        WHERE compat.workspace_id = legacy.workspace_id
          AND compat.normalized_query_v1 = legacy.normalized_query
      )
    ORDER BY legacy.volume DESC NULLS LAST, legacy.keyword ASC
  `),
  maxCompatWriteOrder: db.prepare<[workspaceId: string]>(`
    SELECT COALESCE(MAX(write_order), 0) AS value
    FROM site_keyword_metrics_v2_compat WHERE workspace_id = ?
  `),
  upsertCompat: db.prepare(`
    INSERT INTO site_keyword_metrics_v2_compat (
      workspace_id, normalized_query_v2, normalized_query_v1, keyword,
      volume, difficulty, is_canonical, write_order
    ) VALUES (
      @workspace_id, @normalized_query_v2, @normalized_query_v1, @keyword,
      @volume, @difficulty, @is_canonical, @write_order
    )
    ON CONFLICT(workspace_id, normalized_query_v2, keyword) DO UPDATE SET
      normalized_query_v1 = excluded.normalized_query_v1,
      volume = excluded.volume,
      difficulty = excluded.difficulty,
      write_order = excluded.write_order
  `),
  demoteCompatGroup: db.prepare<[workspaceId: string, v2: string]>(`
    UPDATE site_keyword_metrics_v2_compat SET is_canonical = 0
    WHERE workspace_id = ? AND normalized_query_v2 = ? AND is_canonical = 1
  `),
  promoteCompatRaw: db.prepare<[workspaceId: string, v2: string, raw: string]>(`
    UPDATE site_keyword_metrics_v2_compat SET is_canonical = 1
    WHERE workspace_id = ? AND normalized_query_v2 = ? AND keyword = ?
  `),
  deleteCompatGroup: db.prepare<[workspaceId: string, v2: string]>(`
    DELETE FROM site_keyword_metrics_v2_compat WHERE workspace_id = ? AND normalized_query_v2 = ?
  `),
  deleteAllCompat: db.prepare<[workspaceId: string]>(`
    DELETE FROM site_keyword_metrics_v2_compat WHERE workspace_id = ?
  `),
}));

// ── Public API ──

/** All site keyword metrics for a workspace (volume DESC, keyword ASC). */
export function listSiteKeywordMetrics(workspaceId: string): KeywordStrategySiteKeywordMetric[] {
  const compat = stmts().listCompatCanonicalByWs.all(workspaceId) as SiteKeywordMetricV2Row[];
  const legacy = stmts().listLegacyFallbackByWs.all(workspaceId) as SiteKeywordMetricRow[];
  return [
    ...compat.map(row => ({
      keyword: row.keyword,
      volume: row.volume ?? 0,
      difficulty: row.difficulty ?? 0,
    })),
    ...legacy.map(rowToModel),
  ].sort((a, b) => b.volume - a.volume || a.keyword.localeCompare(b.keyword));
}

/** Count site keyword metrics rows for a workspace. */
export function countSiteKeywordMetrics(workspaceId: string): number {
  return listSiteKeywordMetrics(workspaceId).length;
}

function compareSiteMetricCanonical(a: SiteKeywordMetricV2Row, b: SiteKeywordMetricV2Row): number {
  const populatedA = Number(a.volume !== null) + Number(a.difficulty !== null);
  const populatedB = Number(b.volume !== null) + Number(b.difficulty !== null);
  if (populatedA !== populatedB) return populatedB - populatedA;
  const volumeA = a.volume ?? Number.NEGATIVE_INFINITY;
  const volumeB = b.volume ?? Number.NEGATIVE_INFINITY;
  if (volumeA !== volumeB) return volumeB - volumeA;
  const difficultyA = a.difficulty ?? Number.NEGATIVE_INFINITY;
  const difficultyB = b.difficulty ?? Number.NEGATIVE_INFINITY;
  if (difficultyA !== difficultyB) return difficultyB - difficultyA;
  return compareBinaryUtf8(a.keyword, b.keyword);
}

function siteMetricPayloadChanged(
  existing: SiteKeywordMetricV2Row | undefined,
  params: ReturnType<typeof modelToCompatParams>,
): boolean {
  return !existing
    || existing.normalized_query_v1 !== params.normalized_query_v1
    || existing.volume !== params.volume
    || existing.difficulty !== params.difficulty;
}

function rebuildSiteKeywordMetricsV1Projection(workspaceId: string): void {
  const canonicalRows = stmts().listCompatCanonicalByWs.all(workspaceId) as SiteKeywordMetricV2Row[];
  const winnerByV1 = new Map<string, SiteKeywordMetricV2Row>();
  for (const row of canonicalRows) {
    if (!row.normalized_query_v1) continue;
    const existing = winnerByV1.get(row.normalized_query_v1);
    if (
      !existing
      || row.write_order > existing.write_order
      || (row.write_order === existing.write_order && compareSiteMetricCanonical(row, existing) < 0)
    ) {
      winnerByV1.set(row.normalized_query_v1, row);
    }
  }
  stmts().deleteAll.run(workspaceId);
  for (const row of winnerByV1.values()) {
    stmts().insert.run(modelToParams(workspaceId, {
      keyword: row.keyword,
      volume: row.volume ?? 0,
      difficulty: row.difficulty ?? 0,
    }));
  }
}

/** Replace the active v2 collection and atomically rebuild the v1 rollback projection. */
export function replaceAllSiteKeywordMetrics(workspaceId: string, metrics: KeywordStrategySiteKeywordMetric[]): void {
  const run = db.transaction(() => {
    const normalized = metrics
      .map(normalizeMetric)
      .filter((m): m is KeywordStrategySiteKeywordMetric => m != null);

    const existingRows = stmts().listCompatByWs.all(workspaceId) as SiteKeywordMetricV2Row[];
    const existingByV2 = new Map<string, SiteKeywordMetricV2Row[]>();
    for (const row of existingRows) {
      const rows = existingByV2.get(row.normalized_query_v2) ?? [];
      rows.push(row);
      existingByV2.set(row.normalized_query_v2, rows);
    }

    const submittedByV2 = new Map<string, KeywordStrategySiteKeywordMetric[]>();
    for (const metric of normalized) {
      const v2 = keywordIdentityKeyV2(metric.keyword);
      const rows = submittedByV2.get(v2) ?? [];
      const prior = rows.findIndex(row => row.keyword === metric.keyword);
      if (prior >= 0) rows[prior] = metric;
      else rows.push(metric);
      submittedByV2.set(v2, rows);
    }

    for (const v2 of existingByV2.keys()) {
      if (!submittedByV2.has(v2)) stmts().deleteCompatGroup.run(workspaceId, v2);
    }

    let writeOrder = (stmts().maxCompatWriteOrder.get(workspaceId) as { value: number }).value;
    const submittedGroups = [...submittedByV2.entries()].sort(([aV2, aRows], [bV2, bRows]) => {
      const v1Order = compareBinaryUtf8(
        keywordIdentityKeyV1(aRows[0].keyword),
        keywordIdentityKeyV1(bRows[0].keyword),
      );
      return v1Order || compareBinaryUtf8(aV2, bV2);
    });
    for (const [v2, submittedUnsorted] of submittedGroups) {
      const submitted = [...submittedUnsorted].sort((a, b) => compareBinaryUtf8(a.keyword, b.keyword));
      const priorCanonical = existingByV2.get(v2)?.find(row => row.is_canonical === 1);
      for (const metric of submitted) {
        const existing = existingByV2.get(v2)?.find(row => row.keyword === metric.keyword);
        const candidateParams = modelToCompatParams(
          workspaceId,
          metric,
          existing?.write_order ?? writeOrder + 1,
        );
        const nextWriteOrder = siteMetricPayloadChanged(existing, candidateParams)
          ? ++writeOrder
          : existing!.write_order;
        stmts().upsertCompat.run({ ...candidateParams, write_order: nextWriteOrder });
      }
      const refreshed = (stmts().listCompatByWs.all(workspaceId) as SiteKeywordMetricV2Row[])
        .filter(row => row.normalized_query_v2 === v2);
      const retainedRaw = priorCanonical && submitted.some(metric => metric.keyword === priorCanonical.keyword)
        ? priorCanonical.keyword
        : undefined;
      const submittedRaw = new Set(submitted.map(metric => metric.keyword));
      const winnerRaw = retainedRaw
        ?? refreshed.filter(row => submittedRaw.has(row.keyword)).sort(compareSiteMetricCanonical)[0]?.keyword;
      if (!winnerRaw) continue;
      stmts().demoteCompatGroup.run(workspaceId, v2);
      stmts().promoteCompatRaw.run(workspaceId, v2, winnerRaw);
    }
    rebuildSiteKeywordMetricsV1Projection(workspaceId);
  });
  run();
}

/** Delete all site keyword metrics for a workspace. */
export function deleteAllSiteKeywordMetrics(workspaceId: string): void {
  const run = db.transaction(() => {
    stmts().deleteAllCompat.run(workspaceId);
    stmts().deleteAll.run(workspaceId);
  });
  run();
}

/**
 * Resolver — table-only (Wave 3b-ii strip; table-as-truth).
 *
 * Returns the site_keyword_metrics rows for the workspace unconditionally. The
 * legacy blob fallback was removed in the 3b-ii strip PR — the table is now the
 * sole source of truth. Any legacy workspace not yet re-persisted is covered by
 * the populate-only boot backfill `migrateSiteKeywordMetricsFromBlob`.
 */
export function resolveSiteKeywordMetrics(
  workspaceId: string,
): KeywordStrategySiteKeywordMetric[] {
  return listSiteKeywordMetrics(workspaceId);
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
 * POPULATE-ONLY: this step ONLY populates the table from any legacy blob that
 * still carries `siteKeywordMetrics`. Post-3b-ii the persist path no longer
 * writes that blob key, but pre-strip rows may still carry it — this backfill is
 * the migration bridge for those legacy workspaces. It does NOT mutate the
 * `keyword_strategy` column (no CAS needed) and never overwrites a populated
 * table (idempotent guard below).
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
