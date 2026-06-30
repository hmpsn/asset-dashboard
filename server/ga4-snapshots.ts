/**
 * The Issue (Client) P0 — typed GA4 conversion-snapshot store.
 *
 * Daily snapshot table modeled on roi_snapshots (server/roi.ts). One row per workspace per
 * snapshot pass; `by_event` holds the per-event breakdown (mirrors GA4ConversionSummary).
 * The earliest row is the durable engagement anchor read by computeOutcomeBaseline (A6); the
 * 90-day rolling prune is guarded so it NEVER deletes that anchor row.
 */
import { z } from 'zod';
import db from './db/index.js';
import { createStmtCache } from './db/stmt-cache.js';
import { parseJsonSafeArray } from './db/json-validation.js';
import type { Ga4ConversionSnapshot } from '../shared/types/the-issue.js';

const byEventSchema = z.object({
  eventName: z.string(), conversions: z.number(), users: z.number(), rate: z.number(),
}).passthrough();

interface Ga4SnapshotRow {
  id: number; workspace_id: string; captured_at: string;
  total_conversions: number; total_users: number; by_event: string;
}

const stmts = createStmtCache(() => ({
  insert: db.prepare(
    `INSERT INTO ga4_conversion_snapshots
       (workspace_id, captured_at, total_conversions, total_users, by_event)
     VALUES (@workspace_id, @captured_at, @total_conversions, @total_users, @by_event)`,
  ),
  selectByWorkspace: db.prepare(
    `SELECT * FROM ga4_conversion_snapshots WHERE workspace_id = ? ORDER BY captured_at ASC`,
  ),
  earliest: db.prepare(
    `SELECT * FROM ga4_conversion_snapshots WHERE workspace_id = ? ORDER BY captured_at ASC LIMIT 1`,
  ),
  pruneOld: db.prepare(
    // Prune rolling history older than the cutoff, but NEVER the earliest (anchor) row.
    `DELETE FROM ga4_conversion_snapshots
       WHERE workspace_id = ? AND captured_at < ?
         AND id <> (SELECT id FROM ga4_conversion_snapshots WHERE workspace_id = ? ORDER BY captured_at ASC LIMIT 1)`,
  ),
}));

function rowToGa4Snapshot(row: Ga4SnapshotRow): Ga4ConversionSnapshot {
  return {
    workspaceId: row.workspace_id,
    capturedAt: row.captured_at,
    totalConversions: row.total_conversions,
    totalUsers: row.total_users,
    byEvent: parseJsonSafeArray(row.by_event, byEventSchema, { workspaceId: row.workspace_id, field: 'by_event', table: 'ga4_conversion_snapshots' }),
  };
}

export function saveGa4Snapshot(snap: Ga4ConversionSnapshot): void {
  stmts().insert.run({
    workspace_id: snap.workspaceId, captured_at: snap.capturedAt,
    total_conversions: snap.totalConversions, total_users: snap.totalUsers,
    by_event: JSON.stringify(snap.byEvent),
  });
  // Keep last 90 days of daily snapshots — but never the earliest (engagement anchor) row.
  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  stmts().pruneOld.run(snap.workspaceId, cutoff, snap.workspaceId);
}

export function loadGa4SnapshotHistory(workspaceId: string): Ga4ConversionSnapshot[] {
  return (stmts().selectByWorkspace.all(workspaceId) as Ga4SnapshotRow[]).map(rowToGa4Snapshot);
}

export function getEarliestGa4Snapshot(workspaceId: string): Ga4ConversionSnapshot | null {
  const row = stmts().earliest.get(workspaceId) as Ga4SnapshotRow | undefined;
  return row ? rowToGa4Snapshot(row) : null;
}
