import { randomUUID } from 'crypto';
import db from './db/index.js';
import { createStmtCache } from './db/stmt-cache.js';
import { parseJsonFallback } from './db/json-validation.js';
import { isProgrammingError } from './errors.js';
import { createLogger } from './logger.js';
import { getBackgroundJobLabel, type BackgroundJobType } from '../shared/types/background-jobs.js';


const log = createLogger('jobs');
export interface Job {
  id: string;
  type: BackgroundJobType | string;
  status: 'pending' | 'running' | 'done' | 'error' | 'cancelled';
  progress?: number;
  total?: number;
  message?: string;
  result?: unknown;
  error?: string;
  createdAt: string;
  updatedAt: string;
  workspaceId?: string;
}

type BroadcastFn = (event: string, data: unknown) => void;

// In-memory write-through cache for fast reads (jobs are read frequently via WebSocket broadcasts)
const jobs = new Map<string, Job>();
const abortControllers = new Map<string, AbortController>();
let broadcastFn: BroadcastFn | null = null;

const MAX_JOBS = 200;
const JOB_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours
const SERVER_RESTART_INTERRUPTED_ERROR = 'Server restarted — job interrupted';
const SERVER_RESTART_INTERRUPTED_MESSAGE = 'Interrupted by server restart';
const SERVER_SHUTDOWN_INTERRUPTED_ERROR = 'Server shutting down — job interrupted';
const SERVER_SHUTDOWN_INTERRUPTED_MESSAGE = 'Interrupted by server shutdown';

// ── Prepared statements ──
const stmts = createStmtCache(() => ({
  insert: db.prepare(`
    INSERT INTO jobs (id, type, status, progress, total, message, result, error, workspace_id, created_at, updated_at)
    VALUES (@id, @type, @status, @progress, @total, @message, @result, @error, @workspaceId, @createdAt, @updatedAt)
  `),
  // jobs.workspace_id is nullable (some jobs are global). The id is a
  // randomUUID() (122-bit entropy), so cross-workspace collision is impossible.
  // ws-scope-ok
  update: db.prepare(`
    UPDATE jobs SET status = @status, progress = @progress, total = @total, message = @message, -- status-ok: job progress tracker
      result = @result, error = @error, updated_at = @updatedAt
    WHERE id = @id
  `),
  // ws-scope-ok — jobs.id is a randomUUID() (122-bit entropy, globally unique).
  delete: db.prepare(`DELETE FROM jobs WHERE id = ?`),
  // ws-scope-ok — owner-only maintenance endpoint and test cleanup intentionally clear all terminal jobs.
  deleteCompletedAll: db.prepare(`
    DELETE FROM jobs
    WHERE status IN ('done', 'error', 'cancelled')
  `),
  deleteCompletedWorkspace: db.prepare(`
    DELETE FROM jobs
    WHERE workspace_id = ?
      AND status IN ('done', 'error', 'cancelled')
  `),
  // ws-scope-ok — explicitly scoped to jobs with no workspace owner.
  deleteCompletedGlobal: db.prepare(`
    DELETE FROM jobs
    WHERE workspace_id IS NULL
      AND status IN ('done', 'error', 'cancelled')
  `),
  // Startup recovery is intentionally global. Active jobs left across a process
  // restart are unreachable regardless of workspace ownership.
  // ws-scope-ok
  markInterruptedAfterRestart: db.prepare(`
    UPDATE jobs
    SET status = 'error', -- status-ok: restart recovery marks unreachable jobs terminal
      message = @message,
      error = @error,
      updated_at = @updatedAt
    WHERE status IN ('running', 'pending')
  `),
  findActiveByType: db.prepare(`
    SELECT * FROM jobs
    WHERE type = ?
      AND status IN ('pending', 'running')
    ORDER BY created_at DESC
    LIMIT 1
  `),
  findActiveByTypeWorkspace: db.prepare(`
    SELECT * FROM jobs
    WHERE type = ?
      AND workspace_id = ?
      AND status IN ('pending', 'running')
    ORDER BY created_at DESC
    LIMIT 1
  `),
}));

// ── Row ↔ Job mapping ──

interface JobRow {
  id: string;
  type: string;
  status: string;
  progress: number | null;
  total: number | null;
  message: string | null;
  result: string | null;
  error: string | null;
  workspace_id: string | null;
  created_at: string;
  updated_at: string;
}

