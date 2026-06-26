import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Response } from 'express';
import { BACKGROUND_JOB_TYPES } from '../../shared/types/background-jobs.js';

const mocks = vi.hoisted(() => {
  class MockCreditBudgetError extends Error {
    readonly code = 'credit_budget_exceeded' as const;
    readonly tier: string;
    readonly endpoint: string;

    constructor(tier: string, endpoint: string, message: string) {
      super(message);
      this.name = 'CreditBudgetError';
      this.tier = tier;
      this.endpoint = endpoint;
    }
  }

  return {
    assertCreditBudget: vi.fn(),
    CreditBudgetError: MockCreditBudgetError,
    isFeatureEnabled: vi.fn(),
    createJob: vi.fn(),
    getJob: vi.fn(),
    hasActiveJob: vi.fn(),
    registerAbort: vi.fn(),
    updateJob: vi.fn(),
    getWorkspace: vi.fn(),
    computeEffectiveTier: vi.fn(),
  };
});

vi.mock('../../server/credit-budget-gate.js', () => ({
  assertCreditBudget: mocks.assertCreditBudget,
  CreditBudgetError: mocks.CreditBudgetError,
}));
vi.mock('../../server/feature-flags.js', () => ({
  isFeatureEnabled: mocks.isFeatureEnabled,
}));
vi.mock('../../server/jobs.js', () => ({
  createJob: mocks.createJob,
  getJob: mocks.getJob,
  hasActiveJob: mocks.hasActiveJob,
  registerAbort: mocks.registerAbort,
  updateJob: mocks.updateJob,
}));
vi.mock('../../server/workspaces.js', () => ({
  getWorkspace: mocks.getWorkspace,
  computeEffectiveTier: mocks.computeEffectiveTier,
}));

import { startTrackedRefresh } from '../../server/seo-refresh-runtime.js';
import { isRefreshJobCancelled, waitForHeapHeadroom } from '../../server/seo-refresh-runner-runtime.js';

function makeResponse(): Response {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  return res as unknown as Response;
}

const logger = {
  warn: vi.fn(),
  error: vi.fn(),
};

function start(overrides: Partial<Parameters<typeof startTrackedRefresh>[0]> = {}) {
  const res = overrides.res ?? makeResponse();
  const run = overrides.run ?? vi.fn(async () => {});
  startTrackedRefresh({
    workspaceId: 'ws_1',
    res,
    logger,
    jobType: BACKGROUND_JOB_TYPES.NATIONAL_SERP_REFRESH,
    preparingMessage: 'Preparing refresh...',
    workspaceConflictError: 'Workspace refresh already running',
    globalConflictError: 'Another workspace is refreshing',
    unexpectedFailureLogMessage: 'refresh failed unexpectedly',
    unexpectedFailureMessage: 'Refresh failed unexpectedly',
    run,
    ...overrides,
  });
  return { res, run };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isFeatureEnabled.mockReturnValue(true);
  mocks.getWorkspace.mockReturnValue({ id: 'ws_1' });
  mocks.computeEffectiveTier.mockReturnValue('growth');
  mocks.hasActiveJob.mockReturnValue(null);
  mocks.getJob.mockReturnValue(null);
  mocks.createJob.mockReturnValue({ id: 'job_1' });
});

