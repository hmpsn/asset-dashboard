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
import { listTrackedKeywordRows, replaceAllTrackedKeywordRows, resolveTrackedKeywords } from './tracked-keywords-store.js';

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
  /** Wave 3d-i ADDITIVE provenance — content-addressed gap key (see TrackedKeyword.sourceGapKey). */
  sourceGapKey?: string;
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
  getRecentSnapshots: db.prepare(
    `SELECT * FROM rank_snapshots WHERE workspace_id = ? ORDER BY date DESC LIMIT ?`,
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
  // Wave 3d-i ADDITIVE provenance. MUST be .optional(): the stored blob does NOT
  // carry sourceGapKey (it lives in the tracked_keywords TABLE, projected only via
  // the admin path; the blob will not carry it until a later wave). A REQUIRED
  // field absent from the stored blob makes every parseJsonSafeArray item fall to
  // its fallback — silently destroying all tracked-keyword data (Schema-vs-stored-
  // shape rule). normalizeTrackedKeywords passes it through via the `...keyword`
  // spread so it survives the read→mutate→write loop.
  sourceGapKey: z.string().optional(),
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
    // Wave 3d-i: provenance (sourceGapKey) lives ONLY in the tracked_keywords
    // TABLE, never the blob. Strip it here so the blob stays byte-identical to
    // pre-3d — the resolver fallback (empty table or blob-only key) must not be
    // able to leak provenance, and the 3c-i/3c-ii parity suites stay green.
    tracked_keywords: JSON.stringify(config.trackedKeywords, blobReplacer),
  });
}

/** Drop provenance-only keys when serializing the blob (see writeConfig). */
function blobReplacer(key: string, value: unknown): unknown {
  if (key === 'sourceGapKey' || key === 'sourcePageId') return undefined;
  return value;
}

function readSnapshots(workspaceId: string): RankSnapshot[] {
  const rows = stmts().getSnapshots.all(workspaceId) as SnapshotRow[];
  return rows.map(r => ({ date: r.date, queries: parseJsonFallback<RankSnapshot['queries']>(r.queries, []) }));
}

function readRecentSnapshots(workspaceId: string, limit: number): RankSnapshot[] {
  const rows = stmts().getRecentSnapshots.all(workspaceId, limit) as SnapshotRow[];
  return rows
    .map(r => ({ date: r.date, queries: parseJsonFallback<RankSnapshot['queries']>(r.queries, []) }))
    .reverse();
}

// --- Public API ---

export function getTrackedKeywords(workspaceId: string, options: GetTrackedKeywordsOptions = {}): TrackedKeyword[] {
  // Wave 3c-ii READ-SWITCH: resolve through the TABLE-FIRST/BLOB-FALLBACK resolver
  // (resolve first, filter second). The resolver returns the table rows reordered
  // into blob insertion order (byte-identical to today) or the blob verbatim when
  // the table is empty. The includeInactive short-circuit + active-status filter
  // below are UNCHANGED.
  const keywords = resolveTrackedKeywords(workspaceId, readConfig(workspaceId).trackedKeywords);
  if (options.includeInactive) return keywords;
  return keywords.filter(keyword => (keyword.status ?? TRACKED_KEYWORD_STATUS.ACTIVE) === TRACKED_KEYWORD_STATUS.ACTIVE);
}

/**
 * Nesting-safe, BEGIN IMMEDIATE wrapper for tracked_keywords read→mutate→write.
 *
 * Every writer that touches the tracked_keywords JSON blob MUST go through this
 * helper to prevent the lost-update race: two concurrent writers both reading the
 * same blob, mutating independently, and last-write-wins silently dropping keywords.
 *
 * Nesting guard: better-sqlite3 WRAPPED transactions (db.transaction(fn)()) do NOT
 * throw when nested — they downgrade to a SAVEPOINT and inherit the outer txn. (Only
 * a raw `db.prepare('BEGIN IMMEDIATE').run()` throws "cannot start a transaction
 * within a transaction".) So the db.inTransaction guard below is NOT a throw-avoider;
 * it is an optimisation that skips a needless inner SAVEPOINT and lets nested callers
 * inherit the outer txn's write lock directly. KCC wraps its outer action in
 * db.transaction() before calling updateTrackedKeywords → upsertTrackedKeywordByKey
 * → updateTrackedKeywords → withTrackedKeywordsTxn; the guard NO-OPs the inner BEGIN
 * so those nested callers run under the outer txn's serialisation.
 *
 * Returns the post-mutation TrackedKeyword[] so callers do NOT need a second
 * getTrackedKeywords() call (the "3×-parse fix").
 */
