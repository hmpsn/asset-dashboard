/**
 * Keyword feedback compatibility service.
 *
 * K3b makes the Unicode-safe v2 sidecar authoritative while maintaining the
 * legacy v1 table as a deterministic rollback projection. All feedback readers
 * and writers, including the Keyword Command Center, must go through here.
 */

import type {
  AdminKeywordFeedbackListRow,
  KeywordFeedbackBulkMutationResponse,
  KeywordFeedbackDeleteResponse,
  KeywordFeedbackListRow,
  KeywordFeedbackMutationResponse,
  KeywordFeedbackSource,
  KeywordFeedbackStatus,
} from '../shared/types/keyword-feedback.js';
import type { ClientSignalsSlice } from '../shared/types/intelligence.js';
import { keywordIdentityKeys } from '../shared/keyword-normalization.js';
import db from './db/index.js';
import { createStmtCache } from './db/stmt-cache.js';
import { trackedKeywordSourceForFeedback } from './keyword-feedback-tracking.js';
import { invalidateKeywordStrategyGenerationInputs } from './keyword-strategy-generation-store.js';
import { addTrackedKeyword, addTrackedKeywords } from './rank-tracking.js';
import type { AddTrackedKeywordOptions } from './rank-tracking.js';
import { invalidateIntelligenceCache } from './intelligence/cache-invalidation.js';
import { broadcastToWorkspace } from './broadcast.js';
import { WS_EVENTS } from './ws-events.js';

export type KeywordFeedbackInternalSource = KeywordFeedbackSource | 'command_center' | null;

export interface KeywordFeedbackInternalRow {
  keyword: string;
  status: KeywordFeedbackStatus;
  reason: string | null;
  source: KeywordFeedbackInternalSource;
  declined_by: string | null;
  created_at: string | null;
  updated_at: string | null;
  /** Present only for authoritative v2 rows. */
  keyword_v2?: string;
  /** Present only for authoritative v2 rows. */
  keyword_v1?: string;
  /** Authoritative rows sort ahead of legacy aliases. */
  write_order?: number;
}

interface V2FeedbackDbRow {
  keyword_v2: string;
  raw_keyword: string;
  keyword_v1: string;
  status: string;
  reason: string | null;
  source: string | null;
  declined_by: string | null;
  created_at: string;
  updated_at: string;
  write_order: number;
}

interface LegacyFeedbackDbRow {
  keyword: string;
  status: string;
  reason: string | null;
  source: string | null;
  declined_by: string | null;
  created_at: string | null;
  updated_at: string | null;
}

interface SaveKeywordFeedbackInput {
  workspaceId: string;
  keyword: string;
  status: KeywordFeedbackStatus;
  reason?: string | null;
  source?: KeywordFeedbackSource | null;
  declinedBy?: string | null;
}

interface SaveBulkKeywordFeedbackInput {
  workspaceId: string;
  keywords: Array<{
    keyword: string;
    status: KeywordFeedbackStatus;
    reason?: string | null;
    source?: KeywordFeedbackSource | null;
  }>;
  declinedBy?: string | null;
}

export interface SaveKeywordFeedbackDecisionInput {
  workspaceId: string;
  keyword: string;
  status: KeywordFeedbackStatus;
  reason?: string | null;
  source?: KeywordFeedbackInternalSource;
  declinedBy?: string | null;
  trackApprovedKeyword?: boolean;
}

export class KeywordFeedbackBulkConflictError extends Error {
  readonly code = 'keyword_feedback_v2_conflict';
  readonly keywordV2: string;

  constructor(keywordV2: string) {
    super(`Conflicting feedback was supplied for keyword identity "${keywordV2}"`);
    this.name = 'KeywordFeedbackBulkConflictError';
    this.keywordV2 = keywordV2;
  }
}

