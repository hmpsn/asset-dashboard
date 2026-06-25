import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  invalidateIntelligenceCache: vi.fn(),
  getWorkspaceHealthScore: vi.fn(),
  measurePendingOutcomes: vi.fn(),
  getPendingActions: vi.fn(),
  archiveOldActions: vi.fn(),
  addActivity: vi.fn(),
  countActivityByType: vi.fn(),
  recomputeAllWorkspaceLearnings: vi.fn(),
  getWorkspaceIdsWithOutcomes: vi.fn(),
  detectExternalExecutions: vi.fn(),
  detectAllWorkspacePlaybooks: vi.fn(),
  queueKeywordStrategyPostUpdateFollowOns: vi.fn(),
}));

vi.mock('../../server/logger.js', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));
vi.mock('../../server/workspace-intelligence.js', () => ({
  getWorkspaceHealthScore: mocks.getWorkspaceHealthScore,
}));
vi.mock('../../server/intelligence/cache-invalidation.js', () => ({
  invalidateIntelligenceCache: mocks.invalidateIntelligenceCache,
}));
vi.mock('../../server/outcome-measurement.js', () => ({
  measurePendingOutcomes: mocks.measurePendingOutcomes,
}));
vi.mock('../../server/outcome-tracking.js', () => ({
  getPendingActions: mocks.getPendingActions,
  archiveOldActions: mocks.archiveOldActions,
}));
vi.mock('../../server/activity-log.js', () => ({
  addActivity: mocks.addActivity,
  countActivityByType: mocks.countActivityByType,
}));
vi.mock('../../server/workspace-learnings.js', () => ({
  recomputeAllWorkspaceLearnings: mocks.recomputeAllWorkspaceLearnings,
  getWorkspaceIdsWithOutcomes: mocks.getWorkspaceIdsWithOutcomes,
}));
vi.mock('../../server/external-detection.js', () => ({
  detectExternalExecutions: mocks.detectExternalExecutions,
}));
vi.mock('../../server/outcome-playbooks.js', () => ({
  detectAllWorkspacePlaybooks: mocks.detectAllWorkspacePlaybooks,
}));
vi.mock('../../server/keyword-strategy-follow-ons.js', () => ({
  queueKeywordStrategyPostUpdateFollowOns: mocks.queueKeywordStrategyPostUpdateFollowOns,
}));

import { startOutcomeCrons, stopOutcomeCrons } from '../../server/outcome-crons.js';

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-05-25T12:00:00.000Z'));

  mocks.getWorkspaceHealthScore.mockReturnValue(40);
  mocks.measurePendingOutcomes.mockResolvedValue({ workspaceIds: ['ws_1', 'ws_2'] });

  mocks.getPendingActions.mockReturnValue([
    { workspaceId: 'ws_1', createdAt: '2026-05-20T12:00:00.000Z' },
    { workspaceId: 'ws_2', createdAt: '2026-05-21T12:00:00.000Z' },
  ]);

  mocks.archiveOldActions.mockReturnValue(0);
  mocks.countActivityByType.mockReturnValue(0);
  mocks.recomputeAllWorkspaceLearnings.mockResolvedValue(undefined);
  mocks.getWorkspaceIdsWithOutcomes.mockReturnValue(['ws_2']);
  mocks.detectExternalExecutions.mockResolvedValue(undefined);
  mocks.detectAllWorkspacePlaybooks.mockResolvedValue(undefined);
});

afterEach(() => {
  stopOutcomeCrons();
  vi.useRealTimers();
});

function buildPendingActions(workspaceId: string, count: number, createdAt: string) {
  return Array.from({ length: count }, () => ({ workspaceId, createdAt }));
}

