import db from '../db/index.js';
import { createStmtCache } from '../db/stmt-cache.js';

// Durable, per-workspace paid-call counter. INFORMATIONAL ONLY — warn/track; no
// hard cap, no refusal of calls (owner decision). Previously in-memory, so the
// signal was lost on restart and did not work across multiple server instances.
//
// The global aggregate lives under the synthetic '__global__' key so the prior
// global threshold semantics (every existing caller passes no workspaceId)
// survive the move to SQLite unchanged.

const GLOBAL_KEY = '__global__';
const DEFAULT_THRESHOLD = 100;

function getWarnThreshold(): number {
  const raw = process.env.MCP_PAID_CALL_WARN_AFTER;
  if (!raw) return DEFAULT_THRESHOLD;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_THRESHOLD;
  return parsed;
}

const stmts = createStmtCache(() => ({
  upsert: db.prepare<[workspaceId: string, increment: number, updatedAt: string]>(`
    INSERT INTO mcp_paid_call_counts (workspace_id, count, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(workspace_id) DO UPDATE SET
      count = count + excluded.count,
      updated_at = excluded.updated_at
  `),
  get: db.prepare<[workspaceId: string]>(
    `SELECT count FROM mcp_paid_call_counts WHERE workspace_id = ?`,
  ),
  truncate: db.prepare(`DELETE FROM mcp_paid_call_counts`), // ws-scope-ok: test-only full-table reset of the informational paid-call counter
}));

function readCount(workspaceId: string): number {
  const row = stmts().get.get(workspaceId) as { count: number } | undefined;
  return row?.count ?? 0;
}

/**
 * Record paid MCP provider calls. Durable + informational only.
 *
 * Always updates the global aggregate; when `workspaceId` is supplied, also
 * increments that workspace's durable counter. The returned `count` is the
 * global total so the soft-cap warning keeps its prior cross-workspace meaning.
 */
export function recordPaidCall(
  increment = 1,
  workspaceId?: string,
): { count: number; warning?: string } {
  const updatedAt = new Date().toISOString();
  stmts().upsert.run(GLOBAL_KEY, increment, updatedAt);
  if (workspaceId && workspaceId !== GLOBAL_KEY) {
    stmts().upsert.run(workspaceId, increment, updatedAt);
  }

  const count = readCount(GLOBAL_KEY);
  const threshold = getWarnThreshold();
  if (count >= threshold) {
    return {
      count,
      warning: `paid_call_count: ${count} (threshold ${threshold}; informational only)`,
    };
  }
  return { count };
}

/**
 * Read the durable paid-call count. With no argument, returns the global
 * aggregate; with a `workspaceId`, returns that workspace's count.
 */
export function getPaidCallCount(workspaceId?: string): number {
  return readCount(workspaceId ?? GLOBAL_KEY);
}

/** Test-only: clear counter state between tests. */
export function __resetPaidCallCounterForTests(): void {
  stmts().truncate.run();
}