const stmts = createStmtCache(() => ({
  listV2: db.prepare<[workspaceId: string]>(`
    SELECT keyword_v2, raw_keyword, keyword_v1, status, reason, source,
           declined_by, created_at, updated_at, write_order
      FROM keyword_feedback_v2_compat
     WHERE workspace_id = ?
     ORDER BY write_order DESC, updated_at DESC, raw_keyword COLLATE BINARY ASC
  `),
  listLegacyArchive: db.prepare<[workspaceId: string]>(`
    SELECT keyword_v1 AS keyword, status, reason, source, declined_by, created_at, updated_at
      FROM keyword_feedback_v1_legacy_aliases
     WHERE workspace_id = ?
  `),
  listUnmarkedLegacy: db.prepare<[workspaceId: string]>(`
    SELECT f.keyword, f.status, f.reason, f.source, f.declined_by, f.created_at, f.updated_at
      FROM keyword_feedback f
      LEFT JOIN keyword_feedback_v1_projection_keys p
        ON p.workspace_id = f.workspace_id AND p.keyword_v1 = f.keyword
     WHERE f.workspace_id = ? AND p.keyword_v1 IS NULL
  `),
  getV2: db.prepare<[workspaceId: string, keywordV2: string]>(`
    SELECT keyword_v2, raw_keyword, keyword_v1, status, reason, source,
           declined_by, created_at, updated_at, write_order
      FROM keyword_feedback_v2_compat
     WHERE workspace_id = ? AND keyword_v2 = ?
  `),
  getLegacyArchive: db.prepare<[workspaceId: string, keywordV1: string]>(`
    SELECT keyword_v1 AS keyword, status, reason, source, declined_by, created_at, updated_at
      FROM keyword_feedback_v1_legacy_aliases
     WHERE workspace_id = ? AND keyword_v1 = ?
  `),
  getUnmarkedLegacy: db.prepare<[workspaceId: string, keywordV1: string]>(`
    SELECT f.keyword, f.status, f.reason, f.source, f.declined_by, f.created_at, f.updated_at
      FROM keyword_feedback f
      LEFT JOIN keyword_feedback_v1_projection_keys p
        ON p.workspace_id = f.workspace_id AND p.keyword_v1 = f.keyword
     WHERE f.workspace_id = ? AND f.keyword = ? AND p.keyword_v1 IS NULL
  `),
  nextWriteOrder: db.prepare<[workspaceId: string]>(`
    SELECT COALESCE(MAX(write_order), 0) + 1 AS next_order
      FROM keyword_feedback_v2_compat WHERE workspace_id = ?
  `),
  upsertV2: db.prepare(`
    INSERT INTO keyword_feedback_v2_compat (
      workspace_id, keyword_v2, raw_keyword, keyword_v1, status, reason, source,
      declined_by, created_at, updated_at, write_order
    ) VALUES (
      @workspace_id, @keyword_v2, @raw_keyword, @keyword_v1, @status, @reason, @source,
      @declined_by, @created_at, @updated_at, @write_order
    )
    ON CONFLICT(workspace_id, keyword_v2) DO UPDATE SET
      raw_keyword = excluded.raw_keyword,
      keyword_v1 = excluded.keyword_v1,
      status = excluded.status,
      reason = excluded.reason,
      source = excluded.source,
      declined_by = excluded.declined_by,
      updated_at = excluded.updated_at,
      write_order = excluded.write_order
  `),
  upsertAlias: db.prepare(`
    INSERT INTO keyword_feedback_v2_aliases (
      workspace_id, keyword_v2, keyword_v1, raw_keyword, first_seen_at, last_seen_at
    ) VALUES (@workspace_id, @keyword_v2, @keyword_v1, @raw_keyword, @now, @now)
    ON CONFLICT(workspace_id, keyword_v2, raw_keyword) DO UPDATE SET
      keyword_v1 = excluded.keyword_v1,
      last_seen_at = excluded.last_seen_at
  `),
  getProjectionMarker: db.prepare<[workspaceId: string, keywordV1: string]>(`
    SELECT keyword_v1 FROM keyword_feedback_v1_projection_keys
     WHERE workspace_id = ? AND keyword_v1 = ?
  `),
  getLegacyMain: db.prepare<[workspaceId: string, keywordV1: string]>(`
    SELECT id, keyword, status, reason, source, declined_by, created_at, updated_at
      FROM keyword_feedback WHERE workspace_id = ? AND keyword = ?
  `),
  archiveLegacy: db.prepare(`
    INSERT OR IGNORE INTO keyword_feedback_v1_legacy_aliases (
      workspace_id, keyword_v1, legacy_id, status, reason, source, declined_by,
      created_at, updated_at, archived_at
    ) VALUES (
      @workspace_id, @keyword_v1, @legacy_id, @status, @reason, @source, @declined_by,
      @created_at, @updated_at, @archived_at
    )
  `),
  markProjection: db.prepare(`
    INSERT OR IGNORE INTO keyword_feedback_v1_projection_keys (workspace_id, keyword_v1, projected_at)
    VALUES (@workspace_id, @keyword_v1, @projected_at)
  `),
  projectionWinner: db.prepare<[workspaceId: string, keywordV1: string, aliasKeywordV1: string]>(`
    SELECT keyword_v2, raw_keyword, keyword_v1, status, reason, source,
           declined_by, created_at, updated_at, write_order
      FROM keyword_feedback_v2_compat f
     WHERE f.workspace_id = ?
       AND (f.keyword_v1 = ? OR EXISTS (
         SELECT 1 FROM keyword_feedback_v2_aliases a
          WHERE a.workspace_id = f.workspace_id
            AND a.keyword_v2 = f.keyword_v2
            AND a.keyword_v1 = ?
       ))
     ORDER BY write_order DESC, updated_at DESC, raw_keyword COLLATE BINARY ASC
     LIMIT 1
  `),
  v1KeysForV2: db.prepare<[
    workspaceId: string,
    keywordV2: string,
    aliasWorkspaceId: string,
    aliasKeywordV2: string,
  ]>(`
    SELECT keyword_v1 FROM keyword_feedback_v2_compat
     WHERE workspace_id = ? AND keyword_v2 = ? AND keyword_v1 <> ''
    UNION
    SELECT keyword_v1 FROM keyword_feedback_v2_aliases
     WHERE workspace_id = ? AND keyword_v2 = ? AND keyword_v1 <> ''
  `),
  upsertProjection: db.prepare(`
    INSERT INTO keyword_feedback (
      workspace_id, keyword, status, reason, source, declined_by, created_at, updated_at
    ) VALUES (
      @workspace_id, @keyword, @status, @reason, @source, @declined_by, @created_at, @updated_at
    )
    ON CONFLICT(workspace_id, keyword) DO UPDATE SET
      status = excluded.status,
      reason = excluded.reason,
      source = excluded.source,
      declined_by = excluded.declined_by,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at
  `),
  deleteProjection: db.prepare<[workspaceId: string, keywordV1: string]>(`
    DELETE FROM keyword_feedback WHERE workspace_id = ? AND keyword = ?
  `),
  deleteV2: db.prepare<[workspaceId: string, keywordV2: string]>(`
    DELETE FROM keyword_feedback_v2_compat WHERE workspace_id = ? AND keyword_v2 = ?
  `),
  deleteLegacyArchive: db.prepare<[workspaceId: string, keywordV1: string]>(`
    DELETE FROM keyword_feedback_v1_legacy_aliases WHERE workspace_id = ? AND keyword_v1 = ?
  `),
  deleteUnmarkedLegacy: db.prepare<[workspaceId: string, keywordV1: string]>(`
    DELETE FROM keyword_feedback
     WHERE workspace_id = ? AND keyword = ?
       AND NOT EXISTS (
         SELECT 1 FROM keyword_feedback_v1_projection_keys p
          WHERE p.workspace_id = keyword_feedback.workspace_id
            AND p.keyword_v1 = keyword_feedback.keyword
       )
  `),
}));

