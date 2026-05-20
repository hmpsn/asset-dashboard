import db from './db/index.js';
import { parseJsonFallback, parseJsonSafeArray } from './db/json-validation.js';
import { createStmtCache } from './db/stmt-cache.js';
import { z } from 'zod';
import {
  TRACKED_KEYWORD_SOURCE,
  TRACKED_KEYWORD_STATUS,
  type LatestRank,
  type TrackedKeyword,
  type TrackedKeywordSource,
  type TrackedKeywordStatus,
} from '../shared/types/rank-tracking.js';
import { keywordComparisonKey } from '../shared/keyword-normalization.js';

export interface RankSnapshot {
  date: string; // YYYY-MM-DD
  queries: { query: string; position: number; clicks: number; impressions: number; ctr: number }[];
}

export type { TrackedKeyword };

export interface AddTrackedKeywordOptions {
  pinned?: boolean;
  source?: TrackedKeywordSource;
  status?: TrackedKeywordStatus;
  pagePath?: string;
  pageTitle?: string;
  strategyGeneratedAt?: string;
  lastStrategySeenAt?: string;
  intent?: string;
  volume?: number;
  difficulty?: number;
  cpc?: number;
  authorityPosture?: TrackedKeyword['authorityPosture'];
  baselinePosition?: number;
  baselineClicks?: number;
  baselineImpressions?: number;
  replacedBy?: string;
  deprecatedAt?: string;
}

