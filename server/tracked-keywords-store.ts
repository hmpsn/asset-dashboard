/**
 * tracked-keywords-store — row table for tracked_keywords (#12, Wave 3c-i).
 *
 * Promotes rank_tracking_config.tracked_keywords (one JSON blob per workspace)
 * into the indexed `tracked_keywords` row table keyed by
 * (workspace_id, normalized_query) where normalized_query = keywordComparisonKey(query).
 *
 * Wave 3c-i is the ADDITIVE SHADOW half: this module is wired as a DUAL-WRITE
 * inside withTrackedKeywordsTxn (the helper keeps writing the blob, then mirrors
 * the post-mutation set into this table — inside the SAME txn). READS STAY ON THE
 * BLOB: getTrackedKeywords and every consumer still read the blob this PR. There
 * is NO read-switch and NO strip here. The read-switch + blob strip + provenance
 * persist are later owner-gated PRs (3c-ii, 3d).
 *
 * rowToTrackedKeyword maps NULL columns to `undefined` (NEVER `null`) so the
 * shape is byte-identical to the blob path (JSON.stringify omits undefined),
 * targeting shared/types/rank-tracking.ts TrackedKeyword exactly. A parity
 * invariant test asserts the table mirrors the blob after every write.
 *
 * The provenance columns source_page_id / source_gap_key exist (additive,
 * nullable) but are left NULL this PR — populated in 3d.
 */
import db from './db/index.js';
import { createLogger } from './logger.js';
import { parseJsonFallback } from './db/json-validation.js';
import { createStmtCache } from './db/stmt-cache.js';
import { keywordComparisonKey } from '../shared/keyword-normalization.js';
import {
  TRACKED_KEYWORD_SOURCE,
  TRACKED_KEYWORD_STATUS,
  type TrackedKeyword,
  type TrackedKeywordAuthorityPosture,
  type TrackedKeywordSource,
  type TrackedKeywordStatus,
} from '../shared/types/rank-tracking.js';

const log = createLogger('tracked-keywords-store');

// ── SQLite row shape (mirrors migration 118) ──

export interface TrackedKeywordRow {
  workspace_id: string;
  normalized_query: string;
  query: string;
  pinned: number;
  added_at: string;
  source: string | null;
  status: string | null;
  page_path: string | null;
  page_title: string | null;
  strategy_generated_at: string | null;
  last_strategy_seen_at: string | null;
  intent: string | null;
  volume: number | null;
  difficulty: number | null;
  cpc: number | null;
  authority_posture: string | null;
  baseline_position: number | null;
  baseline_clicks: number | null;
  baseline_impressions: number | null;
  replaced_by: string | null;
  deprecated_at: string | null;
  source_page_id: string | null;
  source_gap_key: string | null;
}

/** A NULL column maps to `undefined` (omitted by JSON.stringify) — never `null` —
 *  so the serialized shape is byte-identical to the blob path. */
function nullToUndefined<T>(value: T | null): T | undefined {
  return value === null ? undefined : value;
}

/**
 * Map a row back to the in-memory TrackedKeyword, byte-identical to the blob
 * path: every optional column that is NULL becomes `undefined`, so the JSON
 * payload matches what readConfig() produces from the blob.
 *
 * Note: source_page_id / source_gap_key are intentionally NOT projected — they
 * are not part of the TrackedKeyword shape yet (added in 3d). Projecting them
 * here would diverge the shadow from the blob and break the parity invariant.
 */
export function rowToTrackedKeyword(row: TrackedKeywordRow): TrackedKeyword {
  return {
    query: row.query,
    pinned: row.pinned === 1,
    addedAt: row.added_at,
    source: nullToUndefined(row.source) as TrackedKeywordSource | undefined,
    status: nullToUndefined(row.status) as TrackedKeywordStatus | undefined,
    pagePath: nullToUndefined(row.page_path),
    pageTitle: nullToUndefined(row.page_title),
    strategyGeneratedAt: nullToUndefined(row.strategy_generated_at),
    lastStrategySeenAt: nullToUndefined(row.last_strategy_seen_at),
    intent: nullToUndefined(row.intent),
    volume: nullToUndefined(row.volume),
    difficulty: nullToUndefined(row.difficulty),
    cpc: nullToUndefined(row.cpc),
    authorityPosture: nullToUndefined(row.authority_posture) as TrackedKeywordAuthorityPosture | undefined,
    baselinePosition: nullToUndefined(row.baseline_position),
    baselineClicks: nullToUndefined(row.baseline_clicks),
    baselineImpressions: nullToUndefined(row.baseline_impressions),
    replacedBy: nullToUndefined(row.replaced_by),
    deprecatedAt: nullToUndefined(row.deprecated_at),
  };
}

