import { randomUUID } from 'node:crypto';
import db from '../db/index.js';
import { createStmtCache } from '../db/stmt-cache.js';
import { parseJsonFallback } from '../db/json-validation.js';
import { createLogger } from '../logger.js';

const log = createLogger('mcp-handles');

export type HandleKind =
  | 'keyword-research'
  | 'keyword-research-bulk'
  | 'brief-request'
  | 'brief'
  | 'post-request'
  | 'post';

const DEFAULT_TTL_MS = 15 * 60 * 1000;

/**
 * Upper bound on live handles. When an issue would exceed this, the oldest rows
 * are evicted so the table cannot grow unbounded across a long-lived,
 * multi-instance deployment. Override with MCP_MAX_HANDLES.
 */
const DEFAULT_MAX_HANDLES = 10_000;

function getMaxHandles(): number {
  const raw = process.env.MCP_MAX_HANDLES;
  if (!raw) return DEFAULT_MAX_HANDLES;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_MAX_HANDLES;
  return parsed;
}

// INTERNAL — DB row shape for the mcp_handles table.
interface HandleRow {
  token: string;
  workspace_id: string;
  kind: string;
  payload: string;
  created_at: string;
  expires_at: string;
}

const stmts = createStmtCache(() => ({
  insert: db.prepare(`
    INSERT INTO mcp_handles (token, workspace_id, kind, payload, created_at, expires_at)
    VALUES (@token, @workspace_id, @kind, @payload, @created_at, @expires_at)
  `),
  getByToken: db.prepare<[token: string]>(
    `SELECT * FROM mcp_handles WHERE token = ?`,
  ),
  deleteByToken: db.prepare<[token: string]>(
    `DELETE FROM mcp_handles WHERE token = ?`,
  ),
  deleteExpired: db.prepare<[nowIso: string]>(
    `DELETE FROM mcp_handles WHERE expires_at <= ?`,
  ),
  count: db.prepare(`SELECT COUNT(*) AS n FROM mcp_handles`),
  // Evict the oldest live rows to honour MAX_HANDLES. Order by the implicit
  // rowid (monotonic insertion order) rather than created_at, so eviction is
  // deterministic even when many handles are issued within the same millisecond
  // (identical ISO created_at strings would otherwise tie-break unpredictably).
  evictOldest: db.prepare<[limit: number]>(`
    DELETE FROM mcp_handles
    WHERE token IN (
      SELECT token FROM mcp_handles ORDER BY rowid ASC LIMIT ?
    )
  `),
  truncate: db.prepare(`DELETE FROM mcp_handles`), // ws-scope-ok: test-only full-table reset of the ephemeral handle store
}));

export class HandleNotFoundError extends Error {
  constructor(id: string) {
    super(`Handle not found or already consumed: ${id}`);
    this.name = 'HandleNotFoundError';
  }
}

export class HandleExpiredError extends Error {
  constructor(id: string) {
    super(`Handle expired (TTL exceeded): ${id}. Re-run the producing tool.`);
    this.name = 'HandleExpiredError';
  }
}

export class HandleKindMismatchError extends Error {
  constructor(id: string, expected: HandleKind, actual: HandleKind) {
    super(`Handle ${id} is kind '${actual}', expected '${expected}'`);
    this.name = 'HandleKindMismatchError';
  }
}

export class HandleWorkspaceMismatchError extends Error {
  constructor(id: string, expected: string, actual: string) {
    super(`Handle ${id} belongs to workspace '${actual}', not '${expected}'`);
    this.name = 'HandleWorkspaceMismatchError';
  }
}

export function issueHandle(
  kind: HandleKind,
  workspaceId: string,
  payload: unknown,
  opts?: { ttlMs?: number },
): string {
  const id = `${kind}_${randomUUID()}`;
  const ttlMs = opts?.ttlMs ?? DEFAULT_TTL_MS;
  const now = Date.now();
  stmts().insert.run({
    token: id,
    workspace_id: workspaceId,
    kind,
    payload: JSON.stringify(payload ?? null),
    created_at: new Date(now).toISOString(),
    expires_at: new Date(now + ttlMs).toISOString(),
  });

  // Enforce MAX_HANDLES: evict the oldest rows when the bound is exceeded.
  const max = getMaxHandles();
  const total = (stmts().count.get() as { n: number }).n;
  if (total > max) {
    stmts().evictOldest.run(total - max);
  }

  return id;
}

export function consumeHandle<T = unknown>(
  id: string,
  expectedKind: HandleKind,
  expectedWorkspaceId: string,
): T {
  const row = stmts().getByToken.get(id) as HandleRow | undefined;
  if (!row) {
    throw new HandleNotFoundError(id);
  }
  if (Date.now() > Date.parse(row.expires_at)) {
    stmts().deleteByToken.run(id);
    throw new HandleExpiredError(id);
  }
  if (row.kind !== expectedKind) {
    throw new HandleKindMismatchError(id, expectedKind, row.kind as HandleKind);
  }
  if (row.workspace_id !== expectedWorkspaceId) {
    throw new HandleWorkspaceMismatchError(id, expectedWorkspaceId, row.workspace_id);
  }
  // Single-use: delete on successful consume.
  stmts().deleteByToken.run(id);
  // Payload was produced internally via JSON.stringify on issue; fall back to
  // null only if the stored row was somehow corrupted.
  return parseJsonFallback<T>(row.payload, null as T);
}

/**
 * Delete every expired handle. Called by the periodic sweeper and exposed for
 * tests / manual maintenance. Returns the number of rows removed.
 */
export function sweepExpiredHandles(): number {
  const info = stmts().deleteExpired.run(new Date().toISOString());
  return info.changes;
}

// ── TTL sweeper ──────────────────────────────────────────────────────────────
// Periodic timer that deletes expired rows. Guarded off under tests (an
// always-on timer breaks test teardown) and .unref()'d so it never holds the
// process open.
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

if (process.env.NODE_ENV !== 'test') {
  const timer = setInterval(() => {
    try {
      sweepExpiredHandles();
    } catch (err) {
      // Sweeper failures are non-fatal: a transient DB lock just retries next tick.
      log.debug({ err }, 'mcp-handles sweeper: expected transient failure — retrying next tick');
    }
  }, SWEEP_INTERVAL_MS);
  timer.unref();
}

/** Test-only: clear the handle store between tests. Do not call in production code. */
export function __resetHandleStoreForTests(): void {
  stmts().truncate.run();
}
