/**
 * Vitest global setup — runs once before any worker threads start.
 * Ensures SQLite migrations are applied before parallel tests begin,
 * avoiding SQLITE_BUSY errors from concurrent migration attempts.
 */
import db from '../server/db/index.js';
import { runMigrations } from '../server/db/index.js';

/**
 * Tables that seed fixtures populate. Truncated between test suites
 * to prevent cross-test data leakage.
 */
const SEED_TABLES = [
  'workspaces',
  'approval_batches',
  'client_users',
  'requests',
  'content_topic_requests',
  'content_briefs',
  'content_posts',
  'analytics_insights',
  'tracked_actions',
  'analytics_annotations',
] as const;
// Note: `users` table is NOT included — its IDs use `usr_` prefix (not `test-`)
// and it has no `workspace_id` column. Cleanup is handled by per-fixture cleanup() closures.

export function setup() {
  runMigrations();
}

/**
 * Truncate all seed-populated tables. Call in afterAll() of test suites
 * that use seed fixtures to prevent data leaking into other test files.
 */
export function cleanSeedData(workspaceId?: string): void {
  if (workspaceId) {
    // Targeted cleanup — only delete rows for a specific workspace
    for (const table of SEED_TABLES) {
      try {
        // workspaces table uses `id` as the PK, not `workspace_id`
        const col = table === 'workspaces' ? 'id' : 'workspace_id';
        db.prepare(`DELETE FROM ${table} WHERE ${col} = ?`).run(workspaceId);
      } catch {
        // Table may not have the expected column
        // Silently skip — individual fixture cleanup handles these
      }
    }
  } else {
    // Full cleanup — truncate all seed tables (use sparingly)
    // Match all fixture ID prefixes: test-, batch-, item-, req-, brief-, post-
    for (const table of SEED_TABLES) {
      try {
        db.prepare(`DELETE FROM ${table} WHERE id LIKE 'test-%' OR id LIKE 'batch-%' OR id LIKE 'item-%' OR id LIKE 'req-%' OR id LIKE 'brief-%' OR id LIKE 'post-%'`).run();
      } catch {
        // Silently skip tables that don't match
      }
    }
  }
}