/** undefined in-memory → NULL column (the inverse of nullToUndefined). */
function undefinedToNull<T>(value: T | undefined): T | null {
  return value === undefined ? null : value;
}

/** Map a TrackedKeyword to insert params. Provenance columns are left NULL this
 *  PR (populated in 3d). */
function keywordToParams(workspaceId: string, keyword: TrackedKeyword) {
  return {
    workspace_id: workspaceId,
    normalized_query: keywordComparisonKey(keyword.query),
    query: keyword.query,
    pinned: keyword.pinned ? 1 : 0,
    added_at: keyword.addedAt,
    source: undefinedToNull(keyword.source),
    status: undefinedToNull(keyword.status),
    page_path: undefinedToNull(keyword.pagePath),
    page_title: undefinedToNull(keyword.pageTitle),
    strategy_generated_at: undefinedToNull(keyword.strategyGeneratedAt),
    last_strategy_seen_at: undefinedToNull(keyword.lastStrategySeenAt),
    intent: undefinedToNull(keyword.intent),
    volume: undefinedToNull(keyword.volume),
    difficulty: undefinedToNull(keyword.difficulty),
    cpc: undefinedToNull(keyword.cpc),
    authority_posture: undefinedToNull(keyword.authorityPosture),
    baseline_position: undefinedToNull(keyword.baselinePosition),
    baseline_clicks: undefinedToNull(keyword.baselineClicks),
    baseline_impressions: undefinedToNull(keyword.baselineImpressions),
    replaced_by: undefinedToNull(keyword.replacedBy),
    deprecated_at: undefinedToNull(keyword.deprecatedAt),
    source_page_id: null,
    source_gap_key: null,
  };
}

// ── Lazy prepared statements ──

const stmts = createStmtCache(() => ({
  listByWs: db.prepare<[workspaceId: string]>(
    'SELECT * FROM tracked_keywords WHERE workspace_id = ? ORDER BY added_at ASC, normalized_query ASC',
  ),
  deleteAll: db.prepare<[workspaceId: string]>(
    'DELETE FROM tracked_keywords WHERE workspace_id = ?',
  ),
  countByWs: db.prepare<[workspaceId: string]>(
    'SELECT COUNT(*) as cnt FROM tracked_keywords WHERE workspace_id = ?',
  ),
  // ON CONFLICT DO UPDATE is defensive — JS dedup upstream guarantees no PK
  // conflicts on valid data, but a malformed legacy blob could in theory carry a
  // duplicate normalized_query. Last write wins, matching INSERT-then-UPDATE.
  upsert: db.prepare(`
    INSERT INTO tracked_keywords (
      workspace_id, normalized_query, query, pinned, added_at,
      source, status, page_path, page_title,
      strategy_generated_at, last_strategy_seen_at, intent,
      volume, difficulty, cpc, authority_posture,
      baseline_position, baseline_clicks, baseline_impressions,
      replaced_by, deprecated_at, source_page_id, source_gap_key
    ) VALUES (
      @workspace_id, @normalized_query, @query, @pinned, @added_at,
      @source, @status, @page_path, @page_title,
      @strategy_generated_at, @last_strategy_seen_at, @intent,
      @volume, @difficulty, @cpc, @authority_posture,
      @baseline_position, @baseline_clicks, @baseline_impressions,
      @replaced_by, @deprecated_at, @source_page_id, @source_gap_key
    )
    ON CONFLICT(workspace_id, normalized_query) DO UPDATE SET
      query = excluded.query,
      pinned = excluded.pinned,
      added_at = excluded.added_at,
      source = excluded.source,
      status = excluded.status,
      page_path = excluded.page_path,
      page_title = excluded.page_title,
      strategy_generated_at = excluded.strategy_generated_at,
      last_strategy_seen_at = excluded.last_strategy_seen_at,
      intent = excluded.intent,
      volume = excluded.volume,
      difficulty = excluded.difficulty,
      cpc = excluded.cpc,
      authority_posture = excluded.authority_posture,
      baseline_position = excluded.baseline_position,
      baseline_clicks = excluded.baseline_clicks,
      baseline_impressions = excluded.baseline_impressions,
      replaced_by = excluded.replaced_by,
      deprecated_at = excluded.deprecated_at,
      source_page_id = excluded.source_page_id,
      source_gap_key = excluded.source_gap_key
  `),
}));