function rowToJob(row: JobRow): Job {
  return {
    id: row.id,
    type: row.type,
    status: row.status as Job['status'],
    progress: row.progress ?? undefined,
    total: row.total ?? undefined,
    message: row.message ?? undefined,
    result: row.result ? parseJsonFallback(row.result, undefined) : undefined,
    error: row.error ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    workspaceId: row.workspace_id ?? undefined,
  };
}

function jobToParams(job: Job) {
  return {
    id: job.id,
    type: job.type,
    status: job.status,
    progress: job.progress ?? null,
    total: job.total ?? null,
    message: job.message ?? null,
    result: job.result !== undefined ? JSON.stringify(job.result) : null,
    error: job.error ?? null,
    workspaceId: job.workspaceId ?? null,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

// ── Startup: load active jobs from SQLite, mark interrupted ──

export function recoverInterruptedJobsAfterRestart(): number {
  const updatedAt = new Date().toISOString();
  const changes = stmts().markInterruptedAfterRestart.run({
    message: SERVER_RESTART_INTERRUPTED_MESSAGE,
    error: SERVER_RESTART_INTERRUPTED_ERROR,
    updatedAt,
  }).changes;

  for (const job of jobs.values()) {
    if (job.status === 'running' || job.status === 'pending') {
      Object.assign(job, {
        status: 'error',
        message: SERVER_RESTART_INTERRUPTED_MESSAGE,
        error: SERVER_RESTART_INTERRUPTED_ERROR,
        updatedAt,
      });
    }
  }

  return changes;
}

function loadJobsFromDb(): void {
  // Mark any 'running' or 'pending' jobs as interrupted (they can't be resumed after restart).
  const recovered = recoverInterruptedJobsAfterRestart();
  if (recovered > 0) {
    log.warn({ count: recovered }, 'Recovered interrupted jobs after server restart');
  }

  // Load recent jobs into cache for fast reads
  const rows = db.prepare(
    `SELECT * FROM jobs ORDER BY updated_at DESC LIMIT ?`
  ).all(MAX_JOBS) as JobRow[];

  for (const row of rows) {
    jobs.set(row.id, rowToJob(row));
  }
}

// ── Pruning ──

function pruneOldJobs() {
  if (jobs.size <= MAX_JOBS) return;
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (now - new Date(job.updatedAt).getTime() > JOB_TTL_MS) {
      jobs.delete(id);
      try { stmts().delete.run(id); } catch (err) { if (isProgrammingError(err)) log.warn({ err }, 'jobs/pruneOldJobs: programming error'); /* best effort */ }
    }
  }
  // If still over limit, remove oldest completed jobs
  if (jobs.size > MAX_JOBS) {
    const sorted = [...jobs.entries()]
      .filter(([, j]) => j.status === 'done' || j.status === 'error')
      .sort((a, b) => new Date(a[1].updatedAt).getTime() - new Date(b[1].updatedAt).getTime());
    for (const [id] of sorted) {
      jobs.delete(id);
      try { stmts().delete.run(id); } catch (err) { if (isProgrammingError(err)) log.warn({ err }, 'jobs: programming error'); /* best effort */ }
      if (jobs.size <= MAX_JOBS) break;
    }
  }
}

// ── Public API ──

export function initJobs(broadcast: BroadcastFn) {
  broadcastFn = broadcast;
  loadJobsFromDb();
}

export function createJob(type: BackgroundJobType | string, opts?: { message?: string; total?: number; workspaceId?: string }): Job {
  pruneOldJobs();
  const now = new Date().toISOString();
  const job: Job = {
    id: randomUUID(),
    type,
    status: 'pending',
    progress: 0,
    total: opts?.total,
    message: opts?.message || `Starting ${getBackgroundJobLabel(type)}...`,
    createdAt: now,
    updatedAt: now,
    workspaceId: opts?.workspaceId,
  };
  // Write to SQLite first, then cache
  stmts().insert.run(jobToParams(job));
  jobs.set(job.id, job);
  broadcastFn?.('job:created', job);
  return job;
}

export function updateJob(id: string, update: Partial<Omit<Job, 'id' | 'type' | 'createdAt'>>) {
  const job = jobs.get(id);
  if (!job) return;
  const normalizedUpdate = { ...update };
  if (job.status === 'cancelled' && update.status && update.status !== 'cancelled') {
    delete normalizedUpdate.status;
    delete normalizedUpdate.message;
  }
  Object.assign(job, normalizedUpdate, { updatedAt: new Date().toISOString() });
  // Write through to SQLite
  stmts().update.run({
    id: job.id,
    status: job.status,
    progress: job.progress ?? null,
    total: job.total ?? null,
    message: job.message ?? null,
    result: job.result !== undefined ? JSON.stringify(job.result) : null,
    error: job.error ?? null,
    updatedAt: job.updatedAt,
  });
  broadcastFn?.('job:update', job);
}

export function getJob(id: string): Job | undefined {
  // Fast path: read from cache
  const cached = jobs.get(id);
  if (cached) return cached;
  // Fallback: read from SQLite
  const row = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as JobRow | undefined;
  if (row) {
    const job = rowToJob(row);
    jobs.set(job.id, job);
    return job;
  }
  return undefined;
}

export function listJobs(workspaceId?: string): Job[] {
  const all = [...jobs.values()].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
  if (workspaceId) return all.filter(j => j.workspaceId === workspaceId);
  return all;
}

export function registerAbort(jobId: string): AbortController {
  const ac = new AbortController();
  abortControllers.set(jobId, ac);
  return ac;
}

export function unregisterAbort(jobId: string): void {
  abortControllers.delete(jobId);
}

export function cancelJob(id: string): Job | undefined {
  const ac = abortControllers.get(id);
  if (ac) ac.abort();
  const job = jobs.get(id);
  if (job && (job.status === 'pending' || job.status === 'running')) {
    Object.assign(job, { status: 'cancelled', message: 'Cancelled by user', updatedAt: new Date().toISOString() });
    stmts().update.run({
      id: job.id,
      status: job.status,
      progress: job.progress ?? null,
      total: job.total ?? null,
      message: job.message ?? null,
      result: job.result !== undefined ? JSON.stringify(job.result) : null,
      error: job.error ?? null,
      updatedAt: job.updatedAt,
    });
    broadcastFn?.('job:update', job);
  }
  return job;
}

export function isJobCancelled(id: string): boolean {
  const ac = abortControllers.get(id);
  if (ac?.signal.aborted) return true;
  return getJob(id)?.status === 'cancelled';
}

/** Check if an active (pending/running) job of the given type already exists for a workspace. */
export function hasActiveJob(type: string, workspaceId?: string): Job | undefined {
  for (const job of jobs.values()) {
    if (job.type === type && (job.status === 'pending' || job.status === 'running')) {
      if (!workspaceId || job.workspaceId === workspaceId) return job;
    }
  }
  const row = workspaceId
    ? stmts().findActiveByTypeWorkspace.get(type, workspaceId) as JobRow | undefined
    : stmts().findActiveByType.get(type) as JobRow | undefined;
  if (row) {
    const job = rowToJob(row);
    jobs.set(job.id, job);
    return job;
  }
  return undefined;
}

interface ClearCompletedJobsOptions {
  workspaceId?: string;
  globalOnly?: boolean;
}

/** Delete completed (done/error/cancelled) jobs from memory and SQLite. */
export function clearCompletedJobs(options: ClearCompletedJobsOptions = {}): number {
  let changes = 0;
  if (options.workspaceId) {
    changes = stmts().deleteCompletedWorkspace.run(options.workspaceId).changes;
  } else if (options.globalOnly) {
    changes = stmts().deleteCompletedGlobal.run().changes;
  } else {
    changes = stmts().deleteCompletedAll.run().changes;
  }

  for (const [id, job] of jobs) {
    const matchesScope =
      options.workspaceId ? job.workspaceId === options.workspaceId :
      options.globalOnly ? !job.workspaceId :
      true;
    if (matchesScope && (job.status === 'done' || job.status === 'error' || job.status === 'cancelled')) {
      jobs.delete(id);
    }
  }
  return changes;
}

/** Mark all active (running/pending) jobs as interrupted (called during graceful shutdown). */
export function markRunningJobsInterrupted(): void {
  for (const job of jobs.values()) {
    if (job.status === 'running' || job.status === 'pending') {
      updateJob(job.id, {
        status: 'error',
        message: SERVER_SHUTDOWN_INTERRUPTED_MESSAGE,
        error: SERVER_SHUTDOWN_INTERRUPTED_ERROR,
      });
    }
  }
}
