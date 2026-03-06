import { randomUUID } from 'crypto';

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

const jobs = new Map<string, Job>();
const abortControllers = new Map<string, AbortController>();
let broadcastFn: BroadcastFn | null = null;

const MAX_JOBS = 200;
const JOB_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

function pruneOldJobs() {
  if (jobs.size <= MAX_JOBS) return;
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (now - new Date(job.updatedAt).getTime() > JOB_TTL_MS) {
      jobs.delete(id);
    }
  }
  // If still over limit, remove oldest completed jobs
  if (jobs.size > MAX_JOBS) {
    const sorted = [...jobs.entries()]
      .filter(([, j]) => j.status === 'done' || j.status === 'error')
      .sort((a, b) => new Date(a[1].updatedAt).getTime() - new Date(b[1].updatedAt).getTime());
    for (const [id] of sorted) {
      jobs.delete(id);
      if (jobs.size <= MAX_JOBS) break;
    }
  }
}

export function initJobs(broadcast: BroadcastFn) {
  broadcastFn = broadcast;
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
  jobs.set(job.id, job);
  broadcastFn?.('job:created', job);
  return job;
}

export function updateJob(id: string, update: Partial<Omit<Job, 'id' | 'type' | 'createdAt'>>) {
  const job = jobs.get(id);
  if (!job) return;
  Object.assign(job, update, { updatedAt: new Date().toISOString() });
  broadcastFn?.('job:update', job);
}

export function getJob(id: string): Job | undefined {
  return jobs.get(id);
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
    broadcastFn?.('job:update', job);
  }
  return job;
}

export function isJobCancelled(id: string): boolean {
  const ac = abortControllers.get(id);
  return ac?.signal.aborted ?? false;
}
