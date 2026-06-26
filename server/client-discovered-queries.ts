import db from './db/index.js';
import { createStmtCache } from './db/stmt-cache.js';
import { keywordComparisonKey } from '../shared/keyword-normalization.js';
import { DISCOVERED_QUERY_STATUS, type DiscoveredQueryStatus } from '../shared/types/local-seo.js';
import type { DiscoveredQuerySummary } from '../shared/types/intelligence.js';
import type { LatestRank } from '../shared/types/rank-tracking.js';

export interface DiscoveredQuery {
  workspaceId: string;
  query: string;
  firstSeen: string;
  lastSeen: string;
  bestPosition: number | null;
  bestImpressions: number;
  totalImpressions: number;
  snapshotCount: number;
  status: DiscoveredQueryStatus;
}

export type DiscoveredQueryObservation = LatestRank & {
  seenDate?: string;
};

export const LOST_VISIBILITY_READ_LIMIT = 200;
export const DISCOVERED_QUERY_RETENTION_DAYS = 365;

const stmts = createStmtCache(() => ({
  upsert: db.prepare(`
    INSERT INTO discovered_queries
      (workspace_id, query, first_seen, last_seen, best_position,
       best_impressions, total_impressions, snapshot_count,
       last_snapshot_date, last_snapshot_impressions, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, '${DISCOVERED_QUERY_STATUS.ACTIVE}')
    ON CONFLICT (workspace_id, query) DO UPDATE SET
      first_seen        = MIN(first_seen, excluded.first_seen),
      last_seen         = excluded.last_seen,
      best_position     = CASE
                            WHEN best_position IS NULL
                              OR (excluded.best_position IS NOT NULL AND excluded.best_position < best_position)
                            THEN excluded.best_position
                            ELSE best_position
                          END,
      best_impressions  = MAX(best_impressions, excluded.best_impressions),
      total_impressions = CASE
                            WHEN last_snapshot_date IS NULL
                              OR last_snapshot_date = excluded.last_snapshot_date
                            THEN MAX(0, total_impressions - COALESCE(last_snapshot_impressions, 0) + excluded.last_snapshot_impressions)
                            ELSE total_impressions + excluded.total_impressions
                          END,
      snapshot_count    = CASE
                            WHEN last_snapshot_date IS NULL
                              OR last_snapshot_date = excluded.last_snapshot_date
                            THEN snapshot_count
                            ELSE snapshot_count + 1
                          END,
      last_snapshot_date = excluded.last_snapshot_date,
      last_snapshot_impressions = excluded.last_snapshot_impressions,
      status            = '${DISCOVERED_QUERY_STATUS.ACTIVE}'
  `),
  markLost: db.prepare(`
    UPDATE discovered_queries
    SET status = '${DISCOVERED_QUERY_STATUS.LOST_VISIBILITY}'
    WHERE workspace_id = ?
      AND status = '${DISCOVERED_QUERY_STATUS.ACTIVE}'
      AND julianday(?) - julianday(last_seen) >= 14
      AND snapshot_count >= 2
      AND total_impressions >= 10
  `),
  lostKeys: db.prepare(`
    SELECT query
    FROM discovered_queries
    WHERE workspace_id = ? AND status = '${DISCOVERED_QUERY_STATUS.LOST_VISIBILITY}'
    ORDER BY total_impressions DESC, last_seen DESC, query ASC
    LIMIT ${LOST_VISIBILITY_READ_LIMIT}
  `),
  lostCount: db.prepare(`
    SELECT COUNT(*) AS count
    FROM discovered_queries
    WHERE workspace_id = ? AND status = '${DISCOVERED_QUERY_STATUS.LOST_VISIBILITY}'
  `),
  totalCount: db.prepare(`
    SELECT COUNT(*) AS count
    FROM discovered_queries
    WHERE workspace_id = ?
  `),
  topLost: db.prepare(`
    SELECT query, best_position, last_seen, total_impressions
    FROM discovered_queries
    WHERE workspace_id = ? AND status = '${DISCOVERED_QUERY_STATUS.LOST_VISIBILITY}'
    ORDER BY total_impressions DESC
    LIMIT 10
  `),
  lostRows: db.prepare(`
    SELECT query, best_position, last_seen, total_impressions
    FROM discovered_queries
    WHERE workspace_id = ? AND status = '${DISCOVERED_QUERY_STATUS.LOST_VISIBILITY}'
    ORDER BY total_impressions DESC, last_seen DESC, query ASC
    LIMIT ${LOST_VISIBILITY_READ_LIMIT}
  `),
  prune: db.prepare(`
    DELETE FROM discovered_queries
    WHERE workspace_id = ?
      AND julianday(?) - julianday(last_seen) > ?
      AND (
        status != '${DISCOVERED_QUERY_STATUS.LOST_VISIBILITY}'
        OR query NOT IN (
          SELECT query
          FROM discovered_queries
          WHERE workspace_id = ?
            AND status = '${DISCOVERED_QUERY_STATUS.LOST_VISIBILITY}'
          ORDER BY total_impressions DESC, last_seen DESC, query ASC
          LIMIT ${LOST_VISIBILITY_READ_LIMIT}
        )
      )
  `),
  pruneAll: db.prepare(`
    DELETE FROM discovered_queries
    WHERE julianday(?) - julianday(last_seen) > ?
      AND (
        status != '${DISCOVERED_QUERY_STATUS.LOST_VISIBILITY}'
        OR query NOT IN (
          SELECT query
          FROM discovered_queries AS retained
          WHERE retained.workspace_id = discovered_queries.workspace_id
            AND retained.status = '${DISCOVERED_QUERY_STATUS.LOST_VISIBILITY}'
          ORDER BY retained.total_impressions DESC, retained.last_seen DESC, retained.query ASC
          LIMIT ${LOST_VISIBILITY_READ_LIMIT}
        )
      )
  `),
}));

