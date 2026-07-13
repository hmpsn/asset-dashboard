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
import {
  keywordComparisonKey,
  keywordIdentityKeyV1,
  keywordIdentityKeyV2,
} from '../shared/keyword-normalization.js';
import type { TrackedKeywordIdentityMetadata } from '../shared/types/keyword-identity.js';
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

export interface TrackedKeywordV2Row {
  workspace_id: string;
  normalized_query_v2: string;
  normalized_query_v1: string;
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
  source_gap_key_v1: string | null;
  source_gap_key_v2: string | null;
  strategy_owned: number | null;
  sort_order: number | null;
  is_canonical: number;
  write_order: number;
}

export type StoredTrackedKeyword = TrackedKeyword & TrackedKeywordIdentityMetadata;

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

function compatRowToTrackedKeyword(row: TrackedKeywordV2Row): StoredTrackedKeyword {
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
    sourceGapKey: nullToUndefined(row.source_gap_key_v1),
    sourceGapKeyV2: nullToUndefined(row.source_gap_key_v2),
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

function keywordToCompatParams(
  workspaceId: string,
  keyword: StoredTrackedKeyword,
  sortOrder: number,
  writeOrder: number,
) {
  const v1 = keywordIdentityKeyV1(keyword.query);
  const v2 = keywordIdentityKeyV2(keyword.query);
  return {
    workspace_id: workspaceId,
    normalized_query_v2: v2,
    normalized_query_v1: v1,
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
    source_gap_key_v1: undefinedToNull(keyword.sourceGapKey),
    // Normal writers may only persist a v2 provenance key supplied by a caller
    // that holds the raw gap identity. Proven legacy-v1 derivation belongs to the
    // operator backfill, where ambiguity is measured and reported.
    source_gap_key_v2: undefinedToNull(keyword.sourceGapKeyV2),
    strategy_owned: keyword.strategyOwned === undefined ? null : keyword.strategyOwned ? 1 : 0,
    sort_order: sortOrder,
    is_canonical: 0,
    write_order: writeOrder,
  };
}

const STATUS_PRIORITY: Record<string, number> = {
  [TRACKED_KEYWORD_STATUS.ACTIVE]: 4,
  [TRACKED_KEYWORD_STATUS.PAUSED]: 3,
  [TRACKED_KEYWORD_STATUS.REPLACED]: 2,
  [TRACKED_KEYWORD_STATUS.DEPRECATED]: 1,
};

const SOURCE_PRIORITY: Record<string, number> = {
  [TRACKED_KEYWORD_SOURCE.CLIENT_REQUESTED]: 7,
  [TRACKED_KEYWORD_SOURCE.MANUAL]: 6,
  [TRACKED_KEYWORD_SOURCE.CONTENT_GAP]: 5,
  [TRACKED_KEYWORD_SOURCE.RECOMMENDATION]: 4,
  [TRACKED_KEYWORD_SOURCE.STRATEGY_PRIMARY]: 3,
  [TRACKED_KEYWORD_SOURCE.STRATEGY_SITE_KEYWORD]: 2,
  [TRACKED_KEYWORD_SOURCE.UNKNOWN]: 1,
};

function validTime(value: string | null): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function compareBinaryUtf8(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

function compareNullableLatest(a: string | null, b: string | null): number {
  const at = validTime(a);
  const bt = validTime(b);
  if (at === null) return bt === null ? 0 : 1;
  if (bt === null) return -1;
  return bt - at;
}

function compareTrackedCanonical(a: TrackedKeywordV2Row, b: TrackedKeywordV2Row): number {
  if (a.pinned !== b.pinned) return b.pinned - a.pinned;
  const status = (STATUS_PRIORITY[b.status ?? ''] ?? 0) - (STATUS_PRIORITY[a.status ?? ''] ?? 0);
  if (status !== 0) return status;
  const source = (SOURCE_PRIORITY[b.source ?? ''] ?? 0) - (SOURCE_PRIORITY[a.source ?? ''] ?? 0);
  if (source !== 0) return source;
  const lastSeen = compareNullableLatest(a.last_strategy_seen_at, b.last_strategy_seen_at);
  if (lastSeen !== 0) return lastSeen;
  const generated = compareNullableLatest(a.strategy_generated_at, b.strategy_generated_at);
  if (generated !== 0) return generated;
  const aa = validTime(a.added_at);
  const ba = validTime(b.added_at);
  if (aa !== ba) {
    if (aa === null) return 1;
    if (ba === null) return -1;
    return aa - ba;
  }
  if (a.sort_order !== b.sort_order) {
    if (a.sort_order === null) return 1;
    if (b.sort_order === null) return -1;
    return a.sort_order - b.sort_order;
  }
  return compareBinaryUtf8(a.query, b.query);
}

function trackedPayloadChanged(
  existing: TrackedKeywordV2Row | undefined,
  params: ReturnType<typeof keywordToCompatParams>,
): boolean {
  if (!existing) return true;
  const desiredSourcePageId = params.source_page_id ?? existing.source_page_id;
  const desiredSourceGapKeyV2 = params.source_gap_key_v2 ?? existing.source_gap_key_v2;
  return existing.normalized_query_v1 !== params.normalized_query_v1
    || existing.pinned !== params.pinned
    || existing.added_at !== params.added_at
    || existing.source !== params.source
    || existing.status !== params.status
    || existing.page_path !== params.page_path
    || existing.page_title !== params.page_title
    || existing.strategy_generated_at !== params.strategy_generated_at
    || existing.last_strategy_seen_at !== params.last_strategy_seen_at
    || existing.intent !== params.intent
    || existing.volume !== params.volume
    || existing.difficulty !== params.difficulty
    || existing.cpc !== params.cpc
    || existing.authority_posture !== params.authority_posture
    || existing.baseline_position !== params.baseline_position
    || existing.baseline_clicks !== params.baseline_clicks
    || existing.baseline_impressions !== params.baseline_impressions
    || existing.replaced_by !== params.replaced_by
    || existing.deprecated_at !== params.deprecated_at
    || existing.source_page_id !== desiredSourcePageId
    || existing.source_gap_key_v1 !== params.source_gap_key_v1
    || existing.source_gap_key_v2 !== desiredSourceGapKeyV2
    || existing.strategy_owned !== params.strategy_owned;
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
  listCompatByWs: db.prepare<[workspaceId: string]>(`
    SELECT * FROM tracked_keywords_v2_compat
    WHERE workspace_id = ?
    ORDER BY normalized_query_v2 ASC, query ASC
  `),
  listCompatCanonicalByWs: db.prepare<[workspaceId: string]>(`
    SELECT * FROM tracked_keywords_v2_compat
    WHERE workspace_id = ? AND is_canonical = 1
    ORDER BY sort_order ASC, added_at ASC, normalized_query_v2 ASC, query ASC
  `),
  listLegacyFallbackByWs: db.prepare<[workspaceId: string]>(`
    SELECT legacy.* FROM tracked_keywords legacy
    WHERE legacy.workspace_id = ?
      AND NOT EXISTS (
        SELECT 1 FROM tracked_keywords_v2_compat compat
        WHERE compat.workspace_id = legacy.workspace_id
          AND compat.normalized_query_v1 = legacy.normalized_query
      )
    ORDER BY legacy.sort_order ASC, legacy.added_at ASC, legacy.normalized_query ASC
  `),
  maxCompatWriteOrder: db.prepare<[workspaceId: string]>(`
    SELECT COALESCE(MAX(write_order), 0) AS value
    FROM tracked_keywords_v2_compat WHERE workspace_id = ?
  `),
  upsertCompat: db.prepare(`
    INSERT INTO tracked_keywords_v2_compat (
      workspace_id, normalized_query_v2, normalized_query_v1, query,
      pinned, added_at, source, status, page_path, page_title,
      strategy_generated_at, last_strategy_seen_at, intent, volume, difficulty, cpc,
      authority_posture, baseline_position, baseline_clicks, baseline_impressions,
      replaced_by, deprecated_at, source_page_id, source_gap_key_v1, source_gap_key_v2,
      strategy_owned, sort_order, is_canonical, write_order
    ) VALUES (
      @workspace_id, @normalized_query_v2, @normalized_query_v1, @query,
      @pinned, @added_at, @source, @status, @page_path, @page_title,
      @strategy_generated_at, @last_strategy_seen_at, @intent, @volume, @difficulty, @cpc,
      @authority_posture, @baseline_position, @baseline_clicks, @baseline_impressions,
      @replaced_by, @deprecated_at, @source_page_id, @source_gap_key_v1, @source_gap_key_v2,
      @strategy_owned, @sort_order, @is_canonical, @write_order
    )
    ON CONFLICT(workspace_id, normalized_query_v2, query) DO UPDATE SET
      normalized_query_v1 = excluded.normalized_query_v1,
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
      source_page_id = COALESCE(tracked_keywords_v2_compat.source_page_id, excluded.source_page_id),
      source_gap_key_v1 = excluded.source_gap_key_v1,
      source_gap_key_v2 = COALESCE(tracked_keywords_v2_compat.source_gap_key_v2, excluded.source_gap_key_v2),
      strategy_owned = excluded.strategy_owned,
      sort_order = excluded.sort_order,
      write_order = excluded.write_order
  `),
  demoteCompatGroup: db.prepare<[workspaceId: string, v2: string]>(`
    UPDATE tracked_keywords_v2_compat SET is_canonical = 0
    WHERE workspace_id = ? AND normalized_query_v2 = ? AND is_canonical = 1
  `),
  promoteCompatRaw: db.prepare<[workspaceId: string, v2: string, raw: string]>(`
    UPDATE tracked_keywords_v2_compat SET is_canonical = 1
    WHERE workspace_id = ? AND normalized_query_v2 = ? AND query = ?
  `),
  deleteCompatGroup: db.prepare<[workspaceId: string, v2: string]>(`
    DELETE FROM tracked_keywords_v2_compat WHERE workspace_id = ? AND normalized_query_v2 = ?
  `),
  deleteAllCompat: db.prepare<[workspaceId: string]>(`
    DELETE FROM tracked_keywords_v2_compat WHERE workspace_id = ?
  `),
}));

