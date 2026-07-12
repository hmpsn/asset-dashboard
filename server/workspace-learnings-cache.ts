import db from './db/index.js';
import { createStmtCache } from './db/stmt-cache.js';

const stmts = createStmtCache(() => ({
  deleteByWorkspace: db.prepare('DELETE FROM workspace_learnings WHERE workspace_id = ?'),
}));

/**
 * Remove the persisted derived-learnings snapshot for one workspace.
 *
 * Kept in a cycle-safe leaf module because `workspace-learnings.ts` reads from
 * outcome tracking while outcome writes must invalidate this cache.
 */
export function invalidateWorkspaceLearningsCache(workspaceId: string): boolean {
  return stmts().deleteByWorkspace.run(workspaceId).changes > 0;
}
