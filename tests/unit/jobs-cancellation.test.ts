import { afterEach, describe, expect, it } from 'vitest';
import {
  cancelJob,
  clearCompletedJobs,
  createJob,
  getJob,
  getJobCancellationError,
  isJobCancelled,
  registerAbort,
  unregisterAbort,
  updateJob,
} from '../../server/jobs.js';
import { BACKGROUND_JOB_TYPES } from '../../shared/types/background-jobs.js';

const workspaceIds = new Set<string>();

describe('job cancellation state', () => {
  afterEach(() => {
    for (const workspaceId of workspaceIds) clearCompletedJobs({ workspaceId });
    workspaceIds.clear();
  });

  it('keeps cancellation observable after the abort controller is unregistered', () => {
    const workspaceId = `ws_cancel_${Date.now()}`;
    workspaceIds.add(workspaceId);
    const job = createJob(BACKGROUND_JOB_TYPES.SCHEMA_GENERATOR, {
      message: 'Generating schemas...',
      workspaceId,
    });
    updateJob(job.id, { status: 'running' });
    const abortController = registerAbort(job.id);

    expect(isJobCancelled(job.id)).toBe(false);

    const cancelled = cancelJob(job.id);

    expect(cancelled?.status).toBe('cancelled');
    expect(abortController.signal.aborted).toBe(true);
    expect(isJobCancelled(job.id)).toBe(true);

    unregisterAbort(job.id);
    expect(isJobCancelled(job.id)).toBe(true);
  });

  it('does not let late progress updates demote a cancelled job back to running', () => {
    const workspaceId = `ws_cancel_progress_${Date.now()}`;
    workspaceIds.add(workspaceId);
    const job = createJob(BACKGROUND_JOB_TYPES.PAGE_ANALYSIS, {
      message: 'Analyzing pages...',
      workspaceId,
    });
    updateJob(job.id, { status: 'running' });
    registerAbort(job.id);

    cancelJob(job.id);
    updateJob(job.id, { status: 'running', progress: 1, message: 'Processed 1 page...' });
    unregisterAbort(job.id);

    expect(getJob(job.id)?.status).toBe('cancelled');
    expect(getJob(job.id)?.message).toBe('Cancelled by user');
    expect(isJobCancelled(job.id)).toBe(true);
  });

  it('reports a cancellation error for non-cancellable active jobs but allows cancellable ones', () => {
    const workspaceId = `ws_cancel_policy_${Date.now()}`;
    workspaceIds.add(workspaceId);

    const recommendationsJob = createJob(BACKGROUND_JOB_TYPES.RECOMMENDATIONS_GENERATION, {
      message: 'Generating recommendations...',
      workspaceId,
    });
    updateJob(recommendationsJob.id, { status: 'running' });

    const localSeoJob = createJob(BACKGROUND_JOB_TYPES.LOCAL_SEO_REFRESH, {
      message: 'Refreshing local SEO...',
      workspaceId,
    });
    updateJob(localSeoJob.id, { status: 'running' });

    expect(getJobCancellationError(recommendationsJob)).toContain('cannot be cancelled');
    expect(getJobCancellationError(localSeoJob)).toBeNull();
  });
});
