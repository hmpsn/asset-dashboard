import fs from 'fs';
import path from 'path';

const DATA_BASE = process.env.DATA_DIR
  || (process.env.NODE_ENV === 'production' ? '/tmp/asset-dashboard' : '');
const UPLOAD_ROOT = DATA_BASE
  ? path.join(DATA_BASE, 'uploads')
  : path.join(process.env.HOME || '', 'toUpload');

function getTrackingDir(workspaceId: string): string {
  const dir = path.join(UPLOAD_ROOT, workspaceId, '.rank-tracking');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export interface RankSnapshot {
  date: string; // YYYY-MM-DD
  queries: { query: string; position: number; clicks: number; impressions: number; ctr: number }[];
}

export interface TrackedKeyword {
  query: string;
  pinned: boolean; // user-pinned for priority display
  addedAt: string;
}

interface TrackingConfig {
  trackedKeywords: TrackedKeyword[];
}

function getConfigPath(workspaceId: string): string {
  return path.join(getTrackingDir(workspaceId), 'config.json');
}

function getSnapshotsPath(workspaceId: string): string {
  return path.join(getTrackingDir(workspaceId), 'snapshots.json');
}

function readConfig(workspaceId: string): TrackingConfig {
  try {
    const p = getConfigPath(workspaceId);
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch { /* fresh */ }
  return { trackedKeywords: [] };
}

function writeConfig(workspaceId: string, config: TrackingConfig) {
  fs.writeFileSync(getConfigPath(workspaceId), JSON.stringify(config, null, 2));
}

function readSnapshots(workspaceId: string): RankSnapshot[] {
  try {
    const p = getSnapshotsPath(workspaceId);
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch { /* fresh */ }
  return [];
}

function writeSnapshots(workspaceId: string, snapshots: RankSnapshot[]) {
  fs.writeFileSync(getSnapshotsPath(workspaceId), JSON.stringify(snapshots, null, 2));
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
  const snapshots = readSnapshots(workspaceId);
  // Replace if same date exists
  const idx = snapshots.findIndex(s => s.date === date);
  if (idx >= 0) {
    snapshots[idx] = { date, queries };
  } else {
    snapshots.push({ date, queries });
  }
  // Keep max 180 days of snapshots
  snapshots.sort((a, b) => a.date.localeCompare(b.date));
  if (snapshots.length > 180) snapshots.splice(0, snapshots.length - 180);
  writeSnapshots(workspaceId, snapshots);
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
