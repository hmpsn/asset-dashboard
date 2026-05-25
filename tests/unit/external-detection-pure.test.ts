// tests/unit/external-detection-pure.test.ts
// Unit tests for server/external-detection.ts.
// All DB and external-service imports are mocked so no ports or live services
// are required.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — vi.mock factories are hoisted, so use vi.hoisted() for shared refs
// ---------------------------------------------------------------------------

const {
  mockGetNotActedOnActions,
  mockUpdateAttribution,
  mockUpdateActionContext,
  mockFetchGscSnapshot,
  mockBroadcastToWorkspace,
} = vi.hoisted(() => ({
  mockGetNotActedOnActions: vi.fn(),
  mockUpdateAttribution: vi.fn(),
  mockUpdateActionContext: vi.fn(),
  mockFetchGscSnapshot: vi.fn(),
  mockBroadcastToWorkspace: vi.fn(),
}));

vi.mock('../../server/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('../../server/outcome-tracking.js', () => ({
  getNotActedOnActions: mockGetNotActedOnActions,
  updateAttribution: mockUpdateAttribution,
  updateActionContext: mockUpdateActionContext,
}));

vi.mock('../../server/outcome-measurement.js', () => ({
  fetchGscSnapshot: mockFetchGscSnapshot,
}));

vi.mock('../../server/broadcast.js', () => ({
  broadcastToWorkspace: mockBroadcastToWorkspace,
}));

vi.mock('../../server/ws-events.js', () => ({
  WS_EVENTS: {
    OUTCOME_EXTERNAL_DETECTED: 'outcome:external_detected',
  },
}));

