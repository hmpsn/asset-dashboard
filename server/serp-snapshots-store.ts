/**
 * serp-snapshots-store — time-series store for the `serp_snapshots` table
 * (SEO Decision Engine P6, migration 153).
 *
 * Parallel to rank_snapshots (which holds GSC average position + clicks/
 * impressions/ctr): serp_snapshots holds the TRUE national SERP rank
 * (`position`), the client URL that ranks (`matched_url`), SERP-feature labels
 * (`features`), and AI-Overview tri-state flags. The two stores are NEVER
 * conflated — they join on (workspace_id, date, query) at read time.
 *
 * Fresh observations retain raw query text plus v2 identity in the compatibility
 * store. The legacy table remains a deterministic v1 rollback projection.
 *
 * rowToSerpSnapshot maps NULL columns to `undefined` (NEVER `null`) and the
 * tri-state INTEGER flags (NULL/0/1) to (undefined/false/true). `features` is
 * parsed through parseJsonSafeArray (never bare JSON.parse).
 */
import { z } from 'zod';

import db from './db/index.js';
import { parseJsonSafeArray } from './db/json-validation.js';
import { createStmtCache } from './db/stmt-cache.js';
import {
  keywordIdentityKeyV1,
  keywordIdentityKeyV2,
} from '../shared/keyword-normalization.js';

// ── SQLite row shape (mirrors migration 153) ──

export interface SerpSnapshotRow {
  workspace_id: string;
  date: string;
  query: string;
  position: number | null;
  matched_url: string | null;
  features: string;
  ai_overview_cited: number | null;
  ai_overview_present: number | null;
}

/** In-memory shape: NULL columns → `undefined`; tri-state INTEGER → boolean|undefined. */
export interface SerpSnapshot {
  workspaceId: string;
  date: string;
  query: string;
  position?: number;
  matchedUrl?: string;
  features: string[];
  aiOverviewCited?: boolean;
  aiOverviewPresent?: boolean;
  observedAt?: string;
  identityVersion?: 'v1' | 'v2';
}

interface SerpSnapshotV2Row extends Omit<SerpSnapshotRow, 'query'> {
  query_v2: string;
  raw_query: string;
  query_v1: string;
  observed_at: string;
}

/** A NULL column maps to `undefined` (omitted by JSON.stringify) — never `null`. */
function nullToUndefined<T>(value: T | null): T | undefined {
  return value === null ? undefined : value;
}

/** Tri-state INTEGER column → boolean|undefined: NULL → undefined, 1 → true, 0 → false.
 *  `false` is a real established value (0), NOT "empty" — do not collapse it to undefined. */
function triStateToBool(n: number | null): boolean | undefined {
  return n === null ? undefined : n === 1;
}

/** Map a raw DB row back to the in-memory SerpSnapshot. */
export function rowToSerpSnapshot(row: SerpSnapshotRow): SerpSnapshot {
  return {
    workspaceId: row.workspace_id,
    date: row.date,
    query: row.query,
    position: nullToUndefined(row.position),
    matchedUrl: nullToUndefined(row.matched_url),
    features: parseJsonSafeArray(row.features, z.string(), {
      workspaceId: row.workspace_id,
      table: 'serp_snapshots',
      field: 'features',
    }),
    aiOverviewCited: triStateToBool(row.ai_overview_cited),
    aiOverviewPresent: triStateToBool(row.ai_overview_present),
    identityVersion: 'v1',
  };
}

// Retention: keep only the most recent N distinct snapshot dates per workspace
// so the table cannot grow unbounded (mirrors rank_snapshots' 180-date cap).
const SNAPSHOT_RETAIN_DATES = 180;

// ── Lazy prepared statements ──