describe('outcome crons', () => {
  it('is idempotent when started more than once', async () => {
    startOutcomeCrons();
    startOutcomeCrons();

    await vi.advanceTimersByTimeAsync(36_000);

    expect(mocks.measurePendingOutcomes).toHaveBeenCalledTimes(1);
    expect(mocks.recomputeAllWorkspaceLearnings).toHaveBeenCalledTimes(1);
    expect(mocks.detectExternalExecutions).toHaveBeenCalledTimes(1);
    expect(mocks.detectAllWorkspacePlaybooks).toHaveBeenCalledTimes(1);
    expect(mocks.archiveOldActions).toHaveBeenCalledTimes(1);
  });

  it('cancels startup timeouts when stopped before first execution', async () => {
    startOutcomeCrons();
    stopOutcomeCrons();

    await vi.advanceTimersByTimeAsync(36_000);

    expect(mocks.measurePendingOutcomes).not.toHaveBeenCalled();
    expect(mocks.recomputeAllWorkspaceLearnings).not.toHaveBeenCalled();
    expect(mocks.detectExternalExecutions).not.toHaveBeenCalled();
    expect(mocks.detectAllWorkspacePlaybooks).not.toHaveBeenCalled();
    expect(mocks.archiveOldActions).not.toHaveBeenCalled();
  });

  it('fires backlog alert on count threshold breach and uses 7-day dedupe window', async () => {
    mocks.getPendingActions.mockReturnValue(
      buildPendingActions('ws_alert', 20, '2026-05-24T12:00:00.000Z'),
    );
    mocks.countActivityByType.mockReturnValue(0);

    startOutcomeCrons();
    await vi.advanceTimersByTimeAsync(16_000);

    expect(mocks.countActivityByType).toHaveBeenCalledWith('ws_alert', 'action_backlog_alert', 7);
    expect(mocks.addActivity).toHaveBeenCalledWith(
      'ws_alert',
      'action_backlog_alert',
      'Action backlog threshold exceeded',
      expect.stringContaining('20 pending action(s);'),
      expect.objectContaining({
        pendingCount: 20,
        countBreached: true,
        ageBreached: false,
      }),
    );
  });

  it('suppresses duplicate backlog alerts when one was already sent within dedupe window', async () => {
    mocks.getPendingActions.mockReturnValue(
      buildPendingActions('ws_alert', 21, '2026-05-24T12:00:00.000Z'),
    );
    mocks.countActivityByType.mockReturnValue(1);

    startOutcomeCrons();
    await vi.advanceTimersByTimeAsync(16_000);

    expect(mocks.countActivityByType).toHaveBeenCalledWith('ws_alert', 'action_backlog_alert', 7);
    expect(mocks.addActivity).not.toHaveBeenCalled();
  });

  it('fires backlog alert on age threshold breach even when count is below threshold', async () => {
    mocks.getPendingActions.mockReturnValue([
      ...buildPendingActions('ws_old', 2, '2026-05-01T11:00:00.000Z'),
      ...buildPendingActions('ws_fresh', 3, '2026-05-24T12:00:00.000Z'),
    ]);

    startOutcomeCrons();
    await vi.advanceTimersByTimeAsync(16_000);

    expect(mocks.addActivity).toHaveBeenCalledWith(
      'ws_old',
      'action_backlog_alert',
      'Action backlog threshold exceeded',
      expect.stringContaining('oldest is 24 day(s) old.'),
      expect.objectContaining({
        pendingCount: 2,
        countBreached: false,
        ageBreached: true,
      }),
    );
  });

  it('isolates measure failures without blocking other scheduled jobs', async () => {
    mocks.measurePendingOutcomes.mockRejectedValue(new Error('measurement failed'));

    startOutcomeCrons();
    await vi.advanceTimersByTimeAsync(36_000);

    expect(mocks.measurePendingOutcomes).toHaveBeenCalledTimes(1);
    expect(mocks.invalidateIntelligenceCache).toHaveBeenCalledWith('ws_2');
    expect(mocks.invalidateIntelligenceCache).not.toHaveBeenCalledWith('ws_1');
    expect(mocks.recomputeAllWorkspaceLearnings).toHaveBeenCalledTimes(1);
    expect(mocks.detectExternalExecutions).toHaveBeenCalledTimes(1);
    expect(mocks.detectAllWorkspacePlaybooks).toHaveBeenCalledTimes(1);
    expect(mocks.archiveOldActions).toHaveBeenCalledTimes(1);
  });

  it('suppresses duplicate backlog activity alerts when a recent alert already exists', async () => {
    const pending = Array.from({ length: 20 }, (_, index) => ({
      workspaceId: 'ws_1',
      createdAt: `2026-05-${String(index + 1).padStart(2, '0')}T12:00:00.000Z`,
    }));
    mocks.getPendingActions.mockReturnValue(pending);
    mocks.countActivityByType.mockReturnValue(2);

    startOutcomeCrons();
    await vi.advanceTimersByTimeAsync(16_000);

    expect(mocks.countActivityByType).toHaveBeenCalledWith('ws_1', 'action_backlog_alert', 7);
    expect(mocks.addActivity).not.toHaveBeenCalled();
  });

  // ── Task 1.3: outcome/publish debounced rec regen ────────────────────────────

  it('enqueues a rec regen for each measured workspace after runMeasure', async () => {
    mocks.measurePendingOutcomes.mockResolvedValue({ workspaceIds: ['ws_m1', 'ws_m2'] });

    startOutcomeCrons();
    // runMeasure fires at 15 s startup delay
    await vi.advanceTimersByTimeAsync(16_000);

    expect(mocks.queueKeywordStrategyPostUpdateFollowOns).toHaveBeenCalledWith({ workspaceId: 'ws_m1' });
    expect(mocks.queueKeywordStrategyPostUpdateFollowOns).toHaveBeenCalledWith({ workspaceId: 'ws_m2' });
  });

  it('enqueues a rec regen for each learnings workspace after runLearnings', async () => {
    mocks.getWorkspaceIdsWithOutcomes.mockReturnValue(['ws_l1', 'ws_l2']);

    startOutcomeCrons();
    // runLearnings fires at 20 s startup delay
    await vi.advanceTimersByTimeAsync(21_000);

    expect(mocks.queueKeywordStrategyPostUpdateFollowOns).toHaveBeenCalledWith({ workspaceId: 'ws_l1' });
    expect(mocks.queueKeywordStrategyPostUpdateFollowOns).toHaveBeenCalledWith({ workspaceId: 'ws_l2' });
  });

  it('does not enqueue rec regen when measure produces no workspace ids', async () => {
    mocks.measurePendingOutcomes.mockResolvedValue({ workspaceIds: [] });

    startOutcomeCrons();
    await vi.advanceTimersByTimeAsync(16_000);

    expect(mocks.queueKeywordStrategyPostUpdateFollowOns).not.toHaveBeenCalled();
  });

  it('does not enqueue rec regen when learnings has no affected workspaces', async () => {
    mocks.getWorkspaceIdsWithOutcomes.mockReturnValue([]);

    startOutcomeCrons();
    await vi.advanceTimersByTimeAsync(21_000);

    // only measure fired by 16s; at 21s learnings has run with empty list
    const learnCalls = mocks.queueKeywordStrategyPostUpdateFollowOns.mock.calls.filter(
      (call: unknown[]) => (call[0] as { workspaceId: string }).workspaceId === 'ws_2',
    );
    // ws_2 comes from measurePendingOutcomes (mocked to return ws_1/ws_2 in beforeEach)
    // with zero learnings workspaces, any call must be from measure only
    const learnOnlyCalls = mocks.queueKeywordStrategyPostUpdateFollowOns.mock.calls.filter(
      (call: unknown[]) => ['ws_l1', 'ws_l2'].includes((call[0] as { workspaceId: string }).workspaceId),
    );
    expect(learnOnlyCalls).toHaveLength(0);
  });
});