import { detectExternalExecutions } from '../../server/external-detection.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAction(overrides: Partial<Parameters<typeof Object.assign>[1]> = {}) {
  return {
    id: 'action-1',
    workspaceId: 'ws-1',
    actionType: 'update_meta_title',
    pageUrl: 'https://example.com/page',
    baselineSnapshot: {
      position: 10,
      clicks: 20,
    },
    context: {
      detectionChecks: 0,
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// detectExternalExecutions — high-level orchestration
// ---------------------------------------------------------------------------

describe('detectExternalExecutions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns { detected: 0, checked: 0 } when there are no pending actions', async () => {
    mockGetNotActedOnActions.mockReturnValue([]);

    const result = await detectExternalExecutions();
    expect(result).toEqual({ detected: 0, checked: 0 });
  });

  it('returns checked count equal to the number of actions returned', async () => {
    const actions = [makeAction({ id: 'a1' }), makeAction({ id: 'a2' })];
    mockGetNotActedOnActions.mockReturnValue(actions);
    mockFetchGscSnapshot.mockResolvedValue(null); // no improvement detected

    const result = await detectExternalExecutions();
    expect(result.checked).toBe(2);
  });

  it('does not detect when action has no pageUrl', async () => {
    const action = makeAction({ pageUrl: undefined });
    mockGetNotActedOnActions.mockReturnValue([action]);

    const result = await detectExternalExecutions();
    expect(result.detected).toBe(0);
    expect(mockFetchGscSnapshot).not.toHaveBeenCalled();
  });

  it('does not detect when baselineSnapshot has no position or clicks', async () => {
    const action = makeAction({ baselineSnapshot: {} });
    mockGetNotActedOnActions.mockReturnValue([action]);

    const result = await detectExternalExecutions();
    expect(result.detected).toBe(0);
    expect(mockFetchGscSnapshot).not.toHaveBeenCalled();
  });

  it('does not detect when GSC snapshot returns null', async () => {
    const action = makeAction();
    mockGetNotActedOnActions.mockReturnValue([action]);
    mockFetchGscSnapshot.mockResolvedValue(null);

    const result = await detectExternalExecutions();
    expect(result.detected).toBe(0);
    expect(mockUpdateAttribution).not.toHaveBeenCalled();
  });

  // --- Position improvement detection ---

  it('increments detectionChecks (first positive check) without committing attribution', async () => {
    const action = makeAction({
      baselineSnapshot: { position: 15, clicks: 0 },
      context: { detectionChecks: 0 },
    });
    mockGetNotActedOnActions.mockReturnValue([action]);
    // Position improved by 5 — exceeds threshold of 3
    mockFetchGscSnapshot.mockResolvedValue({ position: 10, clicks: 0 });

    const result = await detectExternalExecutions();
    expect(result.detected).toBe(0);
    expect(mockUpdateActionContext).toHaveBeenCalledWith(
      'action-1',
      'ws-1',
      expect.objectContaining({ detectionChecks: 1 }),
    );
    expect(mockUpdateAttribution).not.toHaveBeenCalled();
  });

  it('commits attribution on second consecutive positive check (detectionChecks >= 1)', async () => {
    const action = makeAction({
      baselineSnapshot: { position: 15 },
      context: { detectionChecks: 1 }, // second positive check
    });
    mockGetNotActedOnActions.mockReturnValue([action]);
    // Position improved by 6 — above threshold
    mockFetchGscSnapshot.mockResolvedValue({ position: 9, clicks: 0 });

    const result = await detectExternalExecutions();
    expect(result.detected).toBe(1);
    expect(mockUpdateAttribution).toHaveBeenCalledWith('action-1', 'ws-1', 'externally_executed');
    expect(mockBroadcastToWorkspace).toHaveBeenCalledWith(
      'ws-1',
      'outcome:external_detected',
      { actionId: 'action-1' },
    );
  });

  // --- Clicks improvement detection ---

  it('does not detect when clicks improvement is below 20% threshold', async () => {
    const action = makeAction({
      baselineSnapshot: { clicks: 100 },
      context: { detectionChecks: 0 },
    });
    mockGetNotActedOnActions.mockReturnValue([action]);
    // 10% improvement — below threshold
    mockFetchGscSnapshot.mockResolvedValue({ position: undefined, clicks: 110 });

    const result = await detectExternalExecutions();
    expect(result.detected).toBe(0);
    expect(mockUpdateAttribution).not.toHaveBeenCalled();
  });

  it('does not detect when absolute click gain is below 5', async () => {
    const action = makeAction({
      baselineSnapshot: { clicks: 4 },
      context: { detectionChecks: 0 },
    });
    mockGetNotActedOnActions.mockReturnValue([action]);
    // 50% relative improvement but only 2 absolute extra clicks
    mockFetchGscSnapshot.mockResolvedValue({ position: undefined, clicks: 6 });

    const result = await detectExternalExecutions();
    expect(result.detected).toBe(0);
    expect(mockUpdateActionContext).not.toHaveBeenCalled();
    expect(mockUpdateAttribution).not.toHaveBeenCalled();
  });

  it('detects (first check) when clicks improved by >=20% with >=5 absolute gain', async () => {
    const action = makeAction({
      baselineSnapshot: { clicks: 20 },
      context: { detectionChecks: 0 },
    });
    mockGetNotActedOnActions.mockReturnValue([action]);
    // 50% improvement, 10 absolute extra clicks
    mockFetchGscSnapshot.mockResolvedValue({ position: undefined, clicks: 30 });

    const result = await detectExternalExecutions();
    expect(result.detected).toBe(0); // first check only — not committed yet
    expect(mockUpdateActionContext).toHaveBeenCalledWith(
      'action-1',
      'ws-1',
      expect.objectContaining({ detectionChecks: 1 }),
    );
  });

  it('commits attribution via clicks improvement on second check', async () => {
    const action = makeAction({
      baselineSnapshot: { clicks: 20 },
      context: { detectionChecks: 1 },
    });
    mockGetNotActedOnActions.mockReturnValue([action]);
    mockFetchGscSnapshot.mockResolvedValue({ position: undefined, clicks: 30 });

    const result = await detectExternalExecutions();
    expect(result.detected).toBe(1);
    expect(mockUpdateAttribution).toHaveBeenCalledWith('action-1', 'ws-1', 'externally_executed');
  });

  // --- Reset behavior ---

  it('resets detectionChecks to 0 when a previously positive action shows no improvement', async () => {
    const action = makeAction({
      baselineSnapshot: { position: 10 },
      context: { detectionChecks: 1 }, // had a prior positive check
    });
    mockGetNotActedOnActions.mockReturnValue([action]);
    // No improvement: position stayed the same
    mockFetchGscSnapshot.mockResolvedValue({ position: 10, clicks: 0 });

    const result = await detectExternalExecutions();
    expect(result.detected).toBe(0);
    expect(mockUpdateActionContext).toHaveBeenCalledWith(
      'action-1',
      'ws-1',
      expect.objectContaining({ detectionChecks: 0 }),
    );
  });

  it('does not call updateActionContext on a fresh action with no improvement and no prior checks', async () => {
    const action = makeAction({
      baselineSnapshot: { position: 10 },
      context: { detectionChecks: 0 },
    });
    mockGetNotActedOnActions.mockReturnValue([action]);
    // No improvement
    mockFetchGscSnapshot.mockResolvedValue({ position: 10, clicks: 0 });

    await detectExternalExecutions();
    expect(mockUpdateActionContext).not.toHaveBeenCalled();
  });

  // --- Error resilience ---

  it('continues processing remaining actions when one throws', async () => {
    const badAction = makeAction({ id: 'bad', pageUrl: 'https://example.com/bad' });
    const goodAction = makeAction({
      id: 'good',
      baselineSnapshot: { clicks: 20 },
      context: { detectionChecks: 1 },
    });
    mockGetNotActedOnActions.mockReturnValue([badAction, goodAction]);
    mockFetchGscSnapshot
      .mockRejectedValueOnce(new Error('network error'))
      .mockResolvedValueOnce({ position: undefined, clicks: 30 });

    const result = await detectExternalExecutions();
    expect(result.checked).toBe(2);
    expect(result.detected).toBe(1);
  });

  // --- baseline with only clicks (no position) ---

  it('treats action as having a baseline when only clicks is set', async () => {
    const action = makeAction({
      baselineSnapshot: { clicks: 50 }, // position is undefined
      context: { detectionChecks: 1 },
    });
    mockGetNotActedOnActions.mockReturnValue([action]);
    // 60% improvement, 30 absolute gain
    mockFetchGscSnapshot.mockResolvedValue({ clicks: 80 });

    const result = await detectExternalExecutions();
    expect(result.detected).toBe(1);
  });

  it('does not detect when position improves by less than 3 places', async () => {
    const action = makeAction({
      baselineSnapshot: { position: 12 },
      context: { detectionChecks: 0 },
    });
    mockGetNotActedOnActions.mockReturnValue([action]);
    // Improved by 2 — below threshold
    mockFetchGscSnapshot.mockResolvedValue({ position: 10 });

    const result = await detectExternalExecutions();
    expect(result.detected).toBe(0);
    expect(mockUpdateActionContext).not.toHaveBeenCalled();
  });
});
