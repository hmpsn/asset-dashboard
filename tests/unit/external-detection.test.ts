import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getNotActedOnActions: vi.fn(),
  updateAttribution: vi.fn(),
  updateActionContext: vi.fn(),
  fetchGscSnapshot: vi.fn(),
  broadcastToWorkspace: vi.fn(),
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
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
  WS_EVENTS: {
    OUTCOME_EXTERNAL_DETECTED: 'outcome:external_detected',
  },
}));

vi.mock('../../server/logger.js', () => ({
  createLogger: () => ({
    info: mocks.logInfo,
    warn: mocks.logWarn,
    error: mocks.logError,
    debug: vi.fn(),
  }),
}));

async function loadModule() {
  vi.resetModules();
  return import('../../server/external-detection.js');
}

function action(overrides: Record<string, unknown> = {}) {
  return {
    id: 'a1',
    workspaceId: 'ws_1',
    actionType: 'update_meta_title',
    pageUrl: 'https://example.com/page',
    baselineSnapshot: { position: 12, clicks: 20 },
    context: { detectionChecks: 0 },
    ...overrides,
  };
}

describe('external-detection behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('requires two consecutive positive checks before attribution', async () => {
    const { detectExternalExecutions } = await loadModule();

    mocks.getNotActedOnActions.mockReturnValue([action({ context: { detectionChecks: 0 } })]);
    mocks.fetchGscSnapshot.mockResolvedValue({ position: 8, clicks: 20 });

    const first = await detectExternalExecutions();
    expect(first).toEqual({ detected: 0, checked: 1 });
    expect(mocks.updateActionContext).toHaveBeenCalledWith(
      'a1',
      'ws_1',
      expect.objectContaining({ detectionChecks: 1 }),
    );
    expect(mocks.updateAttribution).not.toHaveBeenCalled();

    mocks.getNotActedOnActions.mockReturnValue([action({ context: { detectionChecks: 1 } })]);
    const second = await detectExternalExecutions();

    expect(second).toEqual({ detected: 1, checked: 1 });
    expect(mocks.updateAttribution).toHaveBeenCalledWith('a1', 'ws_1', 'externally_executed');
    expect(mocks.broadcastToWorkspace).toHaveBeenCalledWith(
      'ws_1',
      'outcome:external_detected',
      { actionId: 'a1' },
    );
  });

  it('broadcasts only an opaque invalidation for a client-hidden detected action', async () => {
    const { detectExternalExecutions } = await loadModule();

    mocks.getNotActedOnActions.mockReturnValue([
      action({ actionType: 'voice_calibrated', context: { detectionChecks: 1 } }),
    ]);
    mocks.fetchGscSnapshot.mockResolvedValue({ position: 8, clicks: 20 });

    expect(await detectExternalExecutions()).toEqual({ detected: 1, checked: 1 });
    expect(mocks.broadcastToWorkspace).toHaveBeenCalledWith(
      'ws_1',
      'outcome:external_detected',
      {},
    );
  });

  it('resets detectionChecks when improvement is no longer present', async () => {
    const { detectExternalExecutions } = await loadModule();

    mocks.getNotActedOnActions.mockReturnValue([action({ context: { detectionChecks: 2 } })]);
    mocks.fetchGscSnapshot.mockResolvedValue({ position: 11, clicks: 21 });

    const result = await detectExternalExecutions();

    expect(result).toEqual({ detected: 0, checked: 1 });
    expect(mocks.updateActionContext).toHaveBeenCalledWith(
      'a1',
      'ws_1',
      expect.objectContaining({ detectionChecks: 0 }),
    );
    expect(mocks.updateAttribution).not.toHaveBeenCalled();
  });

  it('requires at least +5 absolute clicks even if 20% threshold is met', async () => {
    const { detectExternalExecutions } = await loadModule();

    mocks.getNotActedOnActions.mockReturnValue([action({ baselineSnapshot: { clicks: 20 }, context: { detectionChecks: 1 } })]);
    mocks.fetchGscSnapshot.mockResolvedValue({ clicks: 24 });

    const result = await detectExternalExecutions();

    expect(result).toEqual({ detected: 0, checked: 1 });
    expect(mocks.updateAttribution).not.toHaveBeenCalled();
    expect(mocks.updateActionContext).toHaveBeenCalledWith(
      'a1',
      'ws_1',
      expect.objectContaining({ detectionChecks: 0 }),
    );
  });

  it('does not evaluate actions lacking actionable baseline or page URL', async () => {
    const { detectExternalExecutions } = await loadModule();

    mocks.getNotActedOnActions.mockReturnValue([
      action({ id: 'no_url', pageUrl: undefined }),
      action({ id: 'no_base', baselineSnapshot: { captured_at: '2026-05-01T00:00:00.000Z' } }),
    ]);

    const result = await detectExternalExecutions();

    expect(result).toEqual({ detected: 0, checked: 2 });
    expect(mocks.fetchGscSnapshot).not.toHaveBeenCalled();
    expect(mocks.updateAttribution).not.toHaveBeenCalled();
    expect(mocks.updateActionContext).not.toHaveBeenCalled();
  });

  it('continues checking later actions when one GSC lookup throws', async () => {
    const { detectExternalExecutions } = await loadModule();

    mocks.getNotActedOnActions.mockReturnValue([
      action({ id: 'bad' }),
      action({ id: 'good', context: { detectionChecks: 1 }, baselineSnapshot: { clicks: 10 } }),
    ]);
    mocks.fetchGscSnapshot
      .mockRejectedValueOnce(new Error('gsc timeout'))
      .mockResolvedValueOnce({ clicks: 20 });

    const result = await detectExternalExecutions();

    expect(result).toEqual({ detected: 1, checked: 2 });
    expect(mocks.updateAttribution).toHaveBeenCalledWith('good', 'ws_1', 'externally_executed');
    expect(mocks.logWarn).toHaveBeenCalledWith(
      { err: expect.any(Error), actionId: 'bad' },
      'Error checking external execution',
    );
  });

  it('tolerates malformed action context without aborting the run', async () => {
    const { detectExternalExecutions } = await loadModule();

    mocks.getNotActedOnActions.mockReturnValue([
      action({ id: 'bad_ctx', context: undefined }),
      action({ id: 'good', context: { detectionChecks: 1 }, baselineSnapshot: { position: 12, clicks: 20 } }),
    ]);
    mocks.fetchGscSnapshot
      .mockResolvedValueOnce({ position: 8, clicks: 20 })
      .mockResolvedValueOnce({ position: 8, clicks: 20 });

    const result = await detectExternalExecutions();

    expect(result).toEqual({ detected: 1, checked: 2 });
    expect(mocks.logWarn).toHaveBeenCalledWith(
      { err: expect.anything(), actionId: 'bad_ctx' },
      'Error checking external execution',
    );
  });
});
