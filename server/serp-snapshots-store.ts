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
 * `query` is normalized via keywordComparisonKey on every write/read so this
 * table's `query` joins cleanly to rank_snapshots / tracked_keywords.
 *
 * rowToSerpSnapshot maps NULL columns to `undefined` (NEVER `null`) and the
 * tri-state INTEGER flags (NULL/0/1) to (undefined/false/true). `features` is
 * parsed through parseJsonSafeArray (never bare JSON.parse).
 */
import { z } from 'zod';

import db from './db/index.js';
import { parseJsonSafeArray } from './db/json-validation.js';
import { createStmtCache } from './db/stmt-cache.js';
import { keywordComparisonKey } from '../shared/keyword-normalization.js';

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
  };
}

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
  // Latest row per query: join each query to its max(date) within the workspace.
  latestByWs: db.prepare<[workspaceId: string, workspaceId2: string]>(`
    SELECT s.* FROM serp_snapshots s
    JOIN (
      SELECT query, MAX(date) AS max_date
      FROM serp_snapshots
      WHERE workspace_id = ?
      GROUP BY query
    ) latest ON s.query = latest.query AND s.date = latest.max_date
    WHERE s.workspace_id = ?
    ORDER BY s.query ASC
  `),
  byQuery: db.prepare<[workspaceId: string, query: string]>(
    'SELECT * FROM serp_snapshots WHERE workspace_id = ? AND query = ? ORDER BY date DESC',
  ),
}));

// ── Public API ──

interface StoreSerpSnapshotInput {
  query: string;
  position?: number | null;
  matchedUrl?: string | null;
  features: string[];
  aiOverviewCited?: boolean | null;
  aiOverviewPresent?: boolean | null;
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
 * Upsert a batch of SERP snapshots for one (workspace, date). Each entry upserts
 * on (workspace_id, date, query) — re-running for the same key UPDATES in place
 * (no duplicate rows). `query` is normalized with keywordComparisonKey so the
 * stored key joins to rank_snapshots / tracked_keywords. The whole batch runs in
 * a single transaction (multi-write must be transactional).
 */
export function storeSerpSnapshots(
  workspaceId: string,
  date: string,
  snapshots: StoreSerpSnapshotInput[],
): void {
  const run = db.transaction(() => {
    const upsert = stmts().upsert;
    for (const snapshot of snapshots) {
      const normalizedQuery = keywordComparisonKey(snapshot.query);
      if (!normalizedQuery) continue; // blank-drop defensively
      upsert.run({
        workspace_id: workspaceId,
        date,
        query: normalizedQuery,
        position: toNullableNumber(snapshot.position),
        matched_url: toNullableText(snapshot.matchedUrl),
        features: JSON.stringify(snapshot.features ?? []),
        ai_overview_cited: boolToTriState(snapshot.aiOverviewCited),
        ai_overview_present: boolToTriState(snapshot.aiOverviewPresent),
      });
    }
  });
  run();
}

/** The most recent snapshot per query for a workspace (max(date) per query). */
export function getLatestSerpSnapshots(workspaceId: string): SerpSnapshot[] {
  const rows = stmts().latestByWs.all(workspaceId, workspaceId) as SerpSnapshotRow[];
  return rows.map(rowToSerpSnapshot);
}

/** All snapshots for one query (normalized), date-descending. */
export function getSerpSnapshotsByQuery(workspaceId: string, query: string): SerpSnapshot[] {
  const normalizedQuery = keywordComparisonKey(query);
  if (!normalizedQuery) return [];
  const rows = stmts().byQuery.all(workspaceId, normalizedQuery) as SerpSnapshotRow[];
  return rows.map(rowToSerpSnapshot);
}
