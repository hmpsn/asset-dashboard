/**
 * Keyword feedback helpers — shared by recommendations.ts and keyword-strategy route.
 *
 * Extracted to break the circular import that would otherwise exist between
 * server/recommendations.ts and server/routes/keyword-strategy.ts.
 */

import db from './db/index.js';

/** Get all declined keywords for a workspace (used by strategy generator to exclude) */
export function getDeclinedKeywords(workspaceId: string): string[] {
  const rows = db.prepare('SELECT keyword FROM keyword_feedback WHERE workspace_id = ? AND status = ?').all(workspaceId, 'declined') as { keyword: string }[];
  return rows.map(r => r.keyword);
}

/** Get all client-requested keywords for a workspace (used by strategy generator to prioritize) */
export function getRequestedKeywords(workspaceId: string): string[] {
  const rows = db.prepare('SELECT keyword FROM keyword_feedback WHERE workspace_id = ? AND status = ?').all(workspaceId, 'requested') as { keyword: string }[];
  return rows.map(r => r.keyword);
}
