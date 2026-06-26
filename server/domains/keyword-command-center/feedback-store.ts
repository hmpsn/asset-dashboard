import db from '../../db/index.js';
import { createStmtCache } from '../../db/stmt-cache.js';
import { keywordComparisonKey } from '../../../shared/keyword-normalization.js';
import type { FeedbackRow } from './types.js';

const stmts = createStmtCache(() => ({
  feedback: db.prepare<[workspaceId: string]>(
    'SELECT keyword, status, reason, source, updated_at FROM keyword_feedback WHERE workspace_id = ? ORDER BY updated_at DESC',
  ),
  upsertFeedback: db.prepare(`
    INSERT INTO keyword_feedback (workspace_id, keyword, status, reason, source, declined_by)
    VALUES (@workspace_id, @keyword, @status, @reason, @source, @declined_by)
    ON CONFLICT(workspace_id, keyword) DO UPDATE SET
      status = excluded.status,
      reason = excluded.reason,
      source = excluded.source,
      declined_by = excluded.declined_by,
      updated_at = datetime('now')
  `),
  deleteFeedback: db.prepare<[workspaceId: string, keyword: string]>(
    'DELETE FROM keyword_feedback WHERE workspace_id = ? AND keyword = ?',
  ),
}));

export function readFeedbackRows(workspaceId: string): FeedbackRow[] {
  return stmts().feedback.all(workspaceId) as FeedbackRow[];
}

export function readFeedback(workspaceId: string): Map<string, FeedbackRow> {
  const feedback = new Map<string, FeedbackRow>();
  for (const row of readFeedbackRows(workspaceId)) {
    const key = keywordComparisonKey(row.keyword);
    if (!key || feedback.has(key)) continue;
    feedback.set(key, row);
  }
  return feedback;
}

export function deleteFeedbackByKeywordKey(workspaceId: string, keyword: string): number {
  const normalized = keywordComparisonKey(keyword);
  if (!normalized) return 0;
  let changes = 0;
  for (const row of readFeedbackRows(workspaceId)) {
    if (keywordComparisonKey(row.keyword) !== normalized) continue;
    changes += stmts().deleteFeedback.run(workspaceId, row.keyword).changes;
  }
  return changes;
}

export function upsertFeedback(
  workspaceId: string,
  keyword: string,
  status: 'approved' | 'declined' | 'requested',
  reason?: string,
): void {
  const normalized = keywordComparisonKey(keyword);
  deleteFeedbackByKeywordKey(workspaceId, normalized);
  stmts().upsertFeedback.run({
    workspace_id: workspaceId,
    keyword: normalized,
    status,
    reason: reason ?? null,
    source: 'command_center',
    declined_by: status === 'declined' ? 'admin' : null,
  });
}
