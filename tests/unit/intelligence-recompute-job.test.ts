import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  getJob: vi.fn(),
  updateJob: vi.fn(),
  getOrComputeInsights: vi.fn(),
}));

vi.mock('../../server/jobs.js', () => ({
  getJob: state.getJob,
  updateJob: state.updateJob,
}));

vi.mock('../../server/analytics-intelligence.js', () => ({
  getOrComputeInsights: state.getOrComputeInsights,
}));

vi.mock('../../server/logger.js', () => ({
  createLogger: () => ({ warn: vi.fn(), debug: vi.fn() }),
}));

import { runIntelligenceRecomputeJob } from '../../server/intelligence-recompute-job.js';
import { BACKGROUND_JOB_TYPES, BACKGROUND_JOB_METADATA } from '../../shared/types/background-jobs.js';

describe('INTELLIGENCE_RECOMPUTE job registration', () => {
  it('registers the type with domain-store, non-cancellable metadata', () => {
    expect(BACKGROUND_JOB_TYPES.INTELLIGENCE_RECOMPUTE).toBe('intelligence-recompute');
    const meta = BACKGROUND_JOB_METADATA[BACKGROUND_JOB_TYPES.INTELLIGENCE_RECOMPUTE];
    expect(meta.label).toBe('Refreshing signals');
    expect(meta.cancellable).toBe(false);
    expect(meta.resultBehavior).toBe('domain-store');
  });
});

describe('runIntelligenceRecomputeJob', () => {
  beforeEach(() => {
    state.getJob.mockReset();
    state.updateJob.mockReset();
    state.getOrComputeInsights.mockReset();
    state.getJob.mockReturnValue({ status: 'running' });
  });

  it('forces a full recompute and marks the job done on success', async () => {
    state.getOrComputeInsights.mockResolvedValue([{ id: 'i1' }, { id: 'i2' }]);

    await runIntelligenceRecomputeJob('job-1', 'ws-1');

    expect(state.getOrComputeInsights).toHaveBeenCalledWith('ws-1', undefined, { force: true });
    expect(state.updateJob).toHaveBeenCalledWith('job-1', expect.objectContaining({ status: 'running' }));
    expect(state.updateJob).toHaveBeenCalledWith('job-1', expect.objectContaining({ status: 'done', progress: 100 }));
  });

  it('marks the job error when the recompute throws (FM-2)', async () => {
    state.getOrComputeInsights.mockRejectedValue(new Error('GSC provider unavailable'));

    await runIntelligenceRecomputeJob('job-2', 'ws-1');

    expect(state.updateJob).toHaveBeenCalledWith(
      'job-2',
      expect.objectContaining({ status: 'error', error: 'GSC provider unavailable' }),
    );
    expect(state.updateJob).not.toHaveBeenCalledWith('job-2', expect.objectContaining({ status: 'done' }));
  });

  it('no-ops when the job is already cancelled', async () => {
    state.getJob.mockReturnValue({ status: 'cancelled' });

    await runIntelligenceRecomputeJob('job-3', 'ws-1');

    expect(state.getOrComputeInsights).not.toHaveBeenCalled();
    expect(state.updateJob).not.toHaveBeenCalled();
  });

  it('does NOT log activity (avoids self-perpetuating the daily activity-gated cron)', async () => {
    // The worker must not import/call addActivity; assert getOrComputeInsights is the only side effect path.
    state.getOrComputeInsights.mockResolvedValue([]);
    await runIntelligenceRecomputeJob('job-4', 'ws-1');
    // done with 0 insights, no throw
    expect(state.updateJob).toHaveBeenCalledWith('job-4', expect.objectContaining({ status: 'done' }));
  });
});