const stmts = createStmtCache(() => ({
  upsert: db.prepare(`
    INSERT INTO serp_snapshots (
      workspace_id, date, query, position, matched_url,
      features, ai_overview_cited, ai_overview_present
    ) VALUES (
      @workspace_id, @date, @query, @position, @matched_url,
      @features, @ai_overview_cited, @ai_overview_present
    )
    ON CONFLICT(workspace_id, date, query) DO UPDATE SET
      position = excluded.position,
      matched_url = excluded.matched_url,
      features = excluded.features,
      ai_overview_cited = excluded.ai_overview_cited,
      ai_overview_present = excluded.ai_overview_present
  `),
  upsertV2: db.prepare(`
    INSERT INTO serp_snapshots_v2_compat (
      workspace_id, date, query_v2, raw_query, query_v1, observed_at,
      position, matched_url, features, ai_overview_cited, ai_overview_present
    ) VALUES (
      @workspace_id, @date, @query_v2, @raw_query, @query_v1, @observed_at,
      @position, @matched_url, @features, @ai_overview_cited, @ai_overview_present
    )
    ON CONFLICT(workspace_id, date, query_v2, raw_query) DO UPDATE SET
      query_v1 = excluded.query_v1,
      observed_at = excluded.observed_at,
      position = excluded.position,
      matched_url = excluded.matched_url,
      features = excluded.features,
      ai_overview_cited = excluded.ai_overview_cited,
      ai_overview_present = excluded.ai_overview_present
  `),
  archiveUnmarkedLegacy: db.prepare(`
    INSERT INTO serp_snapshot_v1_legacy_aliases (
      workspace_id, date, query_v1, position, matched_url, features,
      ai_overview_cited, ai_overview_present, archived_at
    )
    SELECT s.workspace_id, s.date, s.query, s.position, s.matched_url, s.features,
           s.ai_overview_cited, s.ai_overview_present, @archived_at
    FROM serp_snapshots s
    LEFT JOIN serp_snapshot_v1_projection_keys p
      ON p.workspace_id = s.workspace_id AND p.date = s.date AND p.query_v1 = s.query
    WHERE s.workspace_id = @workspace_id AND s.date = @date AND s.query = @query_v1
      AND p.workspace_id IS NULL
    ON CONFLICT(workspace_id, date, query_v1) DO NOTHING
  `),
  markProjection: db.prepare(`
    INSERT INTO serp_snapshot_v1_projection_keys (workspace_id, date, query_v1, projected_at)
    VALUES (@workspace_id, @date, @query_v1, @projected_at)
    ON CONFLICT(workspace_id, date, query_v1) DO NOTHING
  `),
  projectionWinner: db.prepare(`
    SELECT position, matched_url, features, ai_overview_cited, ai_overview_present
    FROM serp_snapshots_v2_compat
    WHERE workspace_id = @workspace_id AND date = @date AND query_v1 = @query_v1
    ORDER BY observed_at DESC, raw_query COLLATE BINARY ASC
    LIMIT 1
  `),
  // Latest row per query: join each query to its max(date) within the workspace.
  latestLegacyByWs: db.prepare<[workspaceId: string, workspaceId2: string]>(`
    SELECT workspace_id, date, query, position, matched_url, features,
           ai_overview_cited, ai_overview_present
    FROM (
      SELECT legacy.*,
             ROW_NUMBER() OVER (PARTITION BY query ORDER BY date DESC) AS identity_rank
      FROM (
        SELECT s.workspace_id, s.date, s.query, s.position, s.matched_url, s.features,
               s.ai_overview_cited, s.ai_overview_present
        FROM serp_snapshots s
        LEFT JOIN serp_snapshot_v1_projection_keys p
          ON p.workspace_id = s.workspace_id AND p.date = s.date AND p.query_v1 = s.query
        WHERE s.workspace_id = ? AND p.workspace_id IS NULL
        UNION ALL
        SELECT a.workspace_id, a.date, a.query_v1 AS query, a.position, a.matched_url, a.features,
               a.ai_overview_cited, a.ai_overview_present
        FROM serp_snapshot_v1_legacy_aliases a
        WHERE a.workspace_id = ?
      ) legacy
    )
    WHERE identity_rank = 1
    ORDER BY query ASC
  `),
  legacyByQuery: db.prepare<[workspaceId: string, query: string, workspaceId2: string, query2: string]>(`
    SELECT s.workspace_id, s.date, s.query, s.position, s.matched_url, s.features,
           s.ai_overview_cited, s.ai_overview_present
    FROM serp_snapshots s
    LEFT JOIN serp_snapshot_v1_projection_keys p
      ON p.workspace_id = s.workspace_id AND p.date = s.date AND p.query_v1 = s.query
    WHERE s.workspace_id = ? AND s.query = ? AND p.workspace_id IS NULL
    UNION ALL
    SELECT a.workspace_id, a.date, a.query_v1 AS query, a.position, a.matched_url, a.features,
           a.ai_overview_cited, a.ai_overview_present
    FROM serp_snapshot_v1_legacy_aliases a
    WHERE a.workspace_id = ? AND a.query_v1 = ?
    ORDER BY date DESC
  `),
  latestV2ByWs: db.prepare<[workspaceId: string]>(`
    SELECT workspace_id, date, query_v2, raw_query, query_v1, observed_at,
           position, matched_url, features, ai_overview_cited, ai_overview_present
    FROM (
      SELECT s.*,
             ROW_NUMBER() OVER (
               PARTITION BY query_v2
               ORDER BY date DESC, observed_at DESC, raw_query COLLATE BINARY ASC
             ) AS identity_rank
      FROM serp_snapshots_v2_compat s
      WHERE workspace_id = ?
    )
    WHERE identity_rank = 1
    ORDER BY query_v2 ASC
  `),
  byV2Query: db.prepare<[workspaceId: string, queryV2: string]>(`
    SELECT workspace_id, date, query_v2, raw_query, query_v1, observed_at,
           position, matched_url, features, ai_overview_cited, ai_overview_present
    FROM (
      SELECT s.*,
             ROW_NUMBER() OVER (
               PARTITION BY date, query_v2
               ORDER BY observed_at DESC, raw_query COLLATE BINARY ASC
             ) AS date_rank
      FROM serp_snapshots_v2_compat s
      WHERE workspace_id = ? AND query_v2 = ?
    )
    WHERE date_rank = 1
    ORDER BY date DESC, observed_at DESC, raw_query COLLATE BINARY ASC
  `),
  // Drop rows older than the most recent SNAPSHOT_RETAIN_DATES distinct dates for
  // this workspace. serp_snapshots has no baseline/earliest-row reader (the
  // engagement baseline anchors on ga4_conversion_snapshots), so a plain date-window
  // prune is safe — no anchor guard needed. Served by idx_serp_snapshots_query_date.
  prune: db.prepare(`
    DELETE FROM serp_snapshots
    WHERE workspace_id = @ws
      AND date NOT IN (
        SELECT DISTINCT date FROM serp_snapshots
        WHERE workspace_id = @ws ORDER BY date DESC LIMIT @keep
      )
  `),
  pruneV2: db.prepare(`
    DELETE FROM serp_snapshots_v2_compat
    WHERE workspace_id = @ws
      AND date NOT IN (
        SELECT DISTINCT date FROM serp_snapshots_v2_compat
        WHERE workspace_id = @ws ORDER BY date DESC LIMIT @keep
      )
  `),
  pruneLegacyAliases: db.prepare(`
    DELETE FROM serp_snapshot_v1_legacy_aliases
    WHERE workspace_id = @ws
      AND date NOT IN (
        SELECT DISTINCT date FROM serp_snapshot_v1_legacy_aliases
        WHERE workspace_id = @ws ORDER BY date DESC LIMIT @keep
      )
  `),
  pruneProjectionKeys: db.prepare(`
    DELETE FROM serp_snapshot_v1_projection_keys
    WHERE workspace_id = @ws
      AND NOT EXISTS (
        SELECT 1 FROM serp_snapshots s
        WHERE s.workspace_id = serp_snapshot_v1_projection_keys.workspace_id
          AND s.date = serp_snapshot_v1_projection_keys.date
          AND s.query = serp_snapshot_v1_projection_keys.query_v1
      )
  `),
}));