// ── Public API ──

/** All tracked-keyword rows for a workspace (added_at ASC, then normalized_query). */
export function listTrackedKeywordRows(workspaceId: string): TrackedKeyword[] {
  const rows = stmts().listByWs.all(workspaceId) as TrackedKeywordRow[];
  return rows.map(rowToTrackedKeyword);
}

/** Count tracked-keyword rows for a workspace. */
export function countTrackedKeywordRows(workspaceId: string): number {
  return (stmts().countByWs.get(workspaceId) as { cnt: number }).cnt;
}

/**
 * Replace all tracked-keyword rows for a workspace with `keywords` (delete-then-
 * insert in a txn). Dedup-by-normalized_query + blank-drop is already guaranteed
 * upstream by normalizeTrackedKeywords, so PK conflicts cannot occur on valid
 * data — but the writer uses INSERT … ON CONFLICT DO UPDATE defensively.
 *
 * This is the DUAL-WRITE seam: withTrackedKeywordsTxn calls it AFTER writeConfig
 * writes the blob, inside the SAME txn (the helper runs under BEGIN IMMEDIATE or
 * inside the KCC outer txn — a wrapped db.transaction nests as a SAVEPOINT, so
 * calling this while already in a txn is safe and inherits the outer lock).
 *
 * An empty `keywords` array CLEARS the table (matches the blob writing `[]`),
 * keeping the shadow in sync incl. the empty-clear case.
 */
export function replaceAllTrackedKeywordRows(workspaceId: string, keywords: TrackedKeyword[]): void {
  const run = db.transaction(() => {
    stmts().deleteAll.run(workspaceId);
    const upsert = stmts().upsert;
    for (const keyword of keywords) {
      const normalized = keywordComparisonKey(keyword.query);
      if (!normalized) continue; // mirror the blob path's blank-drop defensively
      upsert.run(keywordToParams(workspaceId, keyword));
    }
  });
  run();
}

/** Delete all tracked-keyword rows for a workspace. */
export function deleteAllTrackedKeywordRows(workspaceId: string): void {
  stmts().deleteAll.run(workspaceId);
}

/**
 * Resolver — TABLE-FIRST / BLOB-FALLBACK (Wave 3c-ii; the ADDITIVE 3b-i form,
 * NOT the 3b-ii table-only strip). Mirrors resolveSiteKeywordMetrics' additive
 * shape, but with an Option-A reorder because tracked keywords are ORDER-SENSITIVE
 * (the blob array is in insertion/append order; readers map by normalizeQuery and
 * the public payload serializes the array as-is).
 *
 * Logic:
 *   - countTrackedKeywordRows(workspaceId) === 0 → return `blobKeywords` (the table
 *     is empty: a legacy workspace not yet dual-written; fall back to the blob).
 *   - otherwise → return the TABLE rows (data from the table) REORDERED to match
 *     the BLOB insertion order (order from the blob), so the result is
 *     byte-identical to today including ordering.
 *
 * Option-A reorder: listTrackedKeywordRows orders by (added_at, normalized_query),
 * which is NOT identical to blob insertion order for backfilled workspaces. We
 * therefore key the table rows by keywordComparisonKey(query) (the same
 * normalization the PK and normalizeQuery use) and emit one entry per blob element
 * IN BLOB ORDER, substituting the table row for that key (falling back to the blob
 * element only if a key is somehow absent from the table). Any table rows whose key
 * is NOT present in the blob are appended deterministically (added_at then
 * normalized_query — already the list order) — under dual-write parity there are
 * none. Net effect: data from the TABLE, order from the BLOB.
 *
 * source_page_id / source_gap_key are NOT projected (rowToTrackedKeyword omits them
 * — keep it that way; they are 3d, and projecting them would break byte-identity).
 *
 * Object-shape parity: rowToTrackedKeyword assigns EVERY optional field, so a NULL
 * column becomes an OWN property whose value is `undefined`. The blob path instead
 * STRIPS undefined keys (writeConfig JSON.stringify omits them; readConfig
 * JSON.parse never re-adds them), so a blob-sourced object has NO own property for
 * an absent field. JSON.stringify hides this difference, but `Object.keys` /
 * `toHaveProperty` (and existing reconcile tests) do not. To stay behavior-
 * identical we run each TABLE-sourced row through the SAME JSON round-trip the blob
 * path applies, dropping undefined-valued keys. Blob-sourced rows (fallback +
 * blob-only keys) already came through that round-trip in readConfig, so they are
 * passed through untouched.
 */