// ── Public API ──

/** All tracked-keyword rows for a workspace, in sort_order ASC (the old blob array
 *  index), with (added_at, normalized_query) as a transient-NULL tiebreaker. */
export function listTrackedKeywordRows(workspaceId: string): StoredTrackedKeyword[] {
  const compat = stmts().listCompatCanonicalByWs.all(workspaceId) as TrackedKeywordV2Row[];
  const legacy = stmts().listLegacyFallbackByWs.all(workspaceId) as TrackedKeywordRow[];
  return [
    ...compat.map(row => ({ keyword: compatRowToTrackedKeyword(row), sortOrder: row.sort_order })),
    ...legacy.map(row => ({ keyword: rowToTrackedKeyword(row), sortOrder: row.sort_order })),
  ].sort((a, b) => {
    if (a.sortOrder !== b.sortOrder) {
      if (a.sortOrder === null) return 1;
      if (b.sortOrder === null) return -1;
      return a.sortOrder - b.sortOrder;
    }
    return a.keyword.addedAt.localeCompare(b.keyword.addedAt)
      || a.keyword.query.localeCompare(b.keyword.query);
  }).map(entry => entry.keyword);
}

/** Count tracked-keyword rows for a workspace. */
export function countTrackedKeywordRows(workspaceId: string): number {
  return listTrackedKeywordRows(workspaceId).length;
}

