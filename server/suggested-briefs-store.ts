/**
 * Suggested briefs store — CRUD for AI-generated content brief suggestions.
 * Table: suggested_briefs (migration 043)
 * Bridge #2: content decay analysis → suggested brief creation
 */
import { randomUUID, createHash } from 'crypto';
import db from './db/index.js';
import { createStmtCache } from './db/stmt-cache.js';

// ── Types ──────────────────────────────────────────────────────────────

export interface SuggestedBrief {
  id: string;
  workspaceId: string;
  keyword: string;
  pageUrl: string | null;
  source: string;
  reason: string;
  priority: 'low' | 'medium' | 'high';
  status: 'pending' | 'accepted' | 'dismissed' | 'snoozed';
  createdAt: string;
  resolvedAt: string | null;
  snoozedUntil: string | null;
  dismissedKeywordHash: string | null;
}

interface SuggestedBriefRow {
  id: string;
  workspace_id: string;
  keyword: string;
  page_url: string | null;
  source: string;
  reason: string;
  priority: string;
  status: string;
  created_at: string;
  resolved_at: string | null;
  snoozed_until: string | null;
  dismissed_keyword_hash: string | null;
}

function rowToBrief(row: SuggestedBriefRow): SuggestedBrief {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    keyword: row.keyword,
    pageUrl: row.page_url,
    source: row.source,
    reason: row.reason,
    priority: row.priority as SuggestedBrief['priority'],
    status: row.status as SuggestedBrief['status'],
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
    snoozedUntil: row.snoozed_until,
    dismissedKeywordHash: row.dismissed_keyword_hash,
  };
}

// ── Prepared statements ────────────────────────────────────────────────

const stmts = createStmtCache(() => ({
  insert: db.prepare(`
    INSERT INTO suggested_briefs (id, workspace_id, keyword, page_url, source, reason, priority, status, created_at, dismissed_keyword_hash)
    VALUES (@id, @workspace_id, @keyword, @page_url, @source, @reason, @priority, @status, @created_at, @dismissed_keyword_hash)
  `),
  listByWorkspace: db.prepare(`
    SELECT * FROM suggested_briefs
    WHERE workspace_id = ? AND status IN ('pending', 'snoozed')
    ORDER BY
      CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 WHEN 'low' THEN 2 END,
      created_at DESC
  `),
  listAll: db.prepare(`
    SELECT * FROM suggested_briefs
    WHERE workspace_id = ?
    ORDER BY created_at DESC
  `),
  getById: db.prepare(`SELECT * FROM suggested_briefs WHERE id = ? AND workspace_id = ?`),
  updateStatus: db.prepare(`
    UPDATE suggested_briefs SET status = ?, resolved_at = ? WHERE id = ? AND workspace_id = ?
  `),
  updateSnooze: db.prepare(`
    UPDATE suggested_briefs SET status = 'snoozed', snoozed_until = ? WHERE id = ? AND workspace_id = ?
  `),
  checkDismissed: db.prepare(`
    SELECT 1 FROM suggested_briefs
    WHERE workspace_id = ? AND dismissed_keyword_hash = ? AND status = 'dismissed'
    LIMIT 1
  `),
}));

// ── CRUD ───────────────────────────────────────────────────────────────

export function createSuggestedBrief(params: {
  workspaceId: string;
  keyword: string;
  pageUrl?: string;
  source?: string;
  reason: string;
  priority?: 'low' | 'medium' | 'high';
}): SuggestedBrief {
  const id = randomUUID();
  const keywordHash = createHash('sha256').update(params.keyword.toLowerCase().trim()).digest('hex').slice(0, 16);

  // Skip if same keyword was previously dismissed
  const dismissed = stmts().checkDismissed.get(params.workspaceId, keywordHash);
  if (dismissed) {
    // Return a synthetic "dismissed" brief so callers know it was skipped
    return {
      id,
      workspaceId: params.workspaceId,
      keyword: params.keyword,
      pageUrl: params.pageUrl ?? null,
      source: params.source ?? 'content_decay',
      reason: params.reason,
      priority: params.priority ?? 'medium',
      status: 'dismissed',
      createdAt: new Date().toISOString(),
      resolvedAt: null,
      snoozedUntil: null,
      dismissedKeywordHash: keywordHash,
    };
  }

  const now = new Date().toISOString();
  stmts().insert.run({
    id,
    workspace_id: params.workspaceId,
    keyword: params.keyword,
    page_url: params.pageUrl ?? null,
    source: params.source ?? 'content_decay',
    reason: params.reason,
    priority: params.priority ?? 'medium',
    status: 'pending',
    created_at: now,
    dismissed_keyword_hash: keywordHash,
  });

  const row = stmts().getById.get(id, params.workspaceId) as SuggestedBriefRow | undefined;
  if (!row) throw new Error(`Failed to read back suggested brief ${id}`);
  return rowToBrief(row);
}

export function listSuggestedBriefs(workspaceId: string, includeAll = false): SuggestedBrief[] {
  const rows = (includeAll ? stmts().listAll : stmts().listByWorkspace).all(workspaceId) as SuggestedBriefRow[];
  return rows.map(rowToBrief);
}

export function getSuggestedBrief(id: string, workspaceId: string): SuggestedBrief | null {
  const row = stmts().getById.get(id, workspaceId) as SuggestedBriefRow | undefined;
  return row ? rowToBrief(row) : null;
}

export function updateSuggestedBrief(id: string, workspaceId: string, status: 'accepted' | 'dismissed'): SuggestedBrief | null {
  const now = new Date().toISOString();
  stmts().updateStatus.run(status, now, id, workspaceId);
  return getSuggestedBrief(id, workspaceId);
}

export function dismissSuggestedBrief(id: string, workspaceId: string): SuggestedBrief | null {
  return updateSuggestedBrief(id, workspaceId, 'dismissed');
}

export function snoozeSuggestedBrief(id: string, workspaceId: string, until: string): SuggestedBrief | null {
  stmts().updateSnooze.run(until, id, workspaceId);
  return getSuggestedBrief(id, workspaceId);
}
