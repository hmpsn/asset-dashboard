import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  isFeatureEnabled: vi.fn(),
  invalidateIntelligenceCache: vi.fn(),
  measurePendingOutcomes: vi.fn(),
  getPendingActions: vi.fn(),
  archiveOldActions: vi.fn(),
  addActivity: vi.fn(),
  countActivityByType: vi.fn(),
  recomputeAllWorkspaceLearnings: vi.fn(),
  getWorkspaceIdsWithOutcomes: vi.fn(),
  detectExternalExecutions: vi.fn(),
  detectAllWorkspacePlaybooks: vi.fn(),
}));

vi.mock('../../server/logger.js', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));
vi.mock('../../server/feature-flags.js', () => ({ isFeatureEnabled: mocks.isFeatureEnabled }));
vi.mock('../../server/workspace-intelligence.js', () => ({
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

import { startOutcomeCrons, stopOutcomeCrons } from '../../server/outcome-crons.js';

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-05-25T12:00:00.000Z'));
  mocks.isFeatureEnabled.mockImplementation((flag: string) => (
    flag === 'outcome-tracking' ||
    flag === 'outcome-external-detection' ||
    flag === 'outcome-playbooks'
  ));
  mocks.measurePendingOutcomes.mockResolvedValue({ workspaceIds: ['ws_1', 'ws_2'] });
  mocks.getPendingActions.mockReturnValue([
    { workspaceId: 'ws_1', createdAt: '2026-05-01T12:00:00.000Z' },
    { workspaceId: 'ws_1', createdAt: '2026-05-02T12:00:00.000Z' },
  ]);
  mocks.countActivityByType.mockReturnValue(0);
  mocks.recomputeAllWorkspaceLearnings.mockResolvedValue(undefined);
  mocks.getWorkspaceIdsWithOutcomes.mockReturnValue(['ws_2']);
  mocks.detectExternalExecutions.mockResolvedValue(undefined);
  mocks.detectAllWorkspacePlaybooks.mockResolvedValue(undefined);
  mocks.archiveOldActions.mockReturnValue(0);
});

afterEach(() => {
  stopOutcomeCrons();
  vi.useRealTimers();
});

describe('outcome crons', () => {
  it('does not register jobs when outcome tracking is disabled', async () => {
    mocks.isFeatureEnabled.mockImplementation((flag: string) => flag !== 'outcome-tracking');

    startOutcomeCrons();
    await vi.advanceTimersByTimeAsync(36_000);

    expect(mocks.measurePendingOutcomes).not.toHaveBeenCalled();
    expect(mocks.recomputeAllWorkspaceLearnings).not.toHaveBeenCalled();
    expect(mocks.detectExternalExecutions).not.toHaveBeenCalled();
    expect(mocks.archiveOldActions).not.toHaveBeenCalled();
  });

  it('runs startup jobs and invalidates cache for measured and learning workspaces', async () => {
    startOutcomeCrons();
    await vi.advanceTimersByTimeAsync(36_000);

    expect(mocks.measurePendingOutcomes).toHaveBeenCalledTimes(1);
    expect(mocks.invalidateIntelligenceCache).toHaveBeenCalledWith('ws_1');
    expect(mocks.invalidateIntelligenceCache).toHaveBeenCalledWith('ws_2');
    expect(mocks.recomputeAllWorkspaceLearnings).toHaveBeenCalledTimes(1);
    expect(mocks.detectExternalExecutions).toHaveBeenCalledTimes(1);
    expect(mocks.detectAllWorkspacePlaybooks).toHaveBeenCalledTimes(1);
    expect(mocks.archiveOldActions).toHaveBeenCalledTimes(1);
  });

  it('stops timers and prevents scheduled reruns after stop', async () => {
    startOutcomeCrons();
    await vi.advanceTimersByTimeAsync(36_000);
    const measureCallsAfterStartup = mocks.measurePendingOutcomes.mock.calls.length;

    stopOutcomeCrons();
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);

    expect(mocks.measurePendingOutcomes).toHaveBeenCalledTimes(measureCallsAfterStartup);
  });
});
