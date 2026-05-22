/**
 * One-time backfill: seed discovered_queries from existing rank_snapshots rows.
 *
 * Run once after the 100-discovered-queries.sql migration is applied:
 *   npx tsx scripts/backfill-discovered-queries.ts
 *
 * Safe to re-run. The script aggregates rank_snapshots first, then upserts the
 * aggregate with max-style updates so reruns do not double-count history.
 */
import { z } from 'zod';
import db from '../server/db/index.js';
import { parseJsonSafeArray } from '../server/db/json-validation.js';

interface SnapshotRow {
  workspace_id: string;
  date: string;
  queries: string;
}

interface DiscoveredQueryAggregate {
  workspaceId: string;
  query: string;
  firstSeen: string;
  lastSeen: string;
  bestPosition: number | null;
  bestImpressions: number;
  totalImpressions: number;
  snapshotCount: number;
}

const rankEntrySchema = z.object({
  query: z.string(),
  position: z.number().optional(),
  clicks: z.number().optional(),
  impressions: z.number().optional(),
});

for (const sql of [
  'ALTER TABLE discovered_queries ADD COLUMN last_snapshot_date TEXT',
  'ALTER TABLE discovered_queries ADD COLUMN last_snapshot_impressions INTEGER NOT NULL DEFAULT 0',
]) {
  try {
    db.exec(sql);
  } catch {
    // Columns already exist when migration 100 ran with the latest shape.
  }
}

const upsert = db.prepare(`
  INSERT INTO discovered_queries
    (workspace_id, query, first_seen, last_seen, best_position,
     best_impressions, total_impressions, snapshot_count,
     last_snapshot_date, last_snapshot_impressions, status)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')
  ON CONFLICT (workspace_id, query) DO UPDATE SET
    first_seen        = MIN(first_seen, excluded.first_seen),
    last_seen         = MAX(last_seen, excluded.last_seen),
    best_position     = CASE
                          WHEN best_position IS NULL
                            OR (excluded.best_position IS NOT NULL AND excluded.best_position < best_position)
                          THEN excluded.best_position
                          ELSE best_position
                        END,
    best_impressions  = MAX(best_impressions, excluded.best_impressions),
    total_impressions = MAX(total_impressions, excluded.total_impressions),
    snapshot_count    = MAX(snapshot_count, excluded.snapshot_count),
    last_snapshot_date = CASE
                           WHEN last_snapshot_date IS NULL
                             OR excluded.last_snapshot_date > last_snapshot_date
                           THEN excluded.last_snapshot_date
                           ELSE last_snapshot_date
                         END,
    last_snapshot_impressions = CASE
                                  WHEN last_snapshot_date IS NULL
                                    OR excluded.last_snapshot_date >= last_snapshot_date
                                  THEN excluded.last_snapshot_impressions
                                  ELSE last_snapshot_impressions
                                END
`);

const snapshots = db.prepare(
  'SELECT workspace_id, date, queries FROM rank_snapshots ORDER BY date ASC',
).all() as SnapshotRow[];

console.log(`Processing ${snapshots.length} snapshots...`);

let totalRows = 0;
const aggregates = new Map<string, DiscoveredQueryAggregate>();

for (const row of snapshots) {
  const entries = parseJsonSafeArray(row.queries, rankEntrySchema, {
    workspaceId: row.workspace_id,
    table: 'rank_snapshots',
    field: 'queries',
  });
  for (const entry of entries) {
    if (!entry.query.trim()) continue;
    const key = `${row.workspace_id}\u0000${entry.query}`;
    const impressions = entry.impressions ?? 0;
    const existing = aggregates.get(key);
    if (!existing) {
      aggregates.set(key, {
        workspaceId: row.workspace_id,
        query: entry.query,
        firstSeen: row.date,
        lastSeen: row.date,
        bestPosition: entry.position ?? null,
        bestImpressions: impressions,
        totalImpressions: impressions,
        snapshotCount: 1,
      });
      totalRows++;
      continue;
    }
    existing.firstSeen = existing.firstSeen < row.date ? existing.firstSeen : row.date;
    existing.lastSeen = existing.lastSeen > row.date ? existing.lastSeen : row.date;
    if (
      entry.position != null
      && (existing.bestPosition == null || entry.position < existing.bestPosition)
    ) {
      existing.bestPosition = entry.position;
    }
    existing.bestImpressions = Math.max(existing.bestImpressions, impressions);
    existing.totalImpressions += impressions;
    existing.snapshotCount++;
    totalRows++;
  }
}

const processAggregates = db.transaction((items: DiscoveredQueryAggregate[]) => {
  for (const item of items) {
    upsert.run(
      item.workspaceId,
      item.query,
      item.firstSeen,
      item.lastSeen,
      item.bestPosition,
      item.bestImpressions,
      item.totalImpressions,
      item.snapshotCount,
      item.lastSeen,
      item.bestImpressions,
    );
  }
});

processAggregates([...aggregates.values()]);

console.log(`Done. Processed ${totalRows} query entries (${aggregates.size} unique queries) from ${snapshots.length} snapshots.`);
