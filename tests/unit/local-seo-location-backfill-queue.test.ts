import { describe, expect, it, vi } from 'vitest';

import { LocalSeoLocationBackfillQueue, type LocalSeoLocationBackfillQueueDeps } from '../../server/local-seo-location-backfill-queue.js';
import type { Job } from '../../server/jobs.js';

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeJob(id: string, workspaceId: string, total: number): Job {
  const now = new Date().toISOString();
  return {
    id,
    type: 'local_seo_location_backfill',
    status: 'pending',
    progress: 0,
    total,
    message: 'Queued',
    createdAt: now,
    updatedAt: now,
    workspaceId,
  };
}

describe('LocalSeoLocationBackfillQueue', () => {
  it('coalesces bursts before the first scheduled backfill starts', async () => {
    const scheduled: Array<() => void> = [];
    const run = deferred();
    let nextJob = 1;

    const deps: LocalSeoLocationBackfillQueueDeps = {
      createJob: vi.fn((_type, opts) => makeJob(`job-${nextJob++}`, opts?.workspaceId ?? 'unknown', opts?.total ?? 0)),
      hasActiveJob: vi.fn(() => undefined),
      updateJob: vi.fn(),
      countSnapshots: vi.fn(() => 226),
      runJob: vi.fn(() => run.promise),
      schedule: vi.fn(task => scheduled.push(task)),
      logError: vi.fn(),
    };
    const queue = new LocalSeoLocationBackfillQueue(deps);

    expect(queue.enqueue('ws-1')).toBe('job-1');
    expect(queue.enqueue('ws-1')).toBe('job-1');
    expect(queue.enqueue('ws-1')).toBe('job-1');

    expect(deps.createJob).toHaveBeenCalledTimes(1);
    expect(deps.updateJob).not.toHaveBeenCalled();
    expect(scheduled).toHaveLength(1);

    scheduled[0]();
    expect(deps.runJob).toHaveBeenCalledWith('job-1', 'ws-1');
    run.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(deps.createJob).toHaveBeenCalledTimes(1);
    expect(deps.logError).not.toHaveBeenCalled();
  });

  it('coalesces repeated enqueue calls into one catch-up job after the running backfill', async () => {
    const scheduled: Array<() => void> = [];
    const firstRun = deferred();
    const secondRun = deferred();
    const runs = [firstRun, secondRun];
    let nextJob = 1;
    const jobs: Job[] = [];

    const deps: LocalSeoLocationBackfillQueueDeps = {
      createJob: vi.fn((_type, opts) => {
        const job = makeJob(`job-${nextJob++}`, opts?.workspaceId ?? 'unknown', opts?.total ?? 0);
        jobs.push(job);
        return job;
      }),
      hasActiveJob: vi.fn(() => undefined),
      updateJob: vi.fn(),
      countSnapshots: vi.fn(() => 226),
      runJob: vi.fn((_jobId, _workspaceId) => runs.shift()!.promise),
      schedule: vi.fn(task => scheduled.push(task)),
      logError: vi.fn(),
    };
    const queue = new LocalSeoLocationBackfillQueue(deps);

    const firstJobId = queue.enqueue('ws-1');
    expect(firstJobId).toBe('job-1');
    expect(deps.createJob).toHaveBeenCalledTimes(1);
    expect(scheduled).toHaveLength(1);

    scheduled[0]();
    expect(deps.runJob).toHaveBeenCalledWith('job-1', 'ws-1');

    expect(queue.enqueue('ws-1')).toBe('job-1');
    expect(queue.enqueue('ws-1')).toBe('job-1');
    expect(queue.enqueue('ws-1')).toBe('job-1');
    expect(deps.createJob).toHaveBeenCalledTimes(1);
    expect(deps.updateJob).toHaveBeenCalledWith('job-1', {
      message: 'Recalculating match history; another location change is queued...',
    });

    firstRun.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(deps.createJob).toHaveBeenCalledTimes(2);
    expect(jobs.map(job => job.id)).toEqual(['job-1', 'job-2']);
    expect(scheduled).toHaveLength(2);

    scheduled[1]();
    expect(deps.runJob).toHaveBeenCalledWith('job-2', 'ws-1');
    secondRun.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(deps.createJob).toHaveBeenCalledTimes(2);
    expect(deps.logError).not.toHaveBeenCalled();
  });

  it('logs the error and marks the job status:error when runJob rejects', async () => {
    const scheduled: Array<() => void> = [];
    const run = deferred();
    let nextJob = 1;

    const deps: LocalSeoLocationBackfillQueueDeps = {
      createJob: vi.fn((_type, opts) => makeJob(`job-${nextJob++}`, opts?.workspaceId ?? 'unknown', opts?.total ?? 0)),
      hasActiveJob: vi.fn(() => undefined),
      updateJob: vi.fn(),
      countSnapshots: vi.fn(() => 10),
      runJob: vi.fn(() => run.promise),
      schedule: vi.fn(task => scheduled.push(task)),
      logError: vi.fn(),
    };
    const queue = new LocalSeoLocationBackfillQueue(deps);

    const jobId = queue.enqueue('ws-err');
    scheduled[0]();

    const boom = new Error('provider timeout');
    run.reject(boom);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(deps.logError).toHaveBeenCalledWith(boom, 'ws-err', jobId);
    expect(deps.updateJob).toHaveBeenCalledWith(jobId, expect.objectContaining({
      status: 'error',
      error: 'provider timeout',
    }));
  });

  it('recovers via hasActiveJob when an in-flight DB job has no in-memory record', async () => {
    const scheduled: Array<() => void> = [];
    const run = deferred();
    let nextJob = 1;

    const orphanJob = makeJob('job-orphan', 'ws-2', 50);

    const deps: LocalSeoLocationBackfillQueueDeps = {
      createJob: vi.fn((_type, opts) => makeJob(`job-${nextJob++}`, opts?.workspaceId ?? 'unknown', opts?.total ?? 0)),
      // Simulates a job that was created by a previous process/restart and is still active in DB.
      hasActiveJob: vi.fn(() => orphanJob),
      updateJob: vi.fn(),
      countSnapshots: vi.fn(() => 50),
      runJob: vi.fn(() => run.promise),
      schedule: vi.fn(task => scheduled.push(task)),
      logError: vi.fn(),
    };
    const queue = new LocalSeoLocationBackfillQueue(deps);

    const returnedId = queue.enqueue('ws-2');

    // Should attach to the DB-recovered job, not create a new one.
    expect(returnedId).toBe('job-orphan');
    expect(deps.createJob).not.toHaveBeenCalled();
    // Should mark a re-run as queued since there's no in-memory started flag.
    expect(deps.updateJob).toHaveBeenCalledWith('job-orphan', expect.objectContaining({
      message: expect.stringContaining('queued'),
    }));
    // No new schedule since we piggy-backed on the DB job.
    expect(scheduled).toHaveLength(0);
  });
});
