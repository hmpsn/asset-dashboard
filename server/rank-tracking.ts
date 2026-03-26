import db from './db/index.js';
import { createStmtCache } from './db/stmt-cache.js';

export interface RankSnapshot {
  date: string; // YYYY-MM-DD
  queries: { query: string; position: number; clicks: number; impressions: number; ctr: number }[];
}

export interface TrackedKeyword {
  query: string;
  pinned: boolean; // user-pinned for priority display
  addedAt: string;
}

// ── SQLite row shapes ──

interface ConfigRow {
  workspace_id: string;
  tracked_keywords: string;
}

interface SnapshotRow {
  id: number;
  workspace_id: string;
  date: string;
  queries: string;
}

const stmts = createStmtCache(() => ({
  getConfig: db.prepare(
    `SELECT * FROM rank_tracking_config WHERE workspace_id = ?`,
  ),
  upsertConfig: db.prepare(
    `INSERT INTO rank_tracking_config (workspace_id, tracked_keywords)
         VALUES (@workspace_id, @tracked_keywords)
         ON CONFLICT(workspace_id) DO UPDATE SET tracked_keywords = @tracked_keywords`,
  ),
  getSnapshots: db.prepare(
    `SELECT * FROM rank_snapshots WHERE workspace_id = ? ORDER BY date ASC`,
  ),
  upsertSnapshot: db.prepare(
    `INSERT INTO rank_snapshots (workspace_id, date, queries)
         VALUES (@workspace_id, @date, @queries)
         ON CONFLICT(workspace_id, date) DO UPDATE SET queries = @queries`,
  ),
  deleteOldSnapshots: db.prepare(
    `DELETE FROM rank_snapshots WHERE workspace_id = ? AND date NOT IN (
           SELECT date FROM rank_snapshots WHERE workspace_id = ? ORDER BY date DESC LIMIT 180
         )`,
  ),
}));

function readConfig(workspaceId: string): { trackedKeywords: TrackedKeyword[] } {
  const row = stmts().getConfig.get(workspaceId) as ConfigRow | undefined;
  return row ? { trackedKeywords: JSON.parse(row.tracked_keywords) } : { trackedKeywords: [] };
}

function writeConfig(workspaceId: string, config: { trackedKeywords: TrackedKeyword[] }) {
  stmts().upsertConfig.run({
    workspace_id: workspaceId,
    tracked_keywords: JSON.stringify(config.trackedKeywords),
  });
}

function readSnapshots(workspaceId: string): RankSnapshot[] {
  const rows = stmts().getSnapshots.all(workspaceId) as SnapshotRow[];
  return rows.map(r => ({ date: r.date, queries: JSON.parse(r.queries) }));
}

// --- Public API ---

export function getTrackedKeywords(workspaceId: string): TrackedKeyword[] {
  return readConfig(workspaceId).trackedKeywords;
}

export function addTrackedKeyword(workspaceId: string, query: string, pinned = false): TrackedKeyword[] {
  const config = readConfig(workspaceId);
  if (config.trackedKeywords.some(k => k.query === query)) return config.trackedKeywords;
  config.trackedKeywords.push({ query, pinned, addedAt: new Date().toISOString() });
  writeConfig(workspaceId, config);
  return config.trackedKeywords;
}

export function removeTrackedKeyword(workspaceId: string, query: string): TrackedKeyword[] {
  const config = readConfig(workspaceId);
  config.trackedKeywords = config.trackedKeywords.filter(k => k.query !== query);
  writeConfig(workspaceId, config);
  return config.trackedKeywords;
}

export function togglePinKeyword(workspaceId: string, query: string): TrackedKeyword[] {
  const config = readConfig(workspaceId);
  const kw = config.trackedKeywords.find(k => k.query === query);
  if (kw) kw.pinned = !kw.pinned;
  writeConfig(workspaceId, config);
  return config.trackedKeywords;
}

export function storeRankSnapshot(
  workspaceId: string,
  date: string,
  queries: { query: string; position: number; clicks: number; impressions: number; ctr: number }[]
): void {
  stmts().upsertSnapshot.run({
    workspace_id: workspaceId,
    date,
    queries: JSON.stringify(queries),
  });
  // Keep max 180 days of snapshots
  stmts().deleteOldSnapshots.run(workspaceId, workspaceId);
}

export function getRankHistory(
  workspaceId: string,
  queryFilter?: string[],
  limit = 90
): { date: string; positions: Record<string, number> }[] {
  const snapshots = readSnapshots(workspaceId);
  const recent = snapshots.slice(-limit);
  const config = readConfig(workspaceId);
  const tracked = queryFilter || config.trackedKeywords.map(k => k.query);

  return recent.map(snap => {
    const positions: Record<string, number> = {};
    for (const q of tracked) {
      const found = snap.queries.find(sq => sq.query === q);
      if (found) positions[q] = found.position;
    }
    return { date: snap.date, positions };
  });
}

export function getLatestRanks(workspaceId: string): { query: string; position: number; clicks: number; impressions: number; ctr: number; change?: number }[] {
  const snapshots = readSnapshots(workspaceId);
  if (snapshots.length === 0) return [];
  const latest = snapshots[snapshots.length - 1];
  const prev = snapshots.length >= 2 ? snapshots[snapshots.length - 2] : null;
  const config = readConfig(workspaceId);
  const tracked = new Set(config.trackedKeywords.map(k => k.query));

  return latest.queries
    .filter(q => tracked.size === 0 || tracked.has(q.query))
    .map(q => {
      const prevQ = prev?.queries.find(p => p.query === q.query);
      const change = prevQ ? +(prevQ.position - q.position).toFixed(1) : undefined;
      return { ...q, change };
    })
    .sort((a, b) => a.position - b.position);
}
