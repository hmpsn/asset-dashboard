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
  strategy_owned: number | null;
  // Wave 3c-iii-a INTERNAL ordering column — the old blob array index. Read into the
  // row shape so listByWs can ORDER BY it, but NEVER projected into the returned
  // TrackedKeyword by rowToTrackedKeyword (it is not in the TrackedKeyword type and
  // must never leak to clients). NULLABLE/no-default: populated by the boot backfill
  // (from the live blob order) and re-stamped on every write from the array index.
  sort_order: number | null;
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
 * Wave 3d-i: source_gap_key IS now projected into `sourceGapKey` (the ADDITIVE
 * provenance pointer). This is the ADMIN/provenance-bearing read shape —
 * listTrackedKeywordRows uses this mapper directly, so it keeps sourceGapKey.
 * The general read path (getTrackedKeywords) goes through resolveTrackedKeywords,
 * which STRIPS sourceGapKey so getTrackedKeywords + the public serializers stay
 * byte-identical to today (no provenance leak).
 *
 * source_page_id remains DEFERRED and intentionally NOT projected — page_keywords
 * has no stable surrogate id (its PK is (workspace_id, page_path), migration 024),
 * and the only stable id is the mutable page_path, which the contract forbids.
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
    sourceGapKey: nullToUndefined(row.source_gap_key),
    // Wave 3d-ii tri-state: NULL column → undefined (ownership unknown); 1 → true
    // (reconcile owns it); 0 → false (explicitly not owned). `false` is a real
    // established value, NOT "empty" — do not collapse it to undefined.
    strategyOwned: row.strategy_owned === null ? undefined : row.strategy_owned === 1,
  };
}

/** undefined in-memory → NULL column (the inverse of nullToUndefined). */
function undefinedToNull<T>(value: T | undefined): T | null {
  return value === undefined ? null : value;
}

/** Map a TrackedKeyword to insert params. source_gap_key is now persisted from
 *  keyword.sourceGapKey (Wave 3d-i); source_page_id stays NULL (DEFERRED — no
 *  stable page_keywords surrogate id; see rowToTrackedKeyword).
 *
 *  Wave 3c-iii-a: `sortOrder` is the POSITIONAL array index from the writer loop —
 *  NOT a field on the TrackedKeyword object (it is internal ordering only). The
 *  caller threads in the loop index so a delete-then-reinsert re-stamps order from
 *  the canonical array position on every replace. */
function keywordToParams(workspaceId: string, keyword: TrackedKeyword, sortOrder: number | null) {
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
    source_page_id: null, // DEFERRED — no stable page_keywords surrogate id (migration 024).
    source_gap_key: undefinedToNull(keyword.sourceGapKey),
    // Wave 3d-ii tri-state: undefined → NULL (ownership unknown, conservative);
    // true → 1; false → 0. The ternary is deliberate (not `keyword.strategyOwned
    // ? 1 : 0`) so an undefined value stays NULL instead of collapsing to 0.
    strategy_owned: keyword.strategyOwned === undefined ? null : keyword.strategyOwned ? 1 : 0,
    // Wave 3c-iii-a: positional array index from the writer loop (NULL only on the
    // backfill UPDATE path, which sets it via a dedicated statement, not this insert).
    sort_order: sortOrder,
  };
}

// ── Lazy prepared statements ──