function toStatus(value: string): KeywordFeedbackStatus {
  if (value === 'approved' || value === 'declined' || value === 'requested') return value;
  return 'requested';
}

function toInternalSource(value: string | null): KeywordFeedbackInternalSource {
  if (value === 'command_center') return value;
  if (value === 'content_gap' || value === 'page_map' || value === 'opportunity' || value === 'topic_cluster' || value === 'keyword_gap') return value;
  return null;
}

function toPublicSource(value: KeywordFeedbackInternalSource): KeywordFeedbackSource | null {
  return value === 'command_center' ? null : value;
}

function fromV2(row: V2FeedbackDbRow): KeywordFeedbackInternalRow {
  return {
    keyword: row.raw_keyword,
    keyword_v2: row.keyword_v2,
    keyword_v1: row.keyword_v1,
    status: toStatus(row.status),
    reason: row.reason ?? null,
    source: toInternalSource(row.source),
    declined_by: row.declined_by ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    write_order: row.write_order,
  };
}

function fromLegacy(row: LegacyFeedbackDbRow): KeywordFeedbackInternalRow {
  return {
    keyword: row.keyword,
    status: toStatus(row.status),
    reason: row.reason ?? null,
    source: toInternalSource(row.source),
    declined_by: row.declined_by ?? null,
    created_at: row.created_at ?? null,
    updated_at: row.updated_at ?? null,
  };
}