describe('seo-refresh-runtime', () => {
  it('returns 404 before workspace or job work when the feature flag is off', () => {
    mocks.isFeatureEnabled.mockReturnValue(false);

    const { res } = start({
      featureGate: { flag: 'national-serp-tracking', disabledError: 'National SERP tracking is not enabled' },
    });

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'National SERP tracking is not enabled' });
    expect(mocks.getWorkspace).not.toHaveBeenCalled();
    expect(mocks.createJob).not.toHaveBeenCalled();
  });

  it('returns 403 for non Growth/Premium workspaces before creating a job', () => {
    mocks.computeEffectiveTier.mockReturnValue('free');

    const { res } = start({
      tierGate: { forbiddenError: 'Requires Growth or Premium' },
    });

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'Requires Growth or Premium' });
    expect(mocks.createJob).not.toHaveBeenCalled();
  });

  it('logs observe-only credit budget would-blocks and still starts the job', () => {
    mocks.assertCreditBudget.mockImplementation(() => {
      throw new mocks.CreditBudgetError('growth', 'national_serp', 'budget reached');
    });

    const { res, run } = start({
      tierGate: { forbiddenError: 'Requires Growth or Premium' },
      budgetGate: {
        endpoint: 'national_serp',
        wouldBlockLogMessage: 'budget would-block',
      },
    });

    expect(logger.warn).toHaveBeenCalledWith({ workspaceId: 'ws_1', tier: 'growth' }, 'budget would-block');
    expect(mocks.createJob).toHaveBeenCalledWith(BACKGROUND_JOB_TYPES.NATIONAL_SERP_REFRESH, {
      workspaceId: 'ws_1',
      total: undefined,
      message: 'Preparing refresh...',
    });
    expect(mocks.registerAbort).toHaveBeenCalledWith('job_1');
    expect(res.json).toHaveBeenCalledWith({ jobId: 'job_1' });
    expect(run).toHaveBeenCalledWith('job_1');
  });

  it('returns per-workspace and global active-job conflicts before preparing a new job', () => {
    mocks.hasActiveJob.mockReturnValueOnce({ id: 'active_ws' });
    const workspaceConflict = start();
    expect(workspaceConflict.res.status).toHaveBeenCalledWith(409);
    expect(workspaceConflict.res.json).toHaveBeenCalledWith({
      error: 'Workspace refresh already running',
      jobId: 'active_ws',
    });

    vi.clearAllMocks();
    mocks.hasActiveJob
      .mockReturnValueOnce(null)
      .mockReturnValueOnce({ id: 'active_global', workspaceId: 'other_ws' });
    const globalConflict = start();
    expect(globalConflict.res.status).toHaveBeenCalledWith(409);
    expect(globalConflict.res.json).toHaveBeenCalledWith({
      error: 'Another workspace is refreshing',
      jobId: 'active_global',
      blockingWorkspaceId: 'other_ws',
    });
    expect(mocks.createJob).not.toHaveBeenCalled();
  });

  it('uses prepare output for job total and response extras', () => {
    const { res } = start({
      prepare: () => ({
        total: 12,
        response: { selectedKeywordCount: 4, selectedMarketCount: 3 },
      }),
    });

    expect(mocks.createJob).toHaveBeenCalledWith(BACKGROUND_JOB_TYPES.NATIONAL_SERP_REFRESH, {
      workspaceId: 'ws_1',
      total: 12,
      message: 'Preparing refresh...',
    });
    expect(res.json).toHaveBeenCalledWith({
      jobId: 'job_1',
      selectedKeywordCount: 4,
      selectedMarketCount: 3,
    });
  });

  it('marks the job failed when the detached runner rejects', async () => {
    const err = new Error('provider down');
    start({ run: vi.fn(async () => { throw err; }) });
    await Promise.resolve();

    expect(logger.error).toHaveBeenCalledWith(
      { err, jobId: 'job_1', workspaceId: 'ws_1' },
      'refresh failed unexpectedly',
    );
    expect(mocks.updateJob).toHaveBeenCalledWith('job_1', {
      status: 'error',
      error: 'provider down',
      message: 'Refresh failed unexpectedly',
    });
  });

  it('waits and logs while heap usage is above the configured refresh threshold', async () => {
    vi.useFakeTimers();
    const memoryUsage = vi.spyOn(process, 'memoryUsage');
    memoryUsage
      .mockReturnValueOnce({ heapUsed: 400 * 1024 * 1024 } as NodeJS.MemoryUsage)
      .mockReturnValueOnce({ heapUsed: 100 * 1024 * 1024 } as NodeJS.MemoryUsage);

    const wait = waitForHeapHeadroom({
      thresholdMb: 320,
      waitMs: 250,
      maxWaits: 8,
      logger,
      logMessage: 'heap high',
    });
    await vi.advanceTimersByTimeAsync(250);
    await wait;

    expect(logger.warn).toHaveBeenCalledWith(
      { heapMb: 400, thresholdMb: 320, attempt: 1 },
      'heap high',
    );
    memoryUsage.mockRestore();
    vi.useRealTimers();
  });

  it('reads cancellation state through the jobs runtime', () => {
    mocks.getJob.mockReturnValueOnce({ id: 'job_1', status: 'cancelled' });
    expect(isRefreshJobCancelled('job_1')).toBe(true);

    mocks.getJob.mockReturnValueOnce({ id: 'job_2', status: 'running' });
    expect(isRefreshJobCancelled('job_2')).toBe(false);
  });
});
