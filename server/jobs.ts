import { randomUUID } from 'crypto';
import db from './db/index.js';

export interface Job {
  id: string;
  type: string;
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

// ── Lazy prepared statements ──

let _insertStmt: ReturnType<typeof db.prepare> | null = null;
function insertStmt() {
  if (!_insertStmt) {
    _insertStmt = db.prepare(`
      INSERT INTO jobs (id, type, status, progress, total, message, result, error, workspace_id, created_at, updated_at)
      VALUES (@id, @type, @status, @progress, @total, @message, @result, @error, @workspaceId, @createdAt, @updatedAt)
    `);
  }
  return _insertStmt;
}

let _updateStmt: ReturnType<typeof db.prepare> | null = null;
function updateStmt() {
  if (!_updateStmt) {
    _updateStmt = db.prepare(`
      UPDATE jobs SET status = @status, progress = @progress, total = @total, message = @message,
        result = @result, error = @error, updated_at = @updatedAt
      WHERE id = @id
    `);
  }
  return _updateStmt;
}

let _deleteStmt: ReturnType<typeof db.prepare> | null = null;
function deleteStmt() {
  if (!_deleteStmt) {
    _deleteStmt = db.prepare(`DELETE FROM jobs WHERE id = ?`);
  }
  return _deleteStmt;
}

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
    result: row.result ? JSON.parse(row.result) : undefined,
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

function loadJobsFromDb(): void {
  // Mark any 'running' or 'pending' jobs as interrupted (they can't be resumed after restart)
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE jobs SET status = 'error', error = 'Server restarted — job interrupted', updated_at = ? WHERE status IN ('running', 'pending')`
  ).run(now);

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
      try { deleteStmt().run(id); } catch { /* best effort */ }
    }
  }
  // If still over limit, remove oldest completed jobs
  if (jobs.size > MAX_JOBS) {
    const sorted = [...jobs.entries()]
      .filter(([, j]) => j.status === 'done' || j.status === 'error')
      .sort((a, b) => new Date(a[1].updatedAt).getTime() - new Date(b[1].updatedAt).getTime());
    for (const [id] of sorted) {
      jobs.delete(id);
      try { deleteStmt().run(id); } catch { /* best effort */ }
      if (jobs.size <= MAX_JOBS) break;
    }
  }
}

// ── Public API ──

export function initJobs(broadcast: BroadcastFn) {
  broadcastFn = broadcast;
  loadJobsFromDb();
}

export function createJob(type: string, opts?: { message?: string; total?: number; workspaceId?: string }): Job {
  pruneOldJobs();
  const now = new Date().toISOString();
  const job: Job = {
    id: randomUUID(),
    type,
    status: 'pending',
    progress: 0,
    total: opts?.total,
    message: opts?.message || `Starting ${type}...`,
    createdAt: now,
    updatedAt: now,
    workspaceId: opts?.workspaceId,
  };
  // Write to SQLite first, then cache
  insertStmt().run(jobToParams(job));
  jobs.set(job.id, job);
  broadcastFn?.('job:created', job);
  return job;
}

export function updateJob(id: string, update: Partial<Omit<Job, 'id' | 'type' | 'createdAt'>>) {
  const job = jobs.get(id);
  if (!job) return;
  Object.assign(job, update, { updatedAt: new Date().toISOString() });
  // Write through to SQLite
  updateStmt().run({
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

export function cancelJob(id: string): Job | undefined {
  const ac = abortControllers.get(id);
  if (ac) { ac.abort(); abortControllers.delete(id); }
  const job = jobs.get(id);
  if (job && (job.status === 'pending' || job.status === 'running')) {
    Object.assign(job, { status: 'cancelled', message: 'Cancelled by user', updatedAt: new Date().toISOString() });
    updateStmt().run({
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
  return ac?.signal.aborted ?? false;
}

/** Check if an active (pending/running) job of the given type already exists for a workspace. */
export function hasActiveJob(type: string, workspaceId?: string): Job | undefined {
  for (const job of jobs.values()) {
    if (job.type === type && (job.status === 'pending' || job.status === 'running')) {
      if (!workspaceId || job.workspaceId === workspaceId) return job;
    }
  }
  return undefined;
}

/** Mark all active (running/pending) jobs as interrupted (called during graceful shutdown). */
export function markRunningJobsInterrupted(): void {
  for (const job of jobs.values()) {
    if (job.status === 'running' || job.status === 'pending') {
      updateJob(job.id, { status: 'error', error: 'Server shutting down — job interrupted' });
    }
  }
}
