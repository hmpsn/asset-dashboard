import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrackedAction } from '../../shared/types/outcome-tracking.js';

const mocks = vi.hoisted(() => ({
  getNotActedOnActions: vi.fn(),
  updateAttribution: vi.fn(),
  updateActionContext: vi.fn(),
  fetchGscSnapshot: vi.fn(),
  broadcastToWorkspace: vi.fn(),
}));

vi.mock('../../server/logger.js', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));
vi.mock('../../server/outcome-tracking.js', () => ({
  getNotActedOnActions: mocks.getNotActedOnActions,
  updateAttribution: mocks.updateAttribution,
  updateActionContext: mocks.updateActionContext,
}));
vi.mock('../../server/outcome-measurement.js', () => ({
  fetchGscSnapshot: mocks.fetchGscSnapshot,
}));
vi.mock('../../server/broadcast.js', () => ({
  broadcastToWorkspace: mocks.broadcastToWorkspace,
}));
vi.mock('../../server/ws-events.js', () => ({
  WS_EVENTS: { OUTCOME_EXTERNAL_DETECTED: 'outcome:external_detected' },
}));

function makeAction(overrides: Partial<TrackedAction> = {}): TrackedAction {
  return {
    id: 'act-1',
    workspaceId: 'ws-1',
    actionType: 'meta_updated',
    sourceType: 'insight',
    sourceId: 'ins-1',
    pageUrl: 'https://example.com/page-a',
    targetKeyword: null,
    baselineSnapshot: {
      captured_at: '2026-05-01T00:00:00.000Z',
      clicks: 10,
      position: 12,
    },
    trailingHistory: { metric: 'clicks', dataPoints: [] },
    attribution: 'not_acted_on',
    measurementWindow: 30,
    measurementComplete: false,
    sourceFlag: 'live',
    baselineConfidence: 'exact',
    context: {},
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('external-detection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getNotActedOnActions.mockReturnValue([]);
    mocks.fetchGscSnapshot.mockResolvedValue({ captured_at: '2026-05-25T00:00:00.000Z', clicks: 20, position: 8 });
  });

  it('returns checked/detected counts when no actions are eligible', async () => {
    const { detectExternalExecutions } = await import('../../server/external-detection.js');
    const result = await detectExternalExecutions();
    expect(result).toEqual({ detected: 0, checked: 0 });
  });

  it('increments detectionChecks on first positive execution signal', async () => {
    const action = makeAction({ context: {} });
    mocks.getNotActedOnActions.mockReturnValue([action]);

    const { detectExternalExecutions } = await import('../../server/external-detection.js');
    const result = await detectExternalExecutions();

    expect(result).toEqual({ detected: 0, checked: 1 });
    expect(mocks.updateActionContext).toHaveBeenCalledWith('act-1', 'ws-1', expect.objectContaining({ detectionChecks: 1 }));
    expect(mocks.updateAttribution).not.toHaveBeenCalled();
    expect(mocks.broadcastToWorkspace).not.toHaveBeenCalled();
  });

  it('marks externally_executed on second consecutive positive check', async () => {
    const action = makeAction({ context: { detectionChecks: 1 } });
    mocks.getNotActedOnActions.mockReturnValue([action]);

    const { detectExternalExecutions } = await import('../../server/external-detection.js');
    const result = await detectExternalExecutions();

    expect(result).toEqual({ detected: 1, checked: 1 });
    expect(mocks.updateAttribution).toHaveBeenCalledWith('act-1', 'ws-1', 'externally_executed');
    expect(mocks.broadcastToWorkspace).toHaveBeenCalledWith('ws-1', 'outcome:external_detected', { actionId: 'act-1' });
    expect(mocks.updateActionContext).not.toHaveBeenCalled();
  });

  it('resets detectionChecks when signal disappears after prior positive checks', async () => {
    const action = makeAction({ context: { detectionChecks: 2 } });
    mocks.getNotActedOnActions.mockReturnValue([action]);
    mocks.fetchGscSnapshot.mockResolvedValue({ captured_at: '2026-05-25T00:00:00.000Z', clicks: 9, position: 12 });

    const { detectExternalExecutions } = await import('../../server/external-detection.js');
    const result = await detectExternalExecutions();

    expect(result).toEqual({ detected: 0, checked: 1 });
    expect(mocks.updateActionContext).toHaveBeenCalledWith('act-1', 'ws-1', expect.objectContaining({ detectionChecks: 0 }));
    expect(mocks.updateAttribution).not.toHaveBeenCalled();
  });

  it('isolates per-action errors and keeps processing remaining actions', async () => {
    const badAction = makeAction({ id: 'act-bad', pageUrl: 'https://example.com/bad' });
    const goodAction = makeAction({ id: 'act-good', pageUrl: 'https://example.com/good', context: { detectionChecks: 1 } });
    mocks.getNotActedOnActions.mockReturnValue([badAction, goodAction]);
    mocks.fetchGscSnapshot
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({ captured_at: '2026-05-25T00:00:00.000Z', clicks: 18, position: 8 });

    const { detectExternalExecutions } = await import('../../server/external-detection.js');
    const result = await detectExternalExecutions();

    expect(result).toEqual({ detected: 1, checked: 2 });
    expect(mocks.updateAttribution).toHaveBeenCalledWith('act-good', 'ws-1', 'externally_executed');
  });
});
