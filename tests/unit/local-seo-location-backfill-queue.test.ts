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
});