function rebuildTrackedKeywordV1Projection(workspaceId: string): void {
  const canonicalRows = stmts().listCompatCanonicalByWs.all(workspaceId) as TrackedKeywordV2Row[];
  const winnerByV1 = new Map<string, TrackedKeywordV2Row>();
  for (const row of canonicalRows) {
    if (!row.normalized_query_v1) continue;
    const existing = winnerByV1.get(row.normalized_query_v1);
    if (
      !existing
      || row.write_order > existing.write_order
      || (row.write_order === existing.write_order && compareTrackedCanonical(row, existing) < 0)
    ) {
      winnerByV1.set(row.normalized_query_v1, row);
    }
  }
  stmts().deleteAll.run(workspaceId);
  for (const row of winnerByV1.values()) {
    stmts().upsert.run(keywordToParams(workspaceId, compatRowToTrackedKeyword(row), row.sort_order));
  }
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
    const existingRows = stmts().listCompatByWs.all(workspaceId) as TrackedKeywordV2Row[];
    const existingByV2 = new Map<string, TrackedKeywordV2Row[]>();
    for (const row of existingRows) {
      const rows = existingByV2.get(row.normalized_query_v2) ?? [];
      rows.push(row);
      existingByV2.set(row.normalized_query_v2, rows);
    }

    const submittedByV2 = new Map<string, Array<{ keyword: StoredTrackedKeyword; sortOrder: number }>>();
    for (let index = 0; index < keywords.length; index++) {
      const keyword = keywords[index] as StoredTrackedKeyword;
      const raw = keyword.query.trim();
      const v2 = keywordIdentityKeyV2(raw);
      if (!raw || !v2) continue;
      const rows = submittedByV2.get(v2) ?? [];
      const prior = rows.findIndex(item => item.keyword.query === raw);
      const item = { keyword: { ...keyword, query: raw }, sortOrder: index };
      if (prior >= 0) rows[prior] = item;
      else rows.push(item);
      submittedByV2.set(v2, rows);
    }

    for (const v2 of existingByV2.keys()) {
      if (!submittedByV2.has(v2)) stmts().deleteCompatGroup.run(workspaceId, v2);
    }

    let writeOrder = (stmts().maxCompatWriteOrder.get(workspaceId) as { value: number }).value;
    const submittedGroups = [...submittedByV2.entries()].sort(([aV2, aRows], [bV2, bRows]) => {
      const v1Order = compareBinaryUtf8(
        keywordIdentityKeyV1(aRows[0].keyword.query),
        keywordIdentityKeyV1(bRows[0].keyword.query),
      );
      return v1Order || compareBinaryUtf8(aV2, bV2);
    });
    for (const [v2, submittedUnsorted] of submittedGroups) {
      const submitted = [...submittedUnsorted].sort((a, b) =>
        compareBinaryUtf8(a.keyword.query, b.keyword.query));
      const priorCanonical = existingByV2.get(v2)?.find(row => row.is_canonical === 1);
      for (const item of submitted) {
        const existing = existingByV2.get(v2)?.find(row => row.query === item.keyword.query);
        const candidateParams = keywordToCompatParams(
          workspaceId,
          item.keyword,
          item.sortOrder,
          existing?.write_order ?? writeOrder + 1,
        );
        const nextWriteOrder = trackedPayloadChanged(existing, candidateParams)
          ? ++writeOrder
          : existing!.write_order;
        stmts().upsertCompat.run({ ...candidateParams, write_order: nextWriteOrder });
      }
      const refreshed = (stmts().listCompatByWs.all(workspaceId) as TrackedKeywordV2Row[])
        .filter(row => row.normalized_query_v2 === v2);
      const retained = priorCanonical
        ? submitted.find(item => item.keyword.query === priorCanonical.query)
        : undefined;
      const submittedRaw = new Set(submitted.map(item => item.keyword.query));
      const candidates = refreshed.filter(row => submittedRaw.has(row.query));
      const winnerRaw = retained?.keyword.query ?? [...candidates].sort(compareTrackedCanonical)[0]?.query;
      if (!winnerRaw) continue;
      stmts().demoteCompatGroup.run(workspaceId, v2);
      stmts().promoteCompatRaw.run(workspaceId, v2, winnerRaw);
    }
    rebuildTrackedKeywordV1Projection(workspaceId);
  });
  run();
}

