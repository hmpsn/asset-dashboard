/**
 * Keyword feedback helpers — shared by recommendations.ts and keyword-strategy route.
 *
 * Extracted to break the circular import that would otherwise exist between
 * server/recommendations.ts and server/routes/keyword-strategy.ts.
 */

import db from './db/index.js';
import { createStmtCache } from './db/stmt-cache.js';

const stmts = createStmtCache(() => ({
  declined: db.prepare<[workspaceId: string]>(
    "SELECT keyword FROM keyword_feedback WHERE workspace_id = ? AND status = 'declined'",
  ),
  requested: db.prepare<[workspaceId: string]>(
    "SELECT keyword FROM keyword_feedback WHERE workspace_id = ? AND status = 'requested'",
  ),
}));

/** Get all declined keywords for a workspace (used by strategy generator to exclude) */
export function getDeclinedKeywords(workspaceId: string): string[] {
  return (stmts().declined.all(workspaceId) as { keyword: string }[]).map(r => r.keyword);
}

/** Get all client-requested keywords for a workspace (used by strategy generator to prioritize) */
export function getRequestedKeywords(workspaceId: string): string[] {
  return (stmts().requested.all(workspaceId) as { keyword: string }[]).map(r => r.keyword);
}
