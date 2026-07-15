import { randomUUID } from 'crypto';
import db from './db/index.js';
import { createStmtCache } from './db/stmt-cache.js';
import { parseJsonFallback } from './db/json-validation.js';
import { isProgrammingError } from './errors.js';
import { createLogger } from './logger.js';
import { recordOperationTrace } from './platform-observability.js';
import {
  getBackgroundJobLabel,
  isBackgroundJobCancellable,
  type BackgroundJobRecord,
  type BackgroundJobType,
  type JobResourceRef,
} from '../shared/types/background-jobs.js';
import { BACKGROUND_JOB_TRANSITIONS, validateTransition } from './state-machines.js';
import { WS_EVENTS } from './ws-events.js';


const log = createLogger('jobs');
export interface Job extends BackgroundJobRecord {}

type JobBroadcastFn = (event: string, job: Job) => void;

// In-memory write-through cache for fast reads (jobs are read frequently via WebSocket broadcasts)
const jobs = new Map<string, Job>();
const abortControllers = new Map<string, AbortController>();
let broadcastJobFn: JobBroadcastFn | null = null;

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
      AND NOT EXISTS (
        SELECT 1 FROM job_resource_claims claims
        WHERE claims.job_id = jobs.id AND claims.active = 1
      )
  `),
  deleteCompletedWorkspace: db.prepare(`
    DELETE FROM jobs
    WHERE workspace_id = ?
      AND status IN ('done', 'error', 'cancelled')
      AND NOT EXISTS (
        SELECT 1 FROM job_resource_claims claims
        WHERE claims.job_id = jobs.id AND claims.active = 1
      )
  `),
  // ws-scope-ok — explicitly scoped to jobs with no workspace owner.
  deleteCompletedGlobal: db.prepare(`
    DELETE FROM jobs
    WHERE workspace_id IS NULL
      AND status IN ('done', 'error', 'cancelled')
      AND NOT EXISTS (
        SELECT 1 FROM job_resource_claims claims
        WHERE claims.job_id = jobs.id AND claims.active = 1
      )
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
  // ws-scope-ok — restart recovery intentionally releases unreachable claims across every workspace.
  releaseInterruptedClaims: db.prepare(`
    UPDATE job_resource_claims
    SET active = 0, released_at = @releasedAt
    WHERE active = 1
  `),
  insertResourceClaim: db.prepare(`
    INSERT INTO job_resource_claims (
      job_id, workspace_id, resource_type, resource_id, active, created_at, released_at
    ) VALUES (@jobId, @workspaceId, @resourceType, @resourceId, 1, @createdAt, NULL)
  `),
  // ws-scope-ok — job IDs are globally unique and the FK binds every claim to its owning job.
  releaseResourceClaims: db.prepare(`
    UPDATE job_resource_claims
    SET active = 0, released_at = @releasedAt
    WHERE job_id = @jobId AND active = 1
  `),
  findActiveResourceOwner: db.prepare(`
    SELECT jobs.*
    FROM job_resource_claims claims
    JOIN jobs ON jobs.id = claims.job_id
    WHERE claims.workspace_id = @workspaceId
      AND claims.resource_type = @resourceType
      AND claims.resource_id = @resourceId
      AND claims.active = 1
    ORDER BY jobs.created_at ASC, jobs.id ASC
    LIMIT 1
  `),
  listResourceClaims: db.prepare(`
    SELECT resource_type, resource_id, active, created_at, released_at
    FROM job_resource_claims
    WHERE job_id = ?
    ORDER BY resource_type ASC, resource_id ASC
  `),
  hasActiveResourceClaims: db.prepare(`
    SELECT 1 FROM job_resource_claims WHERE job_id = ? AND active = 1 LIMIT 1
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
  const changes = db.transaction(() => {
    stmts().releaseInterruptedClaims.run({ releasedAt: updatedAt });
    return stmts().markInterruptedAfterRestart.run({
      message: SERVER_RESTART_INTERRUPTED_MESSAGE,
      error: SERVER_RESTART_INTERRUPTED_ERROR,
      updatedAt,
    }).changes;
  }).immediate();

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
    const hasActiveClaims = Boolean(stmts().hasActiveResourceClaims.get(id));
    if (!hasActiveClaims && now - new Date(job.updatedAt).getTime() > JOB_TTL_MS) {
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
      if (stmts().hasActiveResourceClaims.get(id)) continue;
      jobs.delete(id);
      try { stmts().delete.run(id); } catch (err) { if (isProgrammingError(err)) log.warn({ err }, 'jobs: programming error'); /* best effort */ }
      if (jobs.size <= MAX_JOBS) break;
    }
  }
}

// ── Public API ──

function broadcastJobEvent(event: string, job: Job): void {
  try {
    broadcastJobFn?.(event, job);
  } catch (err) {
    log.error({ err, jobId: job.id, event }, 'Job broadcast failed after durable state committed');
  }
}

function recordJobTrace(input: Parameters<typeof recordOperationTrace>[0]): void {
  try {
    recordOperationTrace(input);
  } catch (err) {
    log.error({ err, operation: input.operation }, 'Job trace recording failed after durable state committed');
  }
}

export function initJobs(broadcastJob: JobBroadcastFn) {
  broadcastJobFn = broadcastJob;
  loadJobsFromDb();
}

export interface CreateJobOptions {
  message?: string;
  total?: number;
  workspaceId?: string;
  /**
   * Trusted domain-owned identity for ledgers that accept a command before the
   * generic job row exists. Never expose this as caller-controlled HTTP/MCP input.
   */
  id?: string;
}

function buildPendingJob(type: BackgroundJobType | string, opts?: CreateJobOptions): Job {
  const now = new Date().toISOString();
  const id = opts?.id ?? randomUUID();
  if (id.trim() !== id || id.length < 1 || id.length > 200) {
    throw new Error('Background job id must be a non-empty, trimmed string of at most 200 characters');
  }
  const job: Job = {
    id,
    type,
    status: 'pending',
    progress: 0,
    total: opts?.total,
    message: opts?.message || `Starting ${getBackgroundJobLabel(type)}...`,
    createdAt: now,
    updatedAt: now,
    workspaceId: opts?.workspaceId,
  };
  return job;
}

function publishCreatedJob(job: Job): void {
  jobs.set(job.id, job);
  broadcastJobEvent(WS_EVENTS.JOB_CREATED, job);
  recordJobTrace({
    source: 'job',
    operation: `job:${job.type}`,
    status: 'warning',
    workspaceId: job.workspaceId,
    message: `Job created (${job.status})`,
  });
}

export function createJob(type: BackgroundJobType | string, opts?: CreateJobOptions): Job {
  pruneOldJobs();
  const job = buildPendingJob(type, opts);
  // Write to SQLite first, then cache/broadcast.
  stmts().insert.run(jobToParams(job));
  publishCreatedJob(job);
  return job;
}

export interface JobResourceClaim extends JobResourceRef {
  active: boolean;
  createdAt: string;
  releasedAt?: string;
}

export interface ActiveJobResourceOwner {
  jobId: string;
  resource: JobResourceRef;
}

export class ActiveJobResourceConflict extends Error {
  readonly code = 'active_job_resource_conflict';
  readonly jobId: string;
  readonly conflicts: JobResourceRef[];
  readonly owners: ActiveJobResourceOwner[];

  constructor(owners: ActiveJobResourceOwner[]) {
    super('A job is already active for this resource');
    this.name = 'ActiveJobResourceConflict';
    this.owners = owners;
    this.jobId = owners[0].jobId;
    this.conflicts = owners.map(owner => owner.resource);
  }
}

type SynchronousAcceptance<T> = T extends PromiseLike<unknown> ? never : T;

export interface CreateResourceScopedJobOptions<TAccepted = undefined>
  extends CreateJobOptions {
  workspaceId: string;
  resources: JobResourceRef[];
  /** DB-only acceptance work. Side effects and broadcasts must happen after this returns. */
  accept?: (job: Readonly<Job>) => SynchronousAcceptance<TAccepted>;
}

export interface ResourceScopedJobStart<TAccepted = undefined> {
  job: Job;
  accepted: TAccepted;
}

function normalizeJobResources(resources: JobResourceRef[]): JobResourceRef[] {
  const normalized = resources.map(resource => {
    const resourceId = resource.resourceId.trim();
    if (!resourceId || resourceId.length > 500) {
      throw new Error('Job resource id must be a non-empty, trimmed string of at most 500 characters');
    }
    if (resourceId !== resource.resourceId) {
      throw new Error('Job resource id must already be canonical and trimmed');
    }
    return { resourceType: resource.resourceType, resourceId };
  });
  return [...new Map(
    normalized.map(resource => [`${resource.resourceType}\0${resource.resourceId}`, resource]),
  ).values()].sort((a, b) => (
    a.resourceType.localeCompare(b.resourceType) || a.resourceId.localeCompare(b.resourceId)
  ));
}

function activeResourceConflicts(
  workspaceId: string,
  resources: JobResourceRef[],
): ActiveJobResourceOwner[] {
  const owners = resources.flatMap(resource => {
    const row = stmts().findActiveResourceOwner.get({ workspaceId, ...resource }) as JobRow | undefined;
    return row ? [{ jobId: row.id, resource }] : [];
  });
  return owners.sort((a, b) => (
    a.resource.resourceType.localeCompare(b.resource.resourceType)
    || a.resource.resourceId.localeCompare(b.resource.resourceId)
    || a.jobId.localeCompare(b.jobId)
  ));
}

function isResourceClaimUniqueConflict(err: unknown): boolean {
  const error = err as { code?: string; message?: string } | null;
  return error?.code === 'SQLITE_CONSTRAINT_UNIQUE'
    && Boolean(error.message?.includes(
      'job_resource_claims.workspace_id, job_resource_claims.resource_type, job_resource_claims.resource_id',
    ));
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return typeof value === 'object'
    && value !== null
    && typeof (value as { then?: unknown }).then === 'function';
}

export function createResourceScopedJob<TAccepted = undefined>(
  type: BackgroundJobType | string,
  options: CreateResourceScopedJobOptions<TAccepted>,
): ResourceScopedJobStart<TAccepted> {
  pruneOldJobs();
  const resources = normalizeJobResources(options.resources);
  if (resources.length === 0) throw new Error('Resource-scoped jobs require at least one resource');
  const job = buildPendingJob(type, options);
  if (options.accept?.constructor.name === 'AsyncFunction') {
    throw new TypeError('Resource-scoped job acceptance must be synchronous');
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const accepted = db.transaction(() => {
        stmts().insert.run(jobToParams(job));
        for (const resource of resources) {
          stmts().insertResourceClaim.run({
            jobId: job.id,
            workspaceId: options.workspaceId,
            ...resource,
            createdAt: job.createdAt,
          });
        }
        const acceptance = options.accept?.(Object.freeze({ ...job }));
        if (isThenable(acceptance)) {
          throw new TypeError('Resource-scoped job acceptance must be synchronous');
        }
        return acceptance as TAccepted;
      }).immediate();
      publishCreatedJob(job);
      return { job, accepted };
    } catch (err) {
      if (!isResourceClaimUniqueConflict(err)) throw err;
      const owners = activeResourceConflicts(options.workspaceId, resources);
      if (owners.length > 0) throw new ActiveJobResourceConflict(owners);
      if (attempt === 1) throw err;
    }
  }
  throw new Error('Resource-scoped job acceptance retry exhausted');
}

export function updateJob(id: string, update: Partial<Omit<Job, 'id' | 'type' | 'createdAt'>>) {
  const job = jobs.get(id);
  if (!job) return;
  const normalizedUpdate = { ...update };
  if (normalizedUpdate.status && normalizedUpdate.status !== job.status) {
    try {
      validateTransition('background_job', BACKGROUND_JOB_TRANSITIONS, job.status, normalizedUpdate.status);
    } catch (err) {
      if (isProgrammingError(err)) {
        log.warn({ err, jobId: id, from: job.status, to: normalizedUpdate.status }, 'jobs/updateJob: invalid status transition ignored');
      }
      return;
    }
  }
  const nextJob: Job = {
    ...job,
    ...normalizedUpdate,
    updatedAt: new Date().toISOString(),
  };
  db.transaction(() => {
    stmts().update.run({
      id: nextJob.id,
      status: nextJob.status,
      progress: nextJob.progress ?? null,
      total: nextJob.total ?? null,
      message: nextJob.message ?? null,
      result: nextJob.result !== undefined ? JSON.stringify(nextJob.result) : null,
      error: nextJob.error ?? null,
      updatedAt: nextJob.updatedAt,
    });
    if (nextJob.status === 'done' || nextJob.status === 'error') {
      stmts().releaseResourceClaims.run({ jobId: id, releasedAt: nextJob.updatedAt });
    }
  }).immediate();
  Object.assign(job, nextJob);
  broadcastJobEvent(WS_EVENTS.JOB_UPDATED, job);

  if (job.status === 'done' || job.status === 'error' || job.status === 'cancelled') {
    const durationMs = Math.max(0, new Date(job.updatedAt).getTime() - new Date(job.createdAt).getTime());
    recordJobTrace({
      source: 'job',
      operation: `job:${job.type}`,
      status: job.status === 'done' ? 'success' : 'error',
      workspaceId: job.workspaceId,
      durationMs,
      message: job.error ?? job.message ?? `Job ${job.status}`,
    });
  }
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

export function getJobResourceClaims(jobId: string): JobResourceClaim[] {
  const rows = stmts().listResourceClaims.all(jobId) as Array<{
    resource_type: JobResourceRef['resourceType'];
    resource_id: string;
    active: number;
    created_at: string;
    released_at: string | null;
  }>;
  return rows.map(row => ({
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    active: row.active === 1,
    createdAt: row.created_at,
    releasedAt: row.released_at ?? undefined,
  }));
}

export function getActiveJobForResource(
  workspaceId: string,
  resource: JobResourceRef,
): Job | undefined {
  const [normalized] = normalizeJobResources([resource]);
  const row = stmts().findActiveResourceOwner.get({ workspaceId, ...normalized }) as JobRow | undefined;
  if (!row) return undefined;
  const job = rowToJob(row);
  jobs.set(job.id, job);
  return job;
}

/** Release retained claims after a cancelled worker has fully drained. */
export function finalizeJobResourceClaims(jobId: string): number {
  return stmts().releaseResourceClaims.run({
    jobId,
    releasedAt: new Date().toISOString(),
  }).changes;
}

export function registerAbort(jobId: string): AbortController {
  const ac = new AbortController();
  abortControllers.set(jobId, ac);
  if (getJob(jobId)?.status === 'cancelled') ac.abort();
  return ac;
}

export function unregisterAbort(jobId: string): void {
  abortControllers.delete(jobId);
  const job = getJob(jobId);
  if (job?.status === 'cancelled') finalizeJobResourceClaims(jobId);
}

/**
 * Runs a claimed worker with cancellation registered before user code and
 * guarantees that an early return cannot strand an active resource claim.
 */
export async function runResourceScopedJobWorker<T>(
  jobId: string,
  worker: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = registerAbort(jobId);
  try {
    return await worker(controller.signal);
  } finally {
    try {
      const current = getJob(jobId);
      if (current?.status === 'pending' || current?.status === 'running') {
        updateJob(jobId, {
          status: 'error',
          message: 'Worker exited before recording a terminal result',
          error: 'Background worker exited without a terminal status',
        });
      }
    } finally {
      try {
        unregisterAbort(jobId);
      } finally {
        // The worker has drained, so a failed fallback terminal write must not
        // strand its resource claim until process restart. Successful done/error
        // writes already released the claim; this is an idempotent safety net.
        const drained = getJob(jobId);
        if (drained?.status === 'pending' || drained?.status === 'running') {
          finalizeJobResourceClaims(jobId);
        }
      }
    }
  }
}

export function getJobCancellationError(job: Job): string | null {
  const isActive = job.status === 'pending' || job.status === 'running';
  if (!isActive) return null;
  if (isBackgroundJobCancellable(job.type)) return null;
  return `${getBackgroundJobLabel(job.type)} cannot be cancelled once it has started`;
}

export function cancelJob(id: string): Job | undefined {
  const ac = abortControllers.get(id);
  if (ac) ac.abort();
  const job = jobs.get(id);
  if (job && (job.status === 'pending' || job.status === 'running')) {
    try {
      validateTransition('background_job', BACKGROUND_JOB_TRANSITIONS, job.status, 'cancelled');
    } catch (err) {
      if (isProgrammingError(err)) {
        log.warn({ err, jobId: id, from: job.status, to: 'cancelled' }, 'jobs/cancelJob: invalid status transition ignored');
      }
      return job;
    }
    const nextJob: Job = {
      ...job,
      status: 'cancelled',
      message: 'Cancelled by user',
      updatedAt: new Date().toISOString(),
    };
    stmts().update.run({
      id: nextJob.id,
      status: nextJob.status,
      progress: nextJob.progress ?? null,
      total: nextJob.total ?? null,
      message: nextJob.message ?? null,
      result: nextJob.result !== undefined ? JSON.stringify(nextJob.result) : null,
      error: nextJob.error ?? null,
      updatedAt: nextJob.updatedAt,
    });
    Object.assign(job, nextJob);
    broadcastJobEvent(WS_EVENTS.JOB_UPDATED, job);
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
    if (matchesScope
      && (job.status === 'done' || job.status === 'error' || job.status === 'cancelled')
      && !stmts().hasActiveResourceClaims.get(id)) {
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