const stmts = createStmtCache(() => ({
  listByWs: db.prepare<[workspaceId: string]>(
    // Wave 3c-iii-a: order by the internal sort_order (the old blob array index),
    // with (added_at, normalized_query) as a deterministic tiebreaker for any
    // transiently-NULL sort_order (NULLs sort first under SQLite ASC; the write path
    // re-stamps within the same txn, so a persisted NULL is a transient state only).
    'SELECT * FROM tracked_keywords WHERE workspace_id = ? ORDER BY sort_order ASC, added_at ASC, normalized_query ASC',
  ),
  deleteAll: db.prepare<[workspaceId: string]>(
    'DELETE FROM tracked_keywords WHERE workspace_id = ?',
  ),
  countByWs: db.prepare<[workspaceId: string]>(
    'SELECT COUNT(*) as cnt FROM tracked_keywords WHERE workspace_id = ?',
  ),
  // Wave 3c-iii-a backfill (case B — already-backfilled workspaces whose rows
  // predate the sort_order column): stamp sort_order from the live blob's array
  // index for a single (workspace, normalized_query). IDEMPOTENT: only touches rows
  // whose sort_order IS NULL, so a re-run or a write-stamped row is a no-op.
  setSortOrderIfNull: db.prepare<[sortOrder: number, workspaceId: string, normalizedQuery: string]>(
    'UPDATE tracked_keywords SET sort_order = ? WHERE workspace_id = ? AND normalized_query = ? AND sort_order IS NULL',
  ),
  // Append-fallback (case B): rows present in the table but ABSENT from the blob —
  // still NULL after the blob-index pass above. Order them by (added_at,
  // normalized_query) so the assigned tail indices match the resolver ORDER BY
  // tiebreaker exactly, then assign sort_order = blob.length + i.
  listNullSortOrderByWs: db.prepare<[workspaceId: string]>(
    'SELECT normalized_query FROM tracked_keywords WHERE workspace_id = ? AND sort_order IS NULL ORDER BY added_at ASC, normalized_query ASC',
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
      replaced_by, deprecated_at, source_page_id, source_gap_key, strategy_owned,
      sort_order
    ) VALUES (
      @workspace_id, @normalized_query, @query, @pinned, @added_at,
      @source, @status, @page_path, @page_title,
      @strategy_generated_at, @last_strategy_seen_at, @intent,
      @volume, @difficulty, @cpc, @authority_posture,
      @baseline_position, @baseline_clicks, @baseline_impressions,
      @replaced_by, @deprecated_at, @source_page_id, @source_gap_key, @strategy_owned,
      @sort_order
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
      source_gap_key = excluded.source_gap_key,
      strategy_owned = excluded.strategy_owned,
      -- Wave 3c-iii-a: re-stamp ordering from the array position on EVERY replace.
      -- Delete-then-reinsert clobbers order otherwise; the conflict path (defensive,
      -- for a duplicate normalized_query) must also re-stamp so order stays canonical.
      sort_order = excluded.sort_order
  `),
}));

// ── Public API ──

/** All tracked-keyword rows for a workspace, in sort_order ASC (the old blob array
 *  index), with (added_at, normalized_query) as a transient-NULL tiebreaker. */
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
    // Wave 3c-iii-a: `keywords` IS the canonical order (mirroring the old blob array).
    // `position` is a monotonic counter incremented ONLY on an actual insert, so a
    // defensively-dropped blank does not leave the surviving rows' sort_order out of
    // step with the boot-backfill semantics (blob array index of surviving entries).
    let position = 0;
    for (const keyword of keywords) {
      const normalized = keywordComparisonKey(keyword.query);
      if (!normalized) continue; // mirror the blob path's blank-drop defensively
      upsert.run(keywordToParams(workspaceId, keyword, position));
      position++;
    }
  });
  run();
}

/** Delete all tracked-keyword rows for a workspace. */
export function deleteAllTrackedKeywordRows(workspaceId: string): void {
  stmts().deleteAll.run(workspaceId);
}

/**
 * Resolver — TABLE-FIRST / BLOB-FALLBACK (Wave 3c-ii read-switch; Wave 3c-iii-a
 * order-source switch). The ADDITIVE form, NOT the table-only strip (3c-iii-b).
 *
 * Logic:
 *   - countTrackedKeywordRows(workspaceId) === 0 → return `blobKeywords` (the table
 *     is empty: a legacy workspace not yet dual-written; fall back to the blob).
 *     This empty-table BLOB FALLBACK is KEPT this PR — the strip is 3c-iii-b.
 *   - otherwise → return the TABLE rows in their NATURAL ORDER, which is now the
 *     sort_order ASC sequence (listByWs orders by sort_order — the old blob array
 *     index, backfilled from the LIVE blob + re-stamped on every write). Each row is
 *     run through stripUndefinedKeys for blob-object-shape parity.
 *
 * Wave 3c-iii-a removed the Option-A blob-order reorder loop: ORDERING no longer
 * borrows the blob array index — sort_order does it directly. `blobKeywords` is
 * STILL passed (and still used) for the empty-table fallback above; the parameter
 * and signature are unchanged so callers are untouched. Net effect: data AND order
 * from the TABLE (sort_order), with the blob as the safety net only when empty.
 *
 * PROVENANCE STRIP (Wave 3d-i parity-safety mechanism): rowToTrackedKeyword NOW
 * projects source_gap_key into `sourceGapKey` (the ADDITIVE provenance pointer),
 * but the GENERAL read path (getTrackedKeywords + the public serializers) must
 * stay BYTE-IDENTICAL to today — no provenance may leak into it. So this resolver
 * STRIPS sourceGapKey (and the deferred sourcePageId) from every TABLE-sourced row
 * it returns. Provenance is read ONLY via the admin path (listTrackedKeywordRows /
 * rowToTrackedKeyword directly), which does NOT go through this resolver.
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
  // Provenance strip — these never belong in the general/public read shape, even
  // when set (a non-undefined sourceGapKey / strategyOwned would otherwise survive
  // the loop above). strategyOwned is TABLE-ONLY (Wave 3d-ii): it gates reconcile's
  // auto-deprecation and must be read from the table/hydrated shape, never leaked
  // into getTrackedKeywords or the public payload.
  delete out.sourceGapKey;
  delete out.sourcePageId;
  delete out.strategyOwned;
  return out as unknown as TrackedKeyword;
}

export function resolveTrackedKeywords(
  workspaceId: string,
  blobKeywords: TrackedKeyword[],
): TrackedKeyword[] {
  // Empty-table BLOB FALLBACK (KEPT until 3c-iii-b): a legacy workspace not yet
  // dual-written/backfilled falls back to the blob verbatim, blob order and all.
  if (countTrackedKeywordRows(workspaceId) === 0) return blobKeywords;

  // Wave 3c-iii-a: data AND order from the TABLE. listTrackedKeywordRows already
  // orders by sort_order ASC (the old blob array index, backfilled from the live
  // blob + re-stamped on every write), so the natural row order IS the verbatim
  // client-facing order — no blob-order reorder loop needed. Each row is run through
  // stripUndefinedKeys for blob-object-shape parity (drops undefined keys +
  // strips provenance/ownership-only fields).
  return listTrackedKeywordRows(workspaceId).map(stripUndefinedKeys);
}

/**
 * Optional source-stamping hook for the boot backfill: given the normalized
 * blob keywords for a workspace, return the same array with UNKNOWN-source rows
 * stamped with an inferred source (the inferTrackedKeywordSources ladder).
 * Injected from server/index.ts to avoid a static import cycle
 * (rank-tracking → store → keyword-command-center → rank-tracking). When not
 * provided, the backfill stamps nothing (rows keep their stored source).
 *
 * Wave 3d-ii: this boot backfill is the SOLE remaining caller of the inference
 * ladder — a legitimate ONE-TIME legacy stamp at populate time. The three
 * READ-TIME inference calls in keyword-command-center.ts were retired; KCC read
 * paths now consume the stored source / strategyOwned directly. Do not re-add a
 * read-time inference call.
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
 * Wave 3c-iii-a — sort_order backfill for an ALREADY-populated workspace (case B).
 * Builds keywordComparisonKey(query) -> blob array index from the normalized blob
 * and stamps sort_order for every still-NULL row. Append-fallback: table rows absent
 * from the blob (still NULL after the index pass) get sort_order = blob.length + i
 * ordered by (added_at, normalized_query) — matching the listByWs ORDER BY tail.
 * MUST be called inside the per-workspace write txn (it issues UPDATEs). Idempotent:
 * the UPDATE only touches sort_order IS NULL rows.
 */
function backfillSortOrderFromBlob(workspaceId: string, normalized: TrackedKeyword[]): void {
  const setSortOrderIfNull = stmts().setSortOrderIfNull;
  for (let i = 0; i < normalized.length; i++) {
    const key = keywordComparisonKey(normalized[i].query);
    if (!key) continue;
    setSortOrderIfNull.run(i, workspaceId, key);
  }
  // Append-fallback tail: rows in the table but NOT in the blob remain NULL. Order
  // them deterministically (the resolver tiebreaker) and append after the blob tail.
  const remaining = stmts().listNullSortOrderByWs.all(workspaceId) as { normalized_query: string }[];
  for (let i = 0; i < remaining.length; i++) {
    setSortOrderIfNull.run(normalized.length + i, workspaceId, remaining[i].normalized_query);
  }
}

/**
 * Boot backfill — populate tracked_keywords from each workspace's
 * rank_tracking_config.tracked_keywords blob.
 *
 * CAS-guarded per the audit's lost-update hazard: the per-workspace transaction runs
 * as BEGIN IMMEDIATE and re-checks countTrackedKeywordRows under the write lock, so a
 * concurrent dual-write that already populated the table cannot be double-inserted.
 *
 * ADDITIVE SHADOW: this step ONLY populates the table (rows + sort_order). It does
 * NOT strip the blob (shadow, not strip) and does NOT switch any read. There is no
 * CAS on the tracked_keywords blob column because the blob is left untouched.
 *
 * Source recovery: when a `stampSources` hook is provided, it runs ONCE per
 * workspace to stamp `source` for UNKNOWN-source rows via the canonical inference
 * ladder. It CANNOT recover MANUAL or RECOMMENDATION — those stay UNKNOWN explicitly
 * (never guessed). The deferred provenance columns are left NULL.
 *
 * Wave 3c-iii-a — sort_order population FROM THE LIVE BLOB ORDER (the load-bearing
 * step; must run WHILE the blob still has data, before the 3c-iii-b strip). Two
 * cases, distinguished by the CAS count under the write lock:
 *   (A) NEVER-BACKFILLED (table empty): insert each row with sort_order = its blob
 *       array index (the normalized-array position), in the row-insert path.
 *   (B) ALREADY-BACKFILLED (rows exist, sort_order IS NULL — the 3c-i case): the
 *       row-insert path is CAS-SKIPPED, but the sort_order UPDATE still runs (via
 *       backfillSortOrderFromBlob). This is the restructure the contract calls for:
 *       case B must run EVEN when countTrackedKeywordRows > 0 — those are exactly the
 *       rows needing sort_order — while the row-insert path stays CAS-guarded.
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
        if (countTrackedKeywordRows(row.workspace_id) > 0) {
          // Wave 3c-iii-a CASE B — table already populated (the 3c-i backfill ran
          // before this column existed). The row-insert path is CAS-skipped, but the
          // sort_order UPDATE MUST still run here: these are exactly the rows that
          // need stamping. Only touch sort_order IS NULL rows (idempotent).
          backfillSortOrderFromBlob(row.workspace_id, normalized);
          return 'already-migrated';
        }
        // Wave 3c-iii-a CASE A — never-backfilled: insert each row with its blob
        // array index as sort_order (the canonical order position).
        const upsert = stmts().upsert;
        for (let i = 0; i < normalized.length; i++) {
          upsert.run(keywordToParams(row.workspace_id, normalized[i], i));
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
