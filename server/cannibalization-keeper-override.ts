/**
 * cannibalization-keeper-override — CRUD for the cannibalization_keeper_override table.
 *
 * Stores the operator-chosen keeper page for a cannibalization URL set.
 * Keyed on the order-independent cannibalizationUrlSetKey (NOT the
 * cannibalization_issues row id), so overrides survive the delete-then-reinsert
 * regen clobber of cannibalization_issues.
 *
 * See: server/db/migrations/141-cannibalization-keeper-override.sql
 */
import db from './db/index.js';
import { createStmtCache } from './db/stmt-cache.js';

interface KeeperOverrideRow {
  workspace_id: string;
  url_set_key: string;
  keeper_path: string;
  created_at: string;
}

const stmts = createStmtCache(() => ({
  get: db.prepare<[workspace_id: string, url_set_key: string]>(
    `SELECT keeper_path FROM cannibalization_keeper_override
     WHERE workspace_id = ? AND url_set_key = ?`,
  ),
  upsert: db.prepare(`
    INSERT INTO cannibalization_keeper_override
      (workspace_id, url_set_key, keeper_path, created_at)
    VALUES
      (@workspace_id, @url_set_key, @keeper_path, @created_at)
    ON CONFLICT(workspace_id, url_set_key) DO UPDATE SET
      keeper_path = excluded.keeper_path,
      created_at  = excluded.created_at
  `),
  del: db.prepare<[workspace_id: string, url_set_key: string]>(
    `DELETE FROM cannibalization_keeper_override
     WHERE workspace_id = ? AND url_set_key = ?`,
  ),
}));

/**
 * Return the operator-chosen keeper path for a URL set, or null if no override exists.
 * Always workspace-scoped.
 */
export function getKeeperOverride(workspaceId: string, urlSetKey: string): string | null {
  const row = stmts().get.get(workspaceId, urlSetKey) as Pick<KeeperOverrideRow, 'keeper_path'> | undefined;
  return row?.keeper_path ?? null;
}

/**
 * Set (upsert) the keeper override for a URL set.
 * Always workspace-scoped.
 */
export function setKeeperOverride(workspaceId: string, urlSetKey: string, keeperPath: string): void {
  stmts().upsert.run({
    workspace_id: workspaceId,
    url_set_key: urlSetKey,
    keeper_path: keeperPath,
    created_at: new Date().toISOString(),
  });
}

/**
 * Remove the keeper override for a URL set.
 * No-op if no override exists.
 * Always workspace-scoped.
 */
export function clearKeeperOverride(workspaceId: string, urlSetKey: string): void {
  stmts().del.run(workspaceId, urlSetKey);
}