/** Delete all tracked-keyword rows for a workspace. */
export function deleteAllTrackedKeywordRows(workspaceId: string): void {
  const run = db.transaction(() => {
    stmts().deleteAllCompat.run(workspaceId);
    stmts().deleteAll.run(workspaceId);
  });
  run();
}

/**
 * Resolver — TABLE-ONLY (Wave 3c-iii-b strip). The blob is NO LONGER a store: the
 * tracked_keywords row table is the SOLE source of both data AND order, and
 * writeConfig now writes `'[]'` (the blob is kept-but-empty for rollback safety).
 *
 * Logic: return the TABLE rows in their NATURAL ORDER, which is the sort_order ASC
 * sequence (listByWs orders by sort_order — the old blob array index, backfilled
 * from the LIVE blob by the boot backfill + re-stamped on every write). An empty
 * table returns an EMPTY array — there is NO blob fallback anymore. Each row is run
 * through stripUndefinedKeys for blob-object-shape parity.
 *
 * Wave 3c-iii-b removed the `blobKeywords` parameter and the
 * countTrackedKeywordRows===0 blob fallback (3c-iii-a kept them; the strip removes
 * them). sort_order is now populated (the boot backfill ran while the blob still had
 * data), so reads keep exact order from the table alone.
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
 * STRIPPED undefined keys (the legacy blob JSON.stringify omitted them; JSON.parse
 * never re-added them), so a blob-sourced object had NO own property for an absent
 * field. JSON.stringify hides this difference, but `Object.keys` / `toHaveProperty`
 * (and existing reconcile tests) do not. To stay behavior-identical we run each
 * TABLE-sourced row through the SAME JSON round-trip the blob path applied, dropping
 * undefined-valued keys.
 */
function stripUndefinedKeys(keyword: StoredTrackedKeyword): TrackedKeyword {
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
  delete out.sourceGapKeyV2;
  delete out.sourcePageId;
  delete out.strategyOwned;
  return out as unknown as TrackedKeyword;
}

export function resolveTrackedKeywords(workspaceId: string): TrackedKeyword[] {
  // Wave 3c-iii-b TABLE-ONLY: data AND order from the TABLE — the SOLE store.
  // listTrackedKeywordRows already orders by sort_order ASC (the old blob array
  // index, backfilled from the live blob + re-stamped on every write), so the
  // natural row order IS the verbatim client-facing order. An empty table returns
  // an EMPTY array — there is no blob fallback (the strip removed it). Each row is
  // run through stripUndefinedKeys for blob-object-shape parity (drops undefined
  // keys + strips provenance/ownership-only fields).
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