// ── Public API ──

interface StoreSerpSnapshotInput {
  query: string;
  position?: number | null;
  matchedUrl?: string | null;
  features: string[];
  aiOverviewCited?: boolean | null;
  aiOverviewPresent?: boolean | null;
  observedAt?: string;
}

/** undefined/null in-memory → SQL NULL. */
function toNullableNumber(value: number | null | undefined): number | null {
  return value == null ? null : value;
}
function toNullableText(value: string | null | undefined): string | null {
  return value == null ? null : value;
}
/** boolean|null|undefined → tri-state INTEGER: null/undefined → NULL, true → 1, false → 0. */
function boolToTriState(value: boolean | null | undefined): number | null {
  return value == null ? null : value ? 1 : 0;
}

/**
 * Upsert a batch of complete SERP observations for one (workspace, date). Raw
 * variants remain independently auditable in v2; the coherent v1 rollback
 * projection is rebuilt deterministically in the same transaction.
 */
export function storeSerpSnapshots(
  workspaceId: string,
  date: string,
  snapshots: StoreSerpSnapshotInput[],
): void {
  const batchObservedAt = new Date().toISOString();
  const run = db.transaction(() => {
    const { upsert, upsertV2 } = stmts();
    const touchedProjections = new Set<string>();
    for (const snapshot of snapshots) {
      const rawQuery = snapshot.query;
      const queryV1 = keywordIdentityKeyV1(rawQuery);
      const queryV2 = keywordIdentityKeyV2(rawQuery);
      if (!queryV2) continue; // v2-only: preserve Unicode while dropping semantic blanks.
      const values = {
        workspace_id: workspaceId,
        date,
        position: toNullableNumber(snapshot.position),
        matched_url: toNullableText(snapshot.matchedUrl),
        features: JSON.stringify(snapshot.features ?? []),
        ai_overview_cited: boolToTriState(snapshot.aiOverviewCited),
        ai_overview_present: boolToTriState(snapshot.aiOverviewPresent),
      };
      upsertV2.run({
        ...values,
        query_v2: queryV2,
        raw_query: rawQuery,
        query_v1: queryV1,
        observed_at: snapshot.observedAt ?? batchObservedAt,
      });
      if (queryV1) touchedProjections.add(queryV1);
    }
    for (const queryV1 of [...touchedProjections].sort()) {
      const projectionKey = {
        workspace_id: workspaceId,
        date,
        query_v1: queryV1,
      };
      stmts().archiveUnmarkedLegacy.run({ ...projectionKey, archived_at: batchObservedAt });
      stmts().markProjection.run({ ...projectionKey, projected_at: batchObservedAt });
      const winner = stmts().projectionWinner.get(projectionKey) as Omit<SerpSnapshotRow, 'workspace_id' | 'date' | 'query'> | undefined;
      if (winner) upsert.run({ ...projectionKey, query: queryV1, ...winner });
    }
    stmts().prune.run({ ws: workspaceId, keep: SNAPSHOT_RETAIN_DATES });
    stmts().pruneV2.run({ ws: workspaceId, keep: SNAPSHOT_RETAIN_DATES });
    stmts().pruneLegacyAliases.run({ ws: workspaceId, keep: SNAPSHOT_RETAIN_DATES });
    stmts().pruneProjectionKeys.run({ ws: workspaceId });
  });
  run();
}