export function upsertDiscoveredQueries(
  workspaceId: string,
  queries: DiscoveredQueryObservation[],
  snapshotDate: string,
): void {
  const upsertMany = db.transaction((rankRows: DiscoveredQueryObservation[]) => {
    for (const row of rankRows) {
      if (!keywordComparisonKey(row.query)) continue;
      const seenDate = row.seenDate ?? snapshotDate;
      stmts().upsert.run(
        workspaceId,
        row.query,
        seenDate,
        seenDate,
        row.position,
        row.impressions,
        row.impressions,
        snapshotDate,
        row.impressions,
      );
    }
  });
  upsertMany(queries);
}

export function detectLostVisibility(workspaceId: string, today: string): void {
  stmts().markLost.run(workspaceId, today);
}

export function pruneDiscoveredQueries(
  workspaceId: string,
  today: string,
  retentionDays = DISCOVERED_QUERY_RETENTION_DAYS,
): number {
  const result = stmts().prune.run(workspaceId, today, retentionDays, workspaceId);
  return result.changes;
}

export function pruneAllDiscoveredQueries(
  today = new Date().toISOString().split('T')[0],
  retentionDays = DISCOVERED_QUERY_RETENTION_DAYS,
): number {
  const result = stmts().pruneAll.run(today, retentionDays);
  return result.changes;
}

export function getLostVisibilityKeys(workspaceId: string): Set<string> {
  const rows = stmts().lostKeys.all(workspaceId) as Array<{ query: string }>;
  return new Set(rows.map(row => keywordComparisonKey(row.query)).filter(Boolean));
}

export function getLostVisibilityCount(workspaceId: string): number {
  const row = stmts().lostCount.get(workspaceId) as { count: number } | undefined;
  return row?.count ?? 0;
}

export function getDiscoveredQuerySummary(workspaceId: string): DiscoveredQuerySummary {
  const totalRow = stmts().totalCount.get(workspaceId) as { count: number } | undefined;
  const lostRow = stmts().lostCount.get(workspaceId) as { count: number } | undefined;
  const topLostRows = stmts().topLost.all(workspaceId) as Array<{
    query: string;
    best_position: number | null;
    last_seen: string;
    total_impressions: number;
  }>;

  return {
    totalDiscovered: totalRow?.count ?? 0,
    lostVisibilityCount: lostRow?.count ?? 0,
    topLostQueries: topLostRows.map(row => ({
      query: row.query,
      lastPosition: row.best_position ?? null,
      lastSeen: row.last_seen,
      totalImpressions: row.total_impressions,
    })),
  };
}

export function getLostVisibilityQueries(workspaceId: string): Array<{
  query: string;
  lastPosition: number | null;
  lastSeen: string;
  totalImpressions: number;
}> {
  const rows = stmts().lostRows.all(workspaceId) as Array<{
    query: string;
    best_position: number | null;
    last_seen: string;
    total_impressions: number;
  }>;
  return rows.map(row => ({
    query: row.query,
    lastPosition: row.best_position,
    lastSeen: row.last_seen,
    totalImpressions: row.total_impressions,
  }));
}