/**
 * Wave 3d-i: mutate `keywords` in place, filling each row's `sourceGapKey` from
 * the existing tracked_keywords TABLE (keyed by keywordComparisonKey) when the
 * row does not already carry one. FILL-IF-EMPTY: a value already present on the
 * in-memory row (e.g. a fresh gap-approve in the same write) is NOT overwritten by
 * the stored table value. Provenance lives only in the table, so this is how it
 * survives the blob-based read→mutate→write loop.
 */
function hydrateProvenanceFromTable(workspaceId: string, keywords: TrackedKeyword[]): void {
  if (keywords.length === 0) return;
  const stored = listTrackedKeywordRows(workspaceId);
  if (stored.length === 0) return;
  const gapKeyByQuery = new Map<string, string>();
  for (const row of stored) {
    if (row.sourceGapKey) gapKeyByQuery.set(normalizeQuery(row.query), row.sourceGapKey);
  }
  if (gapKeyByQuery.size === 0) return;
  for (const keyword of keywords) {
    if (keyword.sourceGapKey) continue; // fill-if-empty — don't clobber a fresh pointer
    const existing = gapKeyByQuery.get(normalizeQuery(keyword.query));
    if (existing) keyword.sourceGapKey = existing;
  }
}

export function withTrackedKeywordsTxn(
  workspaceId: string,
  updater: (current: TrackedKeyword[]) => TrackedKeyword[],
): TrackedKeyword[] {
  function run(): TrackedKeyword[] {
    const config = readConfig(workspaceId);
    // Wave 3d-i FILL-IF-EMPTY: the blob does NOT carry provenance (writeConfig
    // strips sourceGapKey), so hydrate it from the TABLE into the in-memory set
    // BEFORE the updater runs. This makes any existing pointer survive the
    // read→mutate→write loop: a status-only / reconcile updater (which copies the
    // current rows through) preserves it, while a gap-approve updater overwrites
    // it. replaceAllTrackedKeywordRows is delete-then-reinsert, so the in-memory
    // value is the ONLY source of truth on reinsert — without this hydrate a later
    // write would null out the provenance.
    hydrateProvenanceFromTable(workspaceId, config.trackedKeywords);
    config.trackedKeywords = normalizeTrackedKeywords(updater(config.trackedKeywords));
    writeConfig(workspaceId, config);
    // DUAL-WRITE (Wave 3c-i shadow): mirror the post-mutation set into the
    // tracked_keywords row table so the table stays in sync with the blob after
    // every write — including the empty-clear case (replaceAll with [] clears).
    // This runs INSIDE the same txn (BEGIN IMMEDIATE here, or the KCC outer txn
    // via the db.inTransaction guard below — a wrapped db.transaction nests as a
    // SAVEPOINT). The blob write above is KEPT (shadow, not strip); READS stay on
    // the blob — getTrackedKeywords and every consumer are unchanged this PR.
    replaceAllTrackedKeywordRows(workspaceId, config.trackedKeywords);
    return config.trackedKeywords;
  }

  // If we are already inside a transaction (e.g. KCC outer db.transaction()),
  // run the read+write directly — the outer txn provides the lock.
  if (db.inTransaction) {
    return run();
  }
  // Otherwise, open a BEGIN IMMEDIATE transaction to acquire a write lock
  // immediately, preventing concurrent readers from racing ahead of us.
  return db.transaction(run).immediate();
}

export function updateTrackedKeywords(
  workspaceId: string,
  updater: (keywords: TrackedKeyword[]) => TrackedKeyword[],
): TrackedKeyword[] {
  return withTrackedKeywordsTxn(workspaceId, updater);
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
    // Wave 3d-i FILL-IF-EMPTY: never overwrite an existing non-empty sourceGapKey.
    // (existing.sourceGapKey is already hydrated from the table by withTrackedKeywordsTxn.)
    // Drop it from the blind spread; re-apply only when the row has none yet.
    delete definedOptions.sourceGapKey;
    Object.assign(existing, {
      ...definedOptions,
      pinned: existing.pinned || Boolean(options.pinned),
      status: nextStatus,
      source: nextSource,
      replacedBy: nextStatus === TRACKED_KEYWORD_STATUS.ACTIVE ? undefined : existing.replacedBy,
      deprecatedAt: nextStatus === TRACKED_KEYWORD_STATUS.ACTIVE ? undefined : existing.deprecatedAt,
    });
    if (!existing.sourceGapKey && options.sourceGapKey) existing.sourceGapKey = options.sourceGapKey;
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
    sourceGapKey: options.sourceGapKey, // Wave 3d-i ADDITIVE provenance (gap-approve path).
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
  return withTrackedKeywordsTxn(workspaceId, existing => {
    const config = { trackedKeywords: existing };
    addTrackedKeywordToConfig(config, query, options);
    return config.trackedKeywords;
  }).filter(keyword => (keyword.status ?? TRACKED_KEYWORD_STATUS.ACTIVE) === TRACKED_KEYWORD_STATUS.ACTIVE);
}