/** The most recent snapshot per query for a workspace (max(date) per query). */
export function getLatestSerpSnapshots(workspaceId: string): SerpSnapshot[] {
  const v2Rows = stmts().latestV2ByWs.all(workspaceId) as SerpSnapshotV2Row[];
  const legacyRows = stmts().latestLegacyByWs.all(workspaceId, workspaceId) as SerpSnapshotRow[];
  return [
    ...v2Rows.map(rowToV2SerpSnapshot),
    ...legacyRows.map(rowToSerpSnapshot),
  ];
}

/** All snapshots for one query (normalized), date-descending. */
export function getSerpSnapshotsByQuery(workspaceId: string, query: string): SerpSnapshot[] {
  const queryV2 = keywordIdentityKeyV2(query);
  if (!queryV2) return [];
  const v2Rows = stmts().byV2Query.all(workspaceId, queryV2) as SerpSnapshotV2Row[];
  if (v2Rows.length > 0) return v2Rows.map(rowToV2SerpSnapshot);
  const queryV1 = keywordIdentityKeyV1(query);
  if (!queryV1) return [];
  return (stmts().legacyByQuery.all(workspaceId, queryV1, workspaceId, queryV1) as SerpSnapshotRow[])
    .map(rowToSerpSnapshot);
}

function rowToV2SerpSnapshot(row: SerpSnapshotV2Row): SerpSnapshot {
  return {
    ...rowToSerpSnapshot({ ...row, query: row.raw_query }),
    observedAt: row.observed_at,
    identityVersion: 'v2',
  };
}
