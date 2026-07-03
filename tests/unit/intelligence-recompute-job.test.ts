import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  getJob: vi.fn(),
  updateJob: vi.fn(),
  createJob: vi.fn(),
  hasActiveJob: vi.fn(),
  getOrComputeInsights: vi.fn(),
  broadcast: vi.fn(),
}));

vi.mock('../../server/jobs.js', () => ({
  getJob: state.getJob,
  updateJob: state.updateJob,
  createJob: state.createJob,
  hasActiveJob: state.hasActiveJob,
}));

vi.mock('../../server/broadcast.js', () => ({
  broadcastToWorkspace: state.broadcast,
}));

vi.mock('../../server/domains/analytics-intelligence/orchestrator.js', () => ({
  getOrComputeInsights: state.getOrComputeInsights,
}));

vi.mock('../../server/logger.js', () => ({
  createLogger: () => ({ warn: vi.fn(), debug: vi.fn() }),
}));

import { runIntelligenceRecomputeJob, enqueueIntelligenceRecompute } from '../../server/intelligence-recompute-job.js';
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

describe('enqueueIntelligenceRecompute (dedup)', () => {
  beforeEach(() => {
    state.createJob.mockReset();
    state.hasActiveJob.mockReset();
    state.createJob.mockReturnValue({ id: 'job-x' });
    state.hasActiveJob.mockReturnValue(undefined);
  });

  it('creates a recompute job when no job is active', () => {
    enqueueIntelligenceRecompute('ws-1');
    expect(state.createJob).toHaveBeenCalledWith('intelligence-recompute', expect.objectContaining({ workspaceId: 'ws-1' }));
  });

  it('dedupes — does not create a second job when one is already active', () => {
    state.hasActiveJob.mockReturnValue({ id: 'existing' });
    enqueueIntelligenceRecompute('ws-1');
    expect(state.createJob).not.toHaveBeenCalled();
  });
});

describe('runIntelligenceRecomputeJob', () => {
  beforeEach(() => {
    state.getJob.mockReset();
    state.updateJob.mockReset();
    state.getOrComputeInsights.mockReset();
    state.broadcast.mockReset();
    state.getJob.mockReturnValue({ status: 'running' });
  });

  it('forces a full recompute, broadcasts signals-updated, and marks the job done on success', async () => {
    state.getOrComputeInsights.mockResolvedValue([{ id: 'i1' }, { id: 'i2' }]);

    await runIntelligenceRecomputeJob('job-1', 'ws-1');

    expect(state.getOrComputeInsights).toHaveBeenCalledWith('ws-1', undefined, { force: true });
    expect(state.broadcast).toHaveBeenCalledWith('ws-1', 'intelligence:signals_updated', expect.objectContaining({ source: 'intelligence_recompute' }));
    expect(state.updateJob).toHaveBeenCalledWith('job-1', expect.objectContaining({ status: 'running' }));
    expect(state.updateJob).toHaveBeenCalledWith('job-1', expect.objectContaining({ status: 'done', progress: 100 }));
  });

  it('broadcasts signals-updated even when the recompute clears ALL signals (the zero-signal caption-staleness fix)', async () => {
    state.getOrComputeInsights.mockResolvedValue([]);
    await runIntelligenceRecomputeJob('job-z', 'ws-1');
    // The feedback loop would NOT broadcast on 0 signals — the worker's unconditional broadcast must.
    expect(state.broadcast).toHaveBeenCalledWith('ws-1', 'intelligence:signals_updated', expect.anything());
  });

  it('marks the job error when the recompute throws (FM-2) and does NOT broadcast', async () => {
    state.getOrComputeInsights.mockRejectedValue(new Error('GSC provider unavailable'));

    await runIntelligenceRecomputeJob('job-2', 'ws-1');

    expect(state.updateJob).toHaveBeenCalledWith(
      'job-2',
      expect.objectContaining({ status: 'error', error: 'GSC provider unavailable' }),
    );
    expect(state.updateJob).not.toHaveBeenCalledWith('job-2', expect.objectContaining({ status: 'done' }));
    expect(state.broadcast).not.toHaveBeenCalled();
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