export function addTrackedKeywords(
  workspaceId: string,
  entries: Array<{ query: string; options?: AddTrackedKeywordOptions }>,
): TrackedKeyword[] {
  return withTrackedKeywordsTxn(workspaceId, existing => {
    const config = { trackedKeywords: existing };
    for (const entry of entries) {
      addTrackedKeywordToConfig(config, entry.query, entry.options ?? {});
    }
    return config.trackedKeywords;
  }).filter(keyword => (keyword.status ?? TRACKED_KEYWORD_STATUS.ACTIVE) === TRACKED_KEYWORD_STATUS.ACTIVE);
}

export function removeTrackedKeyword(workspaceId: string, query: string): TrackedKeyword[] {
  const normalizedQuery = normalizeQuery(query);
  return withTrackedKeywordsTxn(workspaceId, existing =>
    existing.filter(k => normalizeQuery(k.query) !== normalizedQuery),
  ).filter(keyword => (keyword.status ?? TRACKED_KEYWORD_STATUS.ACTIVE) === TRACKED_KEYWORD_STATUS.ACTIVE);
}

export function togglePinKeyword(workspaceId: string, query: string): TrackedKeyword[] {
  const normalizedQuery = normalizeQuery(query);
  return withTrackedKeywordsTxn(workspaceId, existing => {
    const kw = existing.find(k => normalizeQuery(k.query) === normalizedQuery);
    if (kw) kw.pinned = !kw.pinned;
    return existing;
  }).filter(keyword => (keyword.status ?? TRACKED_KEYWORD_STATUS.ACTIVE) === TRACKED_KEYWORD_STATUS.ACTIVE);
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
  // Wave 3c-ii: route the direct readConfig read through the TABLE-FIRST resolver.
  // Order-safe — the inline active filter + normalizeQuery Map below are unchanged.
  const trackedKeywords = resolveTrackedKeywords(workspaceId, readConfig(workspaceId).trackedKeywords);
  const tracked = queryFilter
    ? queryFilter
        .map(query => ({ lookup: normalizeQuery(query), output: query.trim() }))
        .filter(query => query.lookup && query.output)
    : trackedKeywords
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
  const snapshots = readRecentSnapshots(workspaceId, 2);
  if (snapshots.length === 0) return [];
  const latest = snapshots[snapshots.length - 1];
  const prev = snapshots.length >= 2 ? snapshots[snapshots.length - 2] : null;
  const previousByQuery = new Map(
    (prev?.queries ?? []).map(query => [normalizeQuery(query.query), query]),
  );
  // Wave 3c-ii: route the direct readConfig read through the TABLE-FIRST resolver.
  // Order-safe — the inline active filter + normalizeQuery Map below are unchanged.
  const trackedKeywords = resolveTrackedKeywords(workspaceId, readConfig(workspaceId).trackedKeywords);
  const hasConfiguredKeywords = trackedKeywords.length > 0;
  const trackedEntries = new Map(
    trackedKeywords
      .filter(k => (k.status ?? TRACKED_KEYWORD_STATUS.ACTIVE) === TRACKED_KEYWORD_STATUS.ACTIVE)
      .map(k => [normalizeQuery(k.query), k]),
  );

  // If a workspace only has retired lifecycle rows, do not fall back to all
  // snapshot queries; active rank views should reflect active tracked keywords.
  return latest.queries
    .filter(q => options.includeUntracked || !hasConfiguredKeywords || trackedEntries.has(normalizeQuery(q.query)))
    .map(q => {
      const normalizedQuery = normalizeQuery(q.query);
      const prevQ = previousByQuery.get(normalizedQuery);
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
