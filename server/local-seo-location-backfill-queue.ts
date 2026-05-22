import { BACKGROUND_JOB_TYPES } from '../shared/types/background-jobs.js';
import { countLocalVisibilitySnapshots, runLocationBackfillJob } from './local-seo.js';
import { createJob, hasActiveJob, updateJob, type Job } from './jobs.js';
import { createLogger } from './logger.js';

const log = createLogger('local-seo-location-backfill-queue');
const LOCAL_SEO_LOCATION_BACKFILL_DEBOUNCE_MS = 750;

type ScheduleFn = (task: () => void) => void;

interface ActiveBackfill {
  jobId: string;
  started: boolean;
}

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
  private readonly activeBackfills = new Map<string, ActiveBackfill>();
  private readonly rerunRequested = new Set<string>();
  private readonly deps: LocalSeoLocationBackfillQueueDeps;

  constructor(deps: LocalSeoLocationBackfillQueueDeps) {
    this.deps = deps;
  }

  enqueue(workspaceId: string): string {
    const activeBackfill = this.activeBackfills.get(workspaceId);
    if (activeBackfill) {
      if (activeBackfill.started) {
        this.queueRerun(workspaceId, activeBackfill.jobId);
      }
      return activeBackfill.jobId;
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
    this.activeBackfills.set(workspaceId, { jobId: job.id, started: false });
    this.deps.schedule(() => {
      const activeBackfill = this.activeBackfills.get(workspaceId);
      if (activeBackfill?.jobId === job.id) {
        activeBackfill.started = true;
      }
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
      if (this.activeBackfills.get(workspaceId)?.jobId === job.id) {
        this.activeBackfills.delete(workspaceId);
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
  schedule: task => {
    setTimeout(task, LOCAL_SEO_LOCATION_BACKFILL_DEBOUNCE_MS);
  },
  logError: (err, workspaceId, jobId) => {
    log.error({ err, workspaceId, jobId }, 'runLocationBackfillJob failed');
  },
});

export function enqueueLocationBackfill(workspaceId: string): string {
  return localSeoLocationBackfillQueue.enqueue(workspaceId);
}