function stripUndefinedKeys(keyword: TrackedKeyword): TrackedKeyword {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(keyword)) {
    if (value !== undefined) out[key] = value;
  }
  return out as unknown as TrackedKeyword;
}

export function resolveTrackedKeywords(
  workspaceId: string,
  blobKeywords: TrackedKeyword[],
): TrackedKeyword[] {
  if (countTrackedKeywordRows(workspaceId) === 0) return blobKeywords;

  // Table is the data source. Key its rows by the same normalization the PK uses.
  // Each table row is normalized to the blob's object shape (undefined keys dropped).
  const tableByKey = new Map<string, TrackedKeyword>();
  const tableRows = listTrackedKeywordRows(workspaceId).map(stripUndefinedKeys);
  for (const row of tableRows) {
    tableByKey.set(keywordComparisonKey(row.query), row);
  }

  // Order from the blob: emit one entry per blob element, IN BLOB ORDER, using the
  // table row for that key (fall back to the blob element only if absent).
  const emittedKeys = new Set<string>();
  const ordered: TrackedKeyword[] = [];
  for (const blobKeyword of blobKeywords) {
    const key = keywordComparisonKey(blobKeyword.query);
    emittedKeys.add(key);
    ordered.push(tableByKey.get(key) ?? blobKeyword);
  }

  // Deterministically append any table rows whose key is NOT in the blob. Under
  // dual-write parity this is empty; listTrackedKeywordRows is already sorted by
  // (added_at, normalized_query), so iterating tableRows preserves that order.
  for (const row of tableRows) {
    const key = keywordComparisonKey(row.query);
    if (!emittedKeys.has(key)) {
      emittedKeys.add(key);
      ordered.push(row);
    }
  }

  return ordered;
}

/**
 * Optional source-stamping hook for the boot backfill: given the normalized
 * blob keywords for a workspace, return the same array with UNKNOWN-source rows
 * stamped with an inferred source (the canonical inferTrackedKeywordSources
 * ladder). Injected from server/index.ts to avoid a static import cycle
 * (rank-tracking → store → keyword-command-center → rank-tracking). When not
 * provided, the backfill stamps nothing (rows keep their stored source).
 */
export type TrackedKeywordSourceStamper = (
  workspaceId: string,
  keywords: TrackedKeyword[],
) => TrackedKeyword[];

/** Minimal blob shape the backfill parses out of rank_tracking_config. */
interface RawBlobKeyword {
  query?: unknown;
  pinned?: unknown;
  addedAt?: unknown;
  source?: unknown;
  status?: unknown;
  pagePath?: unknown;
  pageTitle?: unknown;
  strategyGeneratedAt?: unknown;
  lastStrategySeenAt?: unknown;
  intent?: unknown;
  volume?: unknown;
  difficulty?: unknown;
  cpc?: unknown;
  authorityPosture?: unknown;
  baselinePosition?: unknown;
  baselineClicks?: unknown;
  baselineImpressions?: unknown;
  replacedBy?: unknown;
  deprecatedAt?: unknown;
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}
function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * Normalize one raw blob entry into a TrackedKeyword, applying the SAME dedup
 * (keep FIRST, by keywordComparisonKey) + blank-drop the live blob path uses.
 * Returns null for blanks / already-seen keys.
 */
