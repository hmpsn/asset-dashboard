import { describe, expect, it, vi } from 'vitest';
import {
  attachTrackedJob,
  cancelTrackedJob,
  invalidateQueriesOnJobCompletion,
  startAndTrackJob,
} from '../../src/lib/background-job-helpers';
import { BACKGROUND_JOB_TYPES } from '../../shared/types/background-jobs';

describe('background-job-helpers', () => {
  it('startAndTrackJob starts a job and tracks it', async () => {
    const startJob = vi.fn(async () => 'job-1');
    const trackJob = vi.fn();
    const cancelJob = vi.fn();

    const jobId = await startAndTrackJob(
      { startJob, trackJob, cancelJob },
      BACKGROUND_JOB_TYPES.SEO_BULK_REWRITE,
      { workspaceId: 'ws-1' },
    );

    expect(jobId).toBe('job-1');
    expect(startJob).toHaveBeenCalledTimes(1);
    expect(trackJob).toHaveBeenCalledWith(BACKGROUND_JOB_TYPES.SEO_BULK_REWRITE, 'job-1', { workspaceId: 'ws-1' });
  });

  it('startAndTrackJob handles existing-job attachment flow (409 path) by tracking returned id', async () => {
    const startJob = vi.fn(async () => 'job-existing');
    const trackJob = vi.fn();

    const jobId = await startAndTrackJob(
      { startJob, trackJob, cancelJob: vi.fn() },
      BACKGROUND_JOB_TYPES.BULK_SEO_FIX,
      { workspaceId: 'ws-1' },
    );
    expect(jobId).toBe('job-existing');
    expect(trackJob).toHaveBeenCalledWith(BACKGROUND_JOB_TYPES.BULK_SEO_FIX, 'job-existing', { workspaceId: 'ws-1' });
  });

  it('attachTrackedJob tracks known job ids', () => {
    const trackJob = vi.fn();
    attachTrackedJob(
      { trackJob },
      BACKGROUND_JOB_TYPES.CONTENT_POST_GENERATION,
      'job-2',
      { workspaceId: 'ws-2' },
    );
    expect(trackJob).toHaveBeenCalledWith(BACKGROUND_JOB_TYPES.CONTENT_POST_GENERATION, 'job-2', { workspaceId: 'ws-2' });
  });

  it('cancelTrackedJob calls cancel when a job id exists', async () => {
    const cancelJob = vi.fn(async () => undefined);
    await cancelTrackedJob({ cancelJob }, 'job-3');
    expect(cancelJob).toHaveBeenCalledWith('job-3');
  });

  it('invalidateQueriesOnJobCompletion invalidates every provided query key', () => {
    const queryClient = {
      invalidateQueries: vi.fn(),
    };
    invalidateQueriesOnJobCompletion(
      queryClient as unknown as { invalidateQueries: (opts: { queryKey: readonly unknown[] }) => void },
      [['admin', 'a'], ['admin', 'b']],
    );
    expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(2);
  });
});
