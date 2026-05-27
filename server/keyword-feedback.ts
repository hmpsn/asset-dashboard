/**
 * Keyword feedback service helpers.
 * Shared by admin/client routes, strategy generation, and client-signals assembly.
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
import db from './db/index.js';
import { createStmtCache } from './db/stmt-cache.js';
import { keywordComparisonKey } from '../shared/keyword-normalization.js';
import { trackedKeywordSourceForFeedback } from './keyword-feedback-tracking.js';
import { addTrackedKeyword, addTrackedKeywords } from './rank-tracking.js';
import { invalidateIntelligenceCache } from './workspace-intelligence.js';
import { broadcastToWorkspace } from './broadcast.js';
import { WS_EVENTS } from './ws-events.js';

interface KeywordFeedbackDbRow {
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

interface ExistingFeedbackRow {
  status: KeywordFeedbackStatus;
  source: KeywordFeedbackSource | null;
}

const stmts = createStmtCache(() => ({
  declined: db.prepare<[workspaceId: string]>(
    "SELECT keyword FROM keyword_feedback WHERE workspace_id = ? AND status = 'declined'",
  ),
  requested: db.prepare<[workspaceId: string]>(
    "SELECT keyword FROM keyword_feedback WHERE workspace_id = ? AND status = 'requested'",
  ),
  listAll: db.prepare<[workspaceId: string]>(
    'SELECT keyword, status, reason, source, declined_by, created_at, updated_at FROM keyword_feedback WHERE workspace_id = ? ORDER BY updated_at DESC',
  ),
  upsert: db.prepare<[
    workspaceId: string,
    keyword: string,
    status: KeywordFeedbackStatus,
    reason: string | null,
    source: KeywordFeedbackSource | null,
    declinedBy: string | null,
  ]>(`
    INSERT INTO keyword_feedback (workspace_id, keyword, status, reason, source, declined_by)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(workspace_id, keyword) DO UPDATE SET
      status = excluded.status,
      reason = excluded.reason,
      declined_by = excluded.declined_by,
      updated_at = datetime('now')
  `),
  getByKeyword: db.prepare<[workspaceId: string, keyword: string]>(
    'SELECT keyword, status, reason, source, declined_by, created_at, updated_at FROM keyword_feedback WHERE workspace_id = ? AND keyword = ?',
  ),
  deleteByKeyword: db.prepare<[workspaceId: string, keyword: string]>(
    'DELETE FROM keyword_feedback WHERE workspace_id = ? AND keyword = ?',
  ),
  byStatus: db.prepare<[workspaceId: string, status: KeywordFeedbackStatus]>(
    'SELECT keyword, reason FROM keyword_feedback WHERE workspace_id = ? AND status = ?',
  ),
}));

function toStatus(value: string): KeywordFeedbackStatus {
  if (value === 'approved' || value === 'declined' || value === 'requested') return value;
  return 'requested';
}

function toSource(value: string | null): KeywordFeedbackSource | null {
  if (!value) return null;
  if (value === 'content_gap' || value === 'page_map' || value === 'opportunity' || value === 'topic_cluster' || value === 'keyword_gap') return value;
  return null;
}

function toKeywordFeedbackListRow(row: KeywordFeedbackDbRow): KeywordFeedbackListRow {
  return {
    keyword: row.keyword,
    status: toStatus(row.status),
    reason: row.reason ?? null,
    source: toSource(row.source),
    created_at: row.created_at ?? null,
    updated_at: row.updated_at ?? null,
  };
}

function toAdminKeywordFeedbackListRow(row: KeywordFeedbackDbRow): AdminKeywordFeedbackListRow {
  return {
    ...toKeywordFeedbackListRow(row),
    declined_by: row.declined_by ?? null,
  };
}

function toMutationResponse(row: KeywordFeedbackDbRow): KeywordFeedbackMutationResponse {
  return {
    keyword: row.keyword,
    status: toStatus(row.status),
    reason: row.reason ?? null,
    source: toSource(row.source),
    updated_at: row.updated_at ?? null,
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
  const rows = stmts().listAll.all(workspaceId) as KeywordFeedbackDbRow[];
  return rows.map(toAdminKeywordFeedbackListRow);
}

export function listPublicKeywordFeedback(workspaceId: string): KeywordFeedbackListRow[] {
  const rows = stmts().listAll.all(workspaceId) as KeywordFeedbackDbRow[];
  return rows.map(toKeywordFeedbackListRow);
}

export function saveKeywordFeedback(input: SaveKeywordFeedbackInput): {
  response: KeywordFeedbackMutationResponse;
  trackedKeyword: string | null;
} {
  const keyword = keywordComparisonKey(input.keyword);
  const displayKeyword = input.keyword.trim();
  const reason = input.reason && input.reason.trim() ? input.reason : null;
  const source = input.source ?? null;
  const declinedBy = input.declinedBy && input.declinedBy.trim() ? input.declinedBy : null;

  stmts().upsert.run(input.workspaceId, keyword, input.status, reason, source, declinedBy);

  if (input.status === 'approved') {
    addTrackedKeyword(input.workspaceId, displayKeyword, {
      source: trackedKeywordSourceForFeedback(source ?? undefined),
    });
  }

  const row = stmts().getByKeyword.get(input.workspaceId, keyword) as KeywordFeedbackDbRow | undefined;
  const fallback: KeywordFeedbackDbRow = {
    keyword,
    status: input.status,
    reason,
    source,
    declined_by: declinedBy,
    created_at: null,
    updated_at: null,
  };
  return {
    response: toMutationResponse(row ?? fallback),
    trackedKeyword: input.status === 'approved' ? displayKeyword : null,
  };
}

export function saveBulkKeywordFeedback(input: SaveBulkKeywordFeedbackInput): {
  response: KeywordFeedbackBulkMutationResponse;
  trackedKeywords: string[];
} {
  const trackedEntries: Parameters<typeof addTrackedKeywords>[1] = [];

  const insert = db.transaction((items: SaveBulkKeywordFeedbackInput['keywords']) => {
    for (const item of items) {
      const keyword = keywordComparisonKey(item.keyword);
      const reason = item.reason && item.reason.trim() ? item.reason : null;
      const source = item.source ?? null;
      const declinedBy = input.declinedBy && input.declinedBy.trim() ? input.declinedBy : null;
      stmts().upsert.run(input.workspaceId, keyword, item.status, reason, source, declinedBy);

      if (item.status === 'approved') {
        trackedEntries.push({
          query: item.keyword.trim(),
          options: { source: trackedKeywordSourceForFeedback(source ?? undefined) },
        });
      }
    }

    if (trackedEntries.length > 0) {
      addTrackedKeywords(input.workspaceId, trackedEntries);
    }
  });

  insert(input.keywords);

  return {
    response: { updated: input.keywords.length },
    trackedKeywords: trackedEntries.map(entry => entry.query),
  };
}

export function clearKeywordFeedback(workspaceId: string, keywordInput: string): KeywordFeedbackDeleteResponse {
  const keyword = keywordComparisonKey(keywordInput);

  const remove = db.transaction(() => {
    const existing = stmts().getByKeyword.get(workspaceId, keyword) as KeywordFeedbackDbRow | undefined;
    if (!existing) return { existing: null, deleted: false };
    const result = stmts().deleteByKeyword.run(workspaceId, keyword);
    return { existing, deleted: result.changes > 0 };
  });

  const { existing, deleted } = remove();
  const parsedExisting: ExistingFeedbackRow | null = existing
    ? { status: toStatus(existing.status), source: toSource(existing.source) }
    : null;

  return {
    deleted: keyword,
    existed: Boolean(parsedExisting && deleted),
    previousStatus: parsedExisting?.status ?? null,
    source: parsedExisting?.source ?? null,
  };
}

export function buildKeywordFeedbackSignals(workspaceId: string): ClientSignalsSlice['keywordFeedback'] {
  const approvedRows = stmts().byStatus.all(workspaceId, 'approved') as Array<{ keyword: string; reason: string | null }>;
  const rejectedRows = stmts().byStatus.all(workspaceId, 'declined') as Array<{ keyword: string; reason: string | null }>;
  const total = approvedRows.length + rejectedRows.length;

  const reasonCounts = new Map<string, number>();
  for (const row of rejectedRows) {
    if (!row.reason) continue;
    reasonCounts.set(row.reason, (reasonCounts.get(row.reason) ?? 0) + 1);
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

/** Get all declined keywords for a workspace (used by strategy generator to exclude). */
export function getDeclinedKeywords(workspaceId: string): string[] {
  return (stmts().declined.all(workspaceId) as { keyword: string }[]).map(row => row.keyword);
}

/** Get all client-requested keywords for a workspace (used by strategy generator to prioritize). */
export function getRequestedKeywords(workspaceId: string): string[] {
  return (stmts().requested.all(workspaceId) as { keyword: string }[]).map(row => row.keyword);
}