function normalizeBlobKeyword(raw: RawBlobKeyword, seen: Set<string>): TrackedKeyword | null {
  const display = typeof raw.query === 'string' ? raw.query.trim() : '';
  const key = keywordComparisonKey(display);
  if (!display || !key || seen.has(key)) return null;
  seen.add(key);
  return {
    query: display,
    pinned: Boolean(raw.pinned),
    addedAt: str(raw.addedAt) ?? new Date().toISOString(),
    source: (str(raw.source) as TrackedKeywordSource | undefined) ?? TRACKED_KEYWORD_SOURCE.UNKNOWN,
    status: (str(raw.status) as TrackedKeywordStatus | undefined) ?? TRACKED_KEYWORD_STATUS.ACTIVE,
    pagePath: str(raw.pagePath),
    pageTitle: str(raw.pageTitle),
    strategyGeneratedAt: str(raw.strategyGeneratedAt),
    lastStrategySeenAt: str(raw.lastStrategySeenAt),
    intent: str(raw.intent),
    volume: num(raw.volume),
    difficulty: num(raw.difficulty),
    cpc: num(raw.cpc),
    authorityPosture: str(raw.authorityPosture) as TrackedKeywordAuthorityPosture | undefined,
    baselinePosition: num(raw.baselinePosition),
    baselineClicks: num(raw.baselineClicks),
    baselineImpressions: num(raw.baselineImpressions),
    replacedBy: str(raw.replacedBy),
    deprecatedAt: str(raw.deprecatedAt),
  };
}

/**
 * Boot backfill — populate tracked_keywords from each workspace's
 * rank_tracking_config.tracked_keywords blob.
 *
 * POPULATE-ONLY and CAS-guarded per the audit's lost-update hazard: the
 * per-workspace transaction runs as BEGIN IMMEDIATE and re-checks
 * `countTrackedKeywordRows(...) === 0` after acquiring the write lock, so a
 * concurrent dual-write that already populated the table cannot be double-
 * inserted. Idempotent: skips workspaces whose table already has rows.
 *
 * ADDITIVE SHADOW: this step ONLY populates the table. It does NOT strip the
 * blob (shadow, not strip) and does NOT switch any read. There is no CAS on the
 * tracked_keywords blob column because the blob is left untouched.
 *
 * Source recovery: when a `stampSources` hook is provided, it runs ONCE per
 * workspace to stamp `source` for UNKNOWN-source rows via the canonical
 * inference ladder. It CANNOT recover MANUAL or RECOMMENDATION — those stay
 * UNKNOWN explicitly (never guessed). Provenance columns are left NULL this PR.
 */
export function migrateTrackedKeywordsFromConfigBlob(stampSources?: TrackedKeywordSourceStamper): void {
  const rows = db.prepare(`
    SELECT workspace_id, tracked_keywords FROM rank_tracking_config
    WHERE tracked_keywords IS NOT NULL AND tracked_keywords != ''
  `).all() as { workspace_id: string; tracked_keywords: string }[];

  let migrated = 0;
  let skipped = 0;

  for (const row of rows) {
    try {
      const parsed = parseJsonFallback<RawBlobKeyword[]>(row.tracked_keywords, []);
      if (!Array.isArray(parsed) || parsed.length === 0) continue;

      const seen = new Set<string>();
      let normalized: TrackedKeyword[] = [];
      for (const raw of parsed) {
        const kw = raw && typeof raw === 'object' ? normalizeBlobKeyword(raw, seen) : null;
        if (kw) normalized.push(kw);
      }
      if (normalized.length === 0) continue;

      // Stamp source ONCE for UNKNOWN-source rows (canonical inference ladder).
      if (stampSources) {
        try {
          normalized = stampSources(row.workspace_id, normalized);
        } catch (err) {
          log.error({ err, workspaceId: row.workspace_id }, 'Source inference failed during tracked_keywords backfill; using stored sources');
        }
      }

      const migrateOne = db.transaction((): 'migrated' | 'already-migrated' => {
        // CAS re-check under the write lock: a concurrent dual-write may have
        // populated the table between the unlocked read above and now.
        if (countTrackedKeywordRows(row.workspace_id) > 0) return 'already-migrated';
        const upsert = stmts().upsert;
        for (const keyword of normalized) {
          upsert.run(keywordToParams(row.workspace_id, keyword));
        }
        return 'migrated';
      });

      const outcome = migrateOne.immediate();
      if (outcome === 'already-migrated') {
        skipped++;
        continue;
      }

      migrated++;
      log.info({ workspaceId: row.workspace_id, keywords: normalized.length }, 'Backfilled tracked_keywords blob into tracked_keywords table');
    } catch (err) {
      log.error({ err, workspaceId: row.workspace_id }, 'Failed to backfill tracked_keywords');
    }
  }

  if (migrated > 0 || skipped > 0) {
    log.info({ migrated, skipped }, 'tracked_keywords backfill complete');
  }
}
