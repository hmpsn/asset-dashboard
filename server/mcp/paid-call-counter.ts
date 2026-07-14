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
  insertEvent: db.prepare<[
    eventKey: string,
    workspaceId: string | null,
    increment: number,
    recordedAt: string,
  ]>(`
    INSERT OR IGNORE INTO mcp_paid_call_events (
      event_key, workspace_id, increment, recorded_at
    ) VALUES (?, ?, ?, ?)
  `),
  eventByKey: db.prepare<[eventKey: string]>(`
    SELECT workspace_id, increment
    FROM mcp_paid_call_events
    WHERE event_key = ?
  `),
  truncateEvents: db.prepare(`DELETE FROM mcp_paid_call_events`), // ws-scope-ok: test-only full-table reset of the paid-call event ledger
  truncate: db.prepare(`DELETE FROM mcp_paid_call_counts`), // ws-scope-ok: test-only full-table reset of the informational paid-call counter
}));

function readCount(workspaceId: string): number {
  const row = stmts().get.get(workspaceId) as { count: number } | undefined;
  return row?.count ?? 0;
}

function resultForCount(count: number): { count: number; warning?: string } {
  const threshold = getWarnThreshold();
  if (count >= threshold) {
    return {
      count,
      warning: `paid_call_count: ${count} (threshold ${threshold}; informational only)`,
    };
  }
  return { count };
}

function incrementCounters(increment: number, workspaceId: string | undefined, at: string): void {
  stmts().upsert.run(GLOBAL_KEY, increment, at);
  if (workspaceId && workspaceId !== GLOBAL_KEY) {
    stmts().upsert.run(workspaceId, increment, at);
  }
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
  incrementCounters(increment, workspaceId, updatedAt);
  return resultForCount(readCount(GLOBAL_KEY));
}

const recordPaidCallOnceTransaction = db.transaction((
  eventKey: string,
  increment: number,
  workspaceId: string | undefined,
): { count: number; warning?: string } => {
  const recordedAt = new Date().toISOString();
  const inserted = stmts().insertEvent.run(
    eventKey,
    workspaceId ?? null,
    increment,
    recordedAt,
  ).changes === 1;

  if (inserted) {
    incrementCounters(increment, workspaceId, recordedAt);
  } else {
    const existing = stmts().eventByKey.get(eventKey) as {
      workspace_id: string | null;
      increment: number;
    } | undefined;
    if (!existing
      || existing.workspace_id !== (workspaceId ?? null)
      || existing.increment !== increment) {
      throw new Error('paid-call event key is already bound to different metering inputs');
    }
  }

  return resultForCount(readCount(GLOBAL_KEY));
});

/**
 * Record one accepted paid-work event exactly once.
 *
 * The durable event insert and both counter increments share one IMMEDIATE
 * transaction. Replaying the same namespaced event key is therefore a read of
 * the current global signal, while a crash-repair replay whose event was never
 * committed records the missing increment exactly once.
 */
export function recordPaidCallOnce(
  eventKey: string,
  increment = 1,
  workspaceId?: string,
): { count: number; warning?: string } {
  const normalizedEventKey = eventKey.trim();
  if (!normalizedEventKey) throw new Error('paid-call event key must not be empty');
  if (new TextEncoder().encode(normalizedEventKey).byteLength > 512) {
    throw new Error('paid-call event key must not exceed 512 UTF-8 bytes');
  }
  if (!Number.isSafeInteger(increment) || increment <= 0) {
    throw new Error('paid-call event increment must be a positive safe integer');
  }
  return recordPaidCallOnceTransaction.immediate(
    normalizedEventKey,
    increment,
    workspaceId,
  );
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
  db.transaction(() => {
    stmts().truncateEvents.run();
    stmts().truncate.run();
  }).immediate();
}