function sourceGapIdentityForFeedback(
  source: KeywordFeedbackInternalSource,
  displayKeyword: string,
): Partial<Pick<AddTrackedKeywordOptions, 'sourceGapKey' | 'sourceGapKeyV2'>> {
  if (source === 'content_gap' || source === 'keyword_gap') {
    const identity = keywordIdentityKeys(displayKeyword);
    return {
      sourceGapKey: identity.v1 || undefined,
      sourceGapKeyV2: identity.v2 || undefined,
    };
  }
  return {};
}

function compareRawBinary(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

function compareRows(a: KeywordFeedbackInternalRow, b: KeywordFeedbackInternalRow): number {
  const writeOrder = (b.write_order ?? 0) - (a.write_order ?? 0);
  if (writeOrder !== 0) return writeOrder;
  const updated = (b.updated_at ?? '').localeCompare(a.updated_at ?? '');
  if (updated !== 0) return updated;
  return compareRawBinary(a.keyword, b.keyword);
}

function readRows(workspaceId: string): KeywordFeedbackInternalRow[] {
  const v2 = (stmts().listV2.all(workspaceId) as V2FeedbackDbRow[]).map(fromV2);
  const archive = (stmts().listLegacyArchive.all(workspaceId) as LegacyFeedbackDbRow[]).map(fromLegacy);
  const archivedKeys = new Set(archive.map(row => row.keyword));
  const unmarked = (stmts().listUnmarkedLegacy.all(workspaceId) as LegacyFeedbackDbRow[])
    .filter(row => !archivedKeys.has(row.keyword))
    .map(fromLegacy);
  return [...v2, ...archive, ...unmarked].sort(compareRows);
}

export class KeywordFeedbackIndex extends Map<string, KeywordFeedbackInternalRow> {
  readonly rows: readonly KeywordFeedbackInternalRow[];
  readonly #v2 = new Map<string, KeywordFeedbackInternalRow>();
  readonly #legacy = new Map<string, KeywordFeedbackInternalRow>();

  constructor(workspaceId: string, rows = readRows(workspaceId)) {
    super();
    this.rows = rows;
    for (const row of rows) {
      if (row.keyword_v2) {
        this.#v2.set(row.keyword_v2, row);
        this.set(row.keyword_v2, row);
      } else if (!this.#legacy.has(row.keyword)) {
        this.#legacy.set(row.keyword, row);
        if (!this.has(row.keyword)) this.set(row.keyword, row);
      }
    }
  }

  get(keyword: string): KeywordFeedbackInternalRow | undefined {
    const keys = keywordIdentityKeys(keyword);
    return (keys.v2 ? this.#v2.get(keys.v2) : undefined)
      ?? (keys.v1 ? this.#legacy.get(keys.v1) : undefined);
  }

}

export function readKeywordFeedbackRows(workspaceId: string): KeywordFeedbackInternalRow[] {
  return readRows(workspaceId);
}

export function readKeywordFeedbackIndex(workspaceId: string): KeywordFeedbackIndex {
  return new KeywordFeedbackIndex(workspaceId);
}

function ensureProjectionArchive(workspaceId: string, keywordV1: string, now: string): void {
  if (stmts().getProjectionMarker.get(workspaceId, keywordV1)) return;
  const legacy = stmts().getLegacyMain.get(workspaceId, keywordV1) as (LegacyFeedbackDbRow & { id: number }) | undefined;
  if (legacy) {
    stmts().archiveLegacy.run({
      workspace_id: workspaceId,
      keyword_v1: keywordV1,
      legacy_id: legacy.id,
      status: legacy.status,
      reason: legacy.reason,
      source: legacy.source,
      declined_by: legacy.declined_by,
      created_at: legacy.created_at,
      updated_at: legacy.updated_at,
      archived_at: now,
    });
  }
  stmts().markProjection.run({ workspace_id: workspaceId, keyword_v1: keywordV1, projected_at: now });
}

function rebuildV1Projection(workspaceId: string, keywordV1: string, now: string): void {
  if (!keywordV1) return;
  ensureProjectionArchive(workspaceId, keywordV1, now);
  const winner = stmts().projectionWinner.get(workspaceId, keywordV1, keywordV1) as V2FeedbackDbRow | undefined;
  if (!winner) {
    stmts().deleteProjection.run(workspaceId, keywordV1);
    return;
  }
  stmts().upsertProjection.run({
    workspace_id: workspaceId,
    keyword: keywordV1,
    status: winner.status,
    reason: winner.reason,
    source: winner.source,
    declined_by: winner.declined_by,
    created_at: winner.created_at,
    updated_at: winner.updated_at,
  });
}

function normalizeDecision(input: SaveKeywordFeedbackDecisionInput) {
  const rawKeyword = input.keyword.trim();
  const identity = keywordIdentityKeys(rawKeyword);
  if (!rawKeyword || !identity.v2) throw new Error('Keyword must have a non-empty v2 identity');
  return {
    rawKeyword,
    identity,
    status: input.status,
    reason: input.reason?.trim() || null,
    source: input.source ?? null,
    declinedBy: input.declinedBy?.trim() || null,
  };
}

function upsertDecisionRow(workspaceId: string, decision: ReturnType<typeof normalizeDecision>, aliases: string[]): KeywordFeedbackInternalRow {
  const now = new Date().toISOString();
  const priorV1Keys = (stmts().v1KeysForV2.all(
    workspaceId,
    decision.identity.v2,
    workspaceId,
    decision.identity.v2,
  ) as Array<{ keyword_v1: string }>).map(row => row.keyword_v1);
  const next = stmts().nextWriteOrder.get(workspaceId) as { next_order: number };
  stmts().upsertV2.run({
    workspace_id: workspaceId,
    keyword_v2: decision.identity.v2,
    raw_keyword: decision.rawKeyword,
    keyword_v1: decision.identity.v1,
    status: decision.status,
    reason: decision.reason,
    source: decision.source,
    declined_by: decision.declinedBy,
    created_at: now,
    updated_at: now,
    write_order: next.next_order,
  });
  for (const raw of aliases) {
    const alias = keywordIdentityKeys(raw);
    stmts().upsertAlias.run({
      workspace_id: workspaceId,
      keyword_v2: decision.identity.v2,
      keyword_v1: alias.v1,
      raw_keyword: raw,
      now,
    });
  }
  const affectedV1Keys = new Set(priorV1Keys);
  if (decision.identity.v1) affectedV1Keys.add(decision.identity.v1);
  for (const raw of aliases) {
    const v1 = keywordIdentityKeys(raw).v1;
    if (v1) affectedV1Keys.add(v1);
  }
  for (const keywordV1 of affectedV1Keys) rebuildV1Projection(workspaceId, keywordV1, now);
  const row = stmts().getV2.get(workspaceId, decision.identity.v2) as V2FeedbackDbRow;
  return fromV2(row);
}

export function saveKeywordFeedbackDecision(input: SaveKeywordFeedbackDecisionInput): KeywordFeedbackInternalRow {
  const decision = normalizeDecision(input);
  let result!: KeywordFeedbackInternalRow;
  db.transaction(() => {
    result = upsertDecisionRow(input.workspaceId, decision, [decision.rawKeyword]);
    if (input.trackApprovedKeyword !== false && decision.status === 'approved') {
      addTrackedKeyword(input.workspaceId, decision.rawKeyword, {
        source: trackedKeywordSourceForFeedback(toPublicSource(decision.source) ?? undefined),
        ...sourceGapIdentityForFeedback(decision.source, decision.rawKeyword),
      });
    }
    invalidateKeywordStrategyGenerationInputs(input.workspaceId);
  }).immediate();
  return result;
}

function toPublicRow(row: KeywordFeedbackInternalRow): KeywordFeedbackListRow {
  return {
    keyword: row.keyword,
    status: row.status,
    reason: row.reason,
    source: toPublicSource(row.source),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function toAdminRow(row: KeywordFeedbackInternalRow): AdminKeywordFeedbackListRow {
  return { ...toPublicRow(row), declined_by: row.declined_by };
}

function toMutationResponse(row: KeywordFeedbackInternalRow): KeywordFeedbackMutationResponse {
  return {
    keyword: row.keyword,
    status: row.status,
    reason: row.reason,
    source: toPublicSource(row.source),
    updated_at: row.updated_at,
  };
}

export function notifyKeywordFeedbackChanged(workspaceId: string, payload: Record<string, unknown>): void {
  invalidateIntelligenceCache(workspaceId);
  broadcastToWorkspace(workspaceId, WS_EVENTS.INTELLIGENCE_SIGNALS_UPDATED, {
    workspaceId,
    reason: 'keyword_feedback',
    updatedAt: new Date().toISOString(),
  });
  broadcastToWorkspace(workspaceId, WS_EVENTS.STRATEGY_UPDATED, payload);
}

export function listAdminKeywordFeedback(workspaceId: string): AdminKeywordFeedbackListRow[] {
  return readRows(workspaceId).map(toAdminRow);
}

export function listPublicKeywordFeedback(workspaceId: string): KeywordFeedbackListRow[] {
  return readRows(workspaceId).map(toPublicRow);
}

export interface ListPublicKeywordFeedbackPagedResult {
  items: KeywordFeedbackListRow[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export function listPublicKeywordFeedbackPaged(
  workspaceId: string,
  limit: number,
  offset: number,
): ListPublicKeywordFeedbackPagedResult {
  const rows = readRows(workspaceId);
  const items = rows.slice(offset, offset + limit).map(toPublicRow);
  return {
    items,
    total: rows.length,
    limit,
    offset,
    hasMore: offset + items.length < rows.length,
  };
}

export function saveKeywordFeedback(input: SaveKeywordFeedbackInput): {
  response: KeywordFeedbackMutationResponse;
  trackedKeyword: string | null;
} {
  const row = saveKeywordFeedbackDecision({ ...input, trackApprovedKeyword: true });
  return {
    response: toMutationResponse(row),
    trackedKeyword: input.status === 'approved' ? input.keyword.trim() : null,
  };
}

interface PreparedBulkDecision {
  decision: ReturnType<typeof normalizeDecision>;
  aliases: string[];
}

function prepareBulk(input: SaveBulkKeywordFeedbackInput): PreparedBulkDecision[] {
  const grouped = new Map<string, PreparedBulkDecision>();
  for (const item of input.keywords) {
    const decision = normalizeDecision({
      workspaceId: input.workspaceId,
      ...item,
      declinedBy: input.declinedBy,
    });
    const existing = grouped.get(decision.identity.v2);
    if (!existing) {
      grouped.set(decision.identity.v2, { decision, aliases: [decision.rawKeyword] });
      continue;
    }
    const samePayload = existing.decision.status === decision.status
      && existing.decision.reason === decision.reason
      && existing.decision.source === decision.source
      && existing.decision.declinedBy === decision.declinedBy;
    if (!samePayload) throw new KeywordFeedbackBulkConflictError(decision.identity.v2);
    if (!existing.aliases.includes(decision.rawKeyword)) existing.aliases.push(decision.rawKeyword);
  }

  for (const entry of grouped.values()) {
    entry.aliases.sort(compareRawBinary);
    const canonical = entry.aliases[0];
    entry.decision = normalizeDecision({
      workspaceId: input.workspaceId,
      keyword: canonical,
      status: entry.decision.status,
      reason: entry.decision.reason,
      source: entry.decision.source,
      declinedBy: entry.decision.declinedBy,
    });
  }
  return [...grouped.values()].sort((a, b) => compareRawBinary(a.decision.identity.v2, b.decision.identity.v2));
}

export function saveBulkKeywordFeedback(input: SaveBulkKeywordFeedbackInput): {
  response: KeywordFeedbackBulkMutationResponse;
  trackedKeywords: string[];
} {
  // Validate the complete batch before starting a transaction so conflicting
  // aliases cannot partially mutate the sidecar or rollback projection.
  const prepared = prepareBulk(input);
  const trackedEntries: Parameters<typeof addTrackedKeywords>[1] = [];

  db.transaction(() => {
    for (const entry of prepared) {
      upsertDecisionRow(input.workspaceId, entry.decision, entry.aliases);
      if (entry.decision.status === 'approved') {
        trackedEntries.push({
          query: entry.decision.rawKeyword,
          options: {
            source: trackedKeywordSourceForFeedback(toPublicSource(entry.decision.source) ?? undefined),
            ...sourceGapIdentityForFeedback(entry.decision.source, entry.decision.rawKeyword),
          },
        });
      }
    }
    if (trackedEntries.length > 0) addTrackedKeywords(input.workspaceId, trackedEntries);
    invalidateKeywordStrategyGenerationInputs(input.workspaceId);
  }).immediate();

  return {
    response: { updated: input.keywords.length },
    trackedKeywords: trackedEntries.map(entry => entry.query),
  };
}

export function clearKeywordFeedback(workspaceId: string, keywordInput: string): KeywordFeedbackDeleteResponse {
  const identity = keywordIdentityKeys(keywordInput.trim());
  let existing: KeywordFeedbackInternalRow | undefined;
  let deleted = false;

  db.transaction(() => {
    if (identity.v2) {
      const v2 = stmts().getV2.get(workspaceId, identity.v2) as V2FeedbackDbRow | undefined;
      if (v2) {
        existing = fromV2(v2);
        const affectedV1Keys = (stmts().v1KeysForV2.all(
          workspaceId,
          identity.v2,
          workspaceId,
          identity.v2,
        ) as Array<{ keyword_v1: string }>).map(row => row.keyword_v1);
        deleted = stmts().deleteV2.run(workspaceId, identity.v2).changes > 0;
        if (deleted) {
          const now = new Date().toISOString();
          for (const keywordV1 of affectedV1Keys) rebuildV1Projection(workspaceId, keywordV1, now);
        }
      }
    }
    if (!deleted && identity.v1) {
      const archived = stmts().getLegacyArchive.get(workspaceId, identity.v1) as LegacyFeedbackDbRow | undefined;
      if (archived) {
        existing = fromLegacy(archived);
        deleted = stmts().deleteLegacyArchive.run(workspaceId, identity.v1).changes > 0;
      } else {
        const legacy = stmts().getUnmarkedLegacy.get(workspaceId, identity.v1) as LegacyFeedbackDbRow | undefined;
        if (legacy) {
          existing = fromLegacy(legacy);
          deleted = stmts().deleteUnmarkedLegacy.run(workspaceId, identity.v1).changes > 0;
        }
      }
    }
    if (deleted) invalidateKeywordStrategyGenerationInputs(workspaceId);
  }).immediate();

  return {
    deleted: existing?.keyword ?? keywordInput.trim(),
    existed: deleted,
    previousStatus: existing?.status ?? null,
    source: existing ? toPublicSource(existing.source) : null,
  };
}

export function buildKeywordFeedbackSignals(workspaceId: string): ClientSignalsSlice['keywordFeedback'] {
  const rows = readRows(workspaceId);
  const approvedRows = rows.filter(row => row.status === 'approved');
  const rejectedRows = rows.filter(row => row.status === 'declined');
  const total = approvedRows.length + rejectedRows.length;
  const reasonCounts = new Map<string, number>();
  for (const row of rejectedRows) {
    if (row.reason) reasonCounts.set(row.reason, (reasonCounts.get(row.reason) ?? 0) + 1);
  }
  return {
    approved: approvedRows.map(row => row.keyword),
    rejected: rejectedRows.map(row => row.keyword),
    patterns: {
      approveRate: total > 0 ? approvedRows.length / total : 0,
      topRejectionReasons: [...reasonCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([reason]) => reason),
    },
  };
}

/** Get all declined display keywords for a workspace (used by strategy generation). */
export function getDeclinedKeywords(workspaceId: string): string[] {
  return readRows(workspaceId).filter(row => row.status === 'declined').map(row => row.keyword);
}

/** Get all client-requested display keywords for a workspace. */
export function getRequestedKeywords(workspaceId: string): string[] {
  return readRows(workspaceId).filter(row => row.status === 'requested').map(row => row.keyword);
}