export interface GetTrackedKeywordsOptions {
  includeInactive?: boolean;
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

const trackedKeywordSchema = z.object({
  query: z.string(),
  pinned: z.boolean().default(false),
  addedAt: z.string().default(''),
  source: z.enum([
    TRACKED_KEYWORD_SOURCE.MANUAL,
    TRACKED_KEYWORD_SOURCE.STRATEGY_PRIMARY,
    TRACKED_KEYWORD_SOURCE.STRATEGY_SITE_KEYWORD,
    TRACKED_KEYWORD_SOURCE.CLIENT_REQUESTED,
    TRACKED_KEYWORD_SOURCE.CONTENT_GAP,
    TRACKED_KEYWORD_SOURCE.RECOMMENDATION,
    TRACKED_KEYWORD_SOURCE.UNKNOWN,
  ]).optional(),
  status: z.enum([
    TRACKED_KEYWORD_STATUS.ACTIVE,
    TRACKED_KEYWORD_STATUS.PAUSED,
    TRACKED_KEYWORD_STATUS.DEPRECATED,
    TRACKED_KEYWORD_STATUS.REPLACED,
  ]).optional(),
  pagePath: z.string().optional(),
  pageTitle: z.string().optional(),
  strategyGeneratedAt: z.string().optional(),
  lastStrategySeenAt: z.string().optional(),
  intent: z.string().optional(),
  volume: z.number().optional(),
  difficulty: z.number().optional(),
  cpc: z.number().optional(),
  authorityPosture: z.enum(['authority_unknown', 'within_current_authority_range', 'requires_authority_building']).optional(),
  baselinePosition: z.number().optional(),
  baselineClicks: z.number().optional(),
  baselineImpressions: z.number().optional(),
  replacedBy: z.string().optional(),
  deprecatedAt: z.string().optional(),
});

function normalizeQuery(query: string): string {
  return keywordComparisonKey(query);
}

function normalizeTrackedKeywords(keywords: Array<Partial<TrackedKeyword> & { query: string }>): TrackedKeyword[] {
  const seen = new Set<string>();
  const normalized: TrackedKeyword[] = [];
  const now = new Date().toISOString();
  for (const keyword of keywords) {
    const displayQuery = keyword.query.trim();
    const queryKey = normalizeQuery(displayQuery);
    if (!displayQuery || !queryKey || seen.has(queryKey)) continue;
    seen.add(queryKey);
    normalized.push({
      ...keyword,
      query: displayQuery,
      pinned: Boolean(keyword.pinned),
      addedAt: keyword.addedAt || now,
      source: keyword.source ?? TRACKED_KEYWORD_SOURCE.UNKNOWN,
      status: keyword.status ?? TRACKED_KEYWORD_STATUS.ACTIVE,
    });
  }
  return normalized;
}

function readConfig(workspaceId: string): { trackedKeywords: TrackedKeyword[] } {
  const row = stmts().getConfig.get(workspaceId) as ConfigRow | undefined;
  return row
    ? {
        trackedKeywords: normalizeTrackedKeywords(parseJsonSafeArray(row.tracked_keywords, trackedKeywordSchema, {
          workspaceId,
          table: 'rank_tracking_config',
          field: 'tracked_keywords',
        })),
      }
    : { trackedKeywords: [] };
}

function writeConfig(workspaceId: string, config: { trackedKeywords: TrackedKeyword[] }) {
  stmts().upsertConfig.run({
    workspace_id: workspaceId,
    tracked_keywords: JSON.stringify(config.trackedKeywords),
  });
}

function readSnapshots(workspaceId: string): RankSnapshot[] {
  const rows = stmts().getSnapshots.all(workspaceId) as SnapshotRow[];
  return rows.map(r => ({ date: r.date, queries: parseJsonFallback<RankSnapshot['queries']>(r.queries, []) }));
}

// --- Public API ---

export function getTrackedKeywords(workspaceId: string, options: GetTrackedKeywordsOptions = {}): TrackedKeyword[] {
  const keywords = readConfig(workspaceId).trackedKeywords;
  if (options.includeInactive) return keywords;
  return keywords.filter(keyword => (keyword.status ?? TRACKED_KEYWORD_STATUS.ACTIVE) === TRACKED_KEYWORD_STATUS.ACTIVE);
}

export function updateTrackedKeywords(
  workspaceId: string,
  updater: (keywords: TrackedKeyword[]) => TrackedKeyword[],
): TrackedKeyword[] {
  const config = readConfig(workspaceId);
  config.trackedKeywords = normalizeTrackedKeywords(updater(config.trackedKeywords));
  writeConfig(workspaceId, config);
  return config.trackedKeywords;
}

function addTrackedKeywordToConfig(
  config: { trackedKeywords: TrackedKeyword[] },
  query: string,
  options: AddTrackedKeywordOptions,
): boolean {
  const normalizedQuery = normalizeQuery(query);
  if (!normalizedQuery) return false;
  const existing = config.trackedKeywords.find(k => normalizeQuery(k.query) === normalizedQuery);
  if (existing) {
    const nextStatus = options.status ?? TRACKED_KEYWORD_STATUS.ACTIVE;
    const existingSource = existing.source ?? TRACKED_KEYWORD_SOURCE.UNKNOWN;
    const existingStatus = existing.status ?? TRACKED_KEYWORD_STATUS.ACTIVE;
    const isReviving = existingStatus !== TRACKED_KEYWORD_STATUS.ACTIVE
      && nextStatus === TRACKED_KEYWORD_STATUS.ACTIVE;
    const nextSource = isReviving || existingSource === TRACKED_KEYWORD_SOURCE.UNKNOWN
      ? options.source ?? existingSource
      : existingSource;
    const definedOptions = Object.fromEntries(
      Object.entries(options).filter(([, value]) => value !== undefined),
    ) as AddTrackedKeywordOptions;
    Object.assign(existing, {
      ...definedOptions,
      pinned: existing.pinned || Boolean(options.pinned),
      status: nextStatus,
      source: nextSource,
      replacedBy: nextStatus === TRACKED_KEYWORD_STATUS.ACTIVE ? undefined : existing.replacedBy,
      deprecatedAt: nextStatus === TRACKED_KEYWORD_STATUS.ACTIVE ? undefined : existing.deprecatedAt,
    });
    return true;
  }
  config.trackedKeywords.push({
    query: query.trim(),
    pinned: Boolean(options.pinned),
    addedAt: new Date().toISOString(),
    source: options.source ?? TRACKED_KEYWORD_SOURCE.MANUAL,
    status: options.status ?? TRACKED_KEYWORD_STATUS.ACTIVE,
    pagePath: options.pagePath,
    pageTitle: options.pageTitle,
    strategyGeneratedAt: options.strategyGeneratedAt,
    lastStrategySeenAt: options.lastStrategySeenAt,
    intent: options.intent,
    volume: options.volume,
    difficulty: options.difficulty,
    cpc: options.cpc,
    authorityPosture: options.authorityPosture,
    baselinePosition: options.baselinePosition,
    baselineClicks: options.baselineClicks,
    baselineImpressions: options.baselineImpressions,
    replacedBy: options.replacedBy,
    deprecatedAt: options.deprecatedAt,
  });
  return true;
}

export function addTrackedKeyword(
  workspaceId: string,
  query: string,
  pinnedOrOptions: boolean | AddTrackedKeywordOptions = false,
): TrackedKeyword[] {
  const options: AddTrackedKeywordOptions = typeof pinnedOrOptions === 'boolean'
    ? { pinned: pinnedOrOptions, source: TRACKED_KEYWORD_SOURCE.MANUAL }
    : pinnedOrOptions;
  const config = readConfig(workspaceId);
  if (addTrackedKeywordToConfig(config, query, options)) writeConfig(workspaceId, config);
  return getTrackedKeywords(workspaceId);
}

export function addTrackedKeywords(
  workspaceId: string,
  entries: Array<{ query: string; options?: AddTrackedKeywordOptions }>,
): TrackedKeyword[] {
  const config = readConfig(workspaceId);
  let changed = false;
  for (const entry of entries) {
    changed = addTrackedKeywordToConfig(config, entry.query, entry.options ?? {}) || changed;
  }
  if (changed) writeConfig(workspaceId, config);
  return getTrackedKeywords(workspaceId);
}

export function removeTrackedKeyword(workspaceId: string, query: string): TrackedKeyword[] {
  const normalizedQuery = normalizeQuery(query);
  const config = readConfig(workspaceId);
  config.trackedKeywords = config.trackedKeywords.filter(k => normalizeQuery(k.query) !== normalizedQuery);
  writeConfig(workspaceId, config);
  return getTrackedKeywords(workspaceId);
}

export function togglePinKeyword(workspaceId: string, query: string): TrackedKeyword[] {
  const normalizedQuery = normalizeQuery(query);
  const config = readConfig(workspaceId);
  const kw = config.trackedKeywords.find(k => normalizeQuery(k.query) === normalizedQuery);
  if (kw) kw.pinned = !kw.pinned;
  writeConfig(workspaceId, config);
  return getTrackedKeywords(workspaceId);
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
  const tracked = queryFilter
    ? queryFilter
        .map(query => ({ lookup: normalizeQuery(query), output: query.trim() }))
        .filter(query => query.lookup && query.output)
    : config.trackedKeywords
      .filter(k => (k.status ?? TRACKED_KEYWORD_STATUS.ACTIVE) === TRACKED_KEYWORD_STATUS.ACTIVE)
      .map(k => ({ lookup: normalizeQuery(k.query), output: k.query }));

  return recent.map(snap => {
    const positions: Record<string, number> = {};
    const positionsByQuery = new Map(snap.queries.map(query => [normalizeQuery(query.query), query.position]));
    for (const q of tracked) {
      const position = positionsByQuery.get(q.lookup);
      if (position != null) positions[q.output] = position;
    }
    return { date: snap.date, positions };
  });
}

export type RankEntry = LatestRank;

function buildLatestRanks(workspaceId: string, options: { includeUntracked?: boolean } = {}): LatestRank[] {
  const snapshots = readSnapshots(workspaceId);
  if (snapshots.length === 0) return [];
  const latest = snapshots[snapshots.length - 1];
  const prev = snapshots.length >= 2 ? snapshots[snapshots.length - 2] : null;
  const config = readConfig(workspaceId);
  const hasConfiguredKeywords = config.trackedKeywords.length > 0;
  const trackedEntries = new Map(
    config.trackedKeywords
      .filter(k => (k.status ?? TRACKED_KEYWORD_STATUS.ACTIVE) === TRACKED_KEYWORD_STATUS.ACTIVE)
      .map(k => [normalizeQuery(k.query), k]),
  );

  // If a workspace only has retired lifecycle rows, do not fall back to all
  // snapshot queries; active rank views should reflect active tracked keywords.
  return latest.queries
    .filter(q => options.includeUntracked || !hasConfiguredKeywords || trackedEntries.has(normalizeQuery(q.query)))
    .map(q => {
      const normalizedQuery = normalizeQuery(q.query);
      const prevQ = prev?.queries.find(p => normalizeQuery(p.query) === normalizedQuery);
      const change = prevQ ? +(prevQ.position - q.position).toFixed(1) : undefined;
      const tracked = trackedEntries.get(normalizedQuery);
      return {
        ...q,
        query: tracked?.query ?? q.query,
        change,
        pinned: tracked?.pinned,
        source: tracked?.source,
        status: tracked?.status,
        pagePath: tracked?.pagePath,
        pageTitle: tracked?.pageTitle,
      };
    })
    .sort((a, b) => a.position - b.position);
}

export function getLatestRanks(workspaceId: string): LatestRank[] {
  return buildLatestRanks(workspaceId);
}

export function getLatestSnapshotRanks(workspaceId: string): LatestRank[] {
  return buildLatestRanks(workspaceId, { includeUntracked: true });
}
