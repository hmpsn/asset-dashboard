import { BACKGROUND_JOB_TYPES } from '../shared/types/background-jobs.js';
import { countLocalVisibilitySnapshots, runLocationBackfillJob } from './local-seo.js';
import { createJob, hasActiveJob, updateJob, type Job } from './jobs.js';
import { createLogger } from './logger.js';

const log = createLogger('local-seo-location-backfill-queue');

type ScheduleFn = (task: () => void) => void;

export interface LocalSeoLocationBackfillQueueDeps {
  createJob: typeof createJob;
  hasActiveJob: typeof hasActiveJob;
  updateJob: typeof updateJob;
  countSnapshots: typeof countLocalVisibilitySnapshots;
  runJob: typeof runLocationBackfillJob;
  schedule: ScheduleFn;
  logError: (err: unknown, workspaceId: string, jobId: string) => void;
}

export class LocalSeoLocationBackfillQueue {
  private readonly runningJobIds = new Map<string, string>();
  private readonly rerunRequested = new Set<string>();
  private readonly deps: LocalSeoLocationBackfillQueueDeps;

  constructor(deps: LocalSeoLocationBackfillQueueDeps) {
    this.deps = deps;
  }

  enqueue(workspaceId: string): string {
    const runningJobId = this.runningJobIds.get(workspaceId);
    if (runningJobId) {
      this.queueRerun(workspaceId, runningJobId);
      return runningJobId;
    }

    const activeJob = this.deps.hasActiveJob(BACKGROUND_JOB_TYPES.LOCAL_SEO_LOCATION_BACKFILL, workspaceId);
    if (activeJob) {
      this.queueRerun(workspaceId, activeJob.id);
      return activeJob.id;
    }

    return this.start(workspaceId);
  }

  private queueRerun(workspaceId: string, activeJobId: string): void {
    this.rerunRequested.add(workspaceId);
    this.deps.updateJob(activeJobId, {
      message: 'Recalculating match history; another location change is queued...',
    });
  }

  private start(workspaceId: string): string {
    const total = this.deps.countSnapshots(workspaceId);
    const job = this.deps.createJob(BACKGROUND_JOB_TYPES.LOCAL_SEO_LOCATION_BACKFILL, {
      workspaceId,
      total,
      message: 'Preparing local match history recalculation...',
    });
    this.runningJobIds.set(workspaceId, job.id);
    this.deps.schedule(() => {
      void this.runAndDrain(workspaceId, job);
    });
    return job.id;
  }

  private async runAndDrain(workspaceId: string, job: Job): Promise<void> {
    try {
      await this.deps.runJob(job.id, workspaceId);
    } catch (err) {
      this.deps.logError(err, workspaceId, job.id);
      this.deps.updateJob(job.id, {
        status: 'error',
        message: 'Local match history recalculation failed',
        error: err instanceof Error ? err.message : 'Local match history recalculation failed',
      });
    } finally {
      if (this.runningJobIds.get(workspaceId) === job.id) {
        this.runningJobIds.delete(workspaceId);
      }

      if (this.rerunRequested.delete(workspaceId)) {
        this.start(workspaceId);
      }
    }
  }
}

export const localSeoLocationBackfillQueue = new LocalSeoLocationBackfillQueue({
  createJob,
  hasActiveJob,
  updateJob,
  countSnapshots: countLocalVisibilitySnapshots,
  runJob: runLocationBackfillJob,
  schedule: task => setImmediate(task),
  logError: (err, workspaceId, jobId) => {
    log.error({ err, workspaceId, jobId }, 'runLocationBackfillJob failed');
  },
});

export function enqueueLocationBackfill(workspaceId: string): string {
  return localSeoLocationBackfillQueue.enqueue(workspaceId);
}
