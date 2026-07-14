import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getWorkspaceLearnings: vi.fn(),
  getPlaybooks: vi.fn(),
  getActionsByWorkspace: vi.fn(),
  getOutcomesForAction: vi.fn(),
  getTopWinsFromActions: vi.fn(),
  getWorkspace: vi.fn(),
  isProgrammingError: vi.fn(),
  logWarn: vi.fn(),
  logDebug: vi.fn(),
}));

vi.mock('../../server/workspace-learnings.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../server/workspace-learnings.js')>()),
  getWorkspaceLearnings: mocks.getWorkspaceLearnings,
}));

vi.mock('../../server/outcome-playbooks.js', () => ({
  getPlaybooks: mocks.getPlaybooks,
}));

vi.mock('../../server/outcome-tracking.js', () => ({
  getActionsByWorkspace: mocks.getActionsByWorkspace,
  getOutcomesForAction: mocks.getOutcomesForAction,
  getTopWinsFromActions: mocks.getTopWinsFromActions,
}));

vi.mock('../../server/workspaces.js', () => ({
  getWorkspace: mocks.getWorkspace,
}));

vi.mock('../../server/errors.js', () => ({
  isProgrammingError: mocks.isProgrammingError,
}));

vi.mock('../../server/logger.js', () => ({
  createLogger: () => ({
    warn: mocks.logWarn,
    debug: mocks.logDebug,
    info: vi.fn(),
    error: vi.fn(),
  }),
}));

const { assembleLearnings } = await import('../../server/intelligence/learnings-slice.js');

beforeEach(() => {
  vi.clearAllMocks();

  mocks.getWorkspaceLearnings.mockReturnValue({
    confidence: 'high',
    overall: {
      topActionTypes: [
        { type: 'content_update', winRate: 0.8, count: 10 },
        { type: 'schema_fix', winRate: 0.5, count: 4 },
      ],
      totalWinRate: 0.67,
      recentTrend: 'improving',
    },
  });
  mocks.getPlaybooks.mockReturnValue([{ name: 'Refresh decaying pages', actionSequence: [] }]);

  // roiAttribution and weCalledIt now come from action_outcomes (live table), not roi_attributions.
  // action_1 has a strong_win outcome with clicks data → contributes to both roiAttribution and weCalledIt.
  mocks.getActionsByWorkspace.mockReturnValue([
    {
      id: 'action_1',
      actionType: 'schema_fix',
      pageUrl: '/pricing',
      baselineSnapshot: { clicks: 120 },
    },
    {
      id: 'action_2',
      actionType: 'internal_link',
      pageUrl: null,
      baselineSnapshot: { clicks: 0 },
    },
  ]);
  mocks.getOutcomesForAction.mockImplementation((actionId: string) => {
    if (actionId === 'action_1') {
      return [{
        score: 'strong_win',
        checkpointDays: 30,
        metricsSnapshot: { clicks: 200 },
        deltaSummary: {
          primary_metric: 'clicks',
          baseline_value: 120,
          current_value: 200,
          delta_absolute: 80,
          delta_percent: 66.7,
          direction: 'improved',
        },
        measuredAt: '2026-05-22T12:00:00.000Z',
      }];
    }
    return [{
      score: 'neutral',
      checkpointDays: 30,
      metricsSnapshot: { clicks: 0 },
      deltaSummary: {
        primary_metric: 'clicks',
        baseline_value: 0,
        current_value: 0,
        delta_absolute: 0,
        delta_percent: 0,
        direction: 'stable',
      },
      measuredAt: '2026-05-23T12:00:00.000Z',
    }];
  });
  mocks.getTopWinsFromActions.mockImplementation((actions: Array<{ id: string }>, _limit: number, getOutcomes: (id: string) => Array<{ score: string }>) => {
    const action = actions.find((candidate: { id: string }) => getOutcomes(candidate.id).some(outcome => outcome.score === 'strong_win'));
    return action ? [{ actionId: action.id, score: 'strong_win' }] : [];
  });

  mocks.getWorkspace.mockReturnValue({
    scoringConfig: {
      content_update: {
        primary_metric: 'clicks',
        thresholds: { strong_win: 30, win: 10, neutral_band: 5 },
      },
    },
  });

  mocks.isProgrammingError.mockReturnValue(false);
});

describe('assembleLearnings', () => {
  it('assembles expected shape and maps enrichment payloads', async () => {
    const result = await assembleLearnings('ws_1', { learningsDomain: 'strategy' });

    expect(mocks.getWorkspaceLearnings).toHaveBeenCalledWith('ws_1', 'strategy');
    expect(result.availability).toBe('ready');
    expect(result.confidence).toBe('high');
    expect(result.topActionTypes).toEqual([
      { type: 'content_update', winRate: 0.8, count: 10 },
      { type: 'schema_fix', winRate: 0.5, count: 4 },
    ]);
    expect(result.overallWinRate).toBe(0.67);
    expect(result.recentTrend).toBe('improving');
    expect(result.playbooks).toEqual([{ name: 'Refresh decaying pages', actionSequence: [] }]);

    // roiAttribution now reads from the live action_outcomes table (Task 2.3).
    // action_1 (schema_fix on /pricing) has a strong_win with clicks 120→200.
    expect(result.roiAttribution).toEqual([
      {
        actionId: 'action_1',
        pageUrl: '/pricing',
        actionType: 'schema_fix',
        clicksBefore: 120,
        clicksAfter: 200,
        clickGain: 80,
        measuredAt: '2026-05-22T12:00:00.000Z',
      },
    ]);

    expect(result.topWins).toEqual([{ actionId: 'action_1', score: 'strong_win' }]);
    expect(result.weCalledIt).toEqual([
      {
        actionId: 'action_1',
        prediction: 'schema fix on /pricing',
        outcome: 'Clicks improved from 120 to 200 (+66.7%).',
        score: 'strong_win',
        pageUrl: '/pricing',
        measuredAt: '2026-05-22T12:00:00.000Z',
      },
    ]);
    expect(result.winRateByActionType).toEqual({
      content_update: 0.8,
      schema_fix: 0.5,
    });
    expect(result.scoringConfig).toEqual({
      content_update: {
        primary_metric: 'clicks',
        thresholds: { strong_win: 30, win: 10, neutral_band: 5 },
      },
    });
    expect(result.clientProjection).toEqual(expect.objectContaining({
      availability: 'ready',
      weCalledIt: [expect.objectContaining({ actionId: 'action_1' })],
    }));
  });

  it('returns default-on no_data baseline when learnings are unavailable', async () => {
    mocks.getWorkspaceLearnings.mockReturnValue(null);
    mocks.getPlaybooks.mockReturnValue([]);
    mocks.getActionsByWorkspace.mockReturnValue([]);
    mocks.getTopWinsFromActions.mockReturnValue([]);
    mocks.getWorkspace.mockReturnValue(null);

    const result = await assembleLearnings('ws_no_data');

    expect(result.availability).toBe('no_data');
    expect(result.summary).toBeNull();
    expect(result.confidence).toBeNull();
    expect(result.topActionTypes).toEqual([]);
    expect(result.overallWinRate).toBe(0);
    expect(result.recentTrend).toBeNull();
    expect(result.playbooks).toEqual([]);
    expect(result.roiAttribution).toEqual([]);
    expect(result.topWins).toEqual([]);
    expect(result.weCalledIt).toEqual([]);
    expect(result.winRateByActionType).toEqual({});
    expect(result.scoringConfig).toBeUndefined();
    expect(mocks.getWorkspaceLearnings).toHaveBeenCalledWith('ws_no_data', 'all');
    expect(mocks.getActionsByWorkspace).toHaveBeenCalledWith('ws_no_data');
  });

  it('degrades core load failures and preserves stable defaults', async () => {
    mocks.getWorkspaceLearnings.mockImplementation(() => {
      throw new Error('learnings unavailable');
    });
    mocks.getActionsByWorkspace.mockImplementation(() => {
      throw new Error('actions unavailable');
    });
    mocks.getWorkspace.mockImplementation(() => {
      throw new Error('workspace unavailable');
    });

    const result = await assembleLearnings('ws_degraded');

    expect(result.availability).toBe('degraded');
    expect(result.summary).toBeNull();
    expect(result.confidence).toBeNull();
    expect(result.topActionTypes).toEqual([]);
    expect(result.overallWinRate).toBe(0);
    expect(result.recentTrend).toBeNull();
    expect(result.playbooks).toEqual([{ name: 'Refresh decaying pages', actionSequence: [] }]);
    expect(result.roiAttribution).toEqual([]);
    expect(result.topWins).toEqual([]);
    expect(result.weCalledIt).toEqual([]);
    expect(result.winRateByActionType).toEqual({});
    expect(result.scoringConfig).toBeUndefined();
    expect(mocks.logWarn).toHaveBeenCalled();
  });

  it('returns no_data when core summary is null and optional paths fail', async () => {
    mocks.getWorkspaceLearnings.mockReturnValue(null);
    mocks.getPlaybooks.mockImplementation(() => {
      throw new Error('playbook store unavailable');
    });
    // roi_attributions no longer consulted (Task 2.3) — roiAttribution comes from action_outcomes

    const result = await assembleLearnings('ws_no_data');

    expect(result.availability).toBe('no_data');
    expect(result.summary).toBeNull();
    expect(result.confidence).toBeNull();
    expect(result.playbooks).toEqual([]);
    // action_1 has strong_win → contributes to both roiAttribution and weCalledIt/topWins
    expect(result.roiAttribution).toEqual([
      {
        actionId: 'action_1',
        pageUrl: '/pricing',
        actionType: 'schema_fix',
        clicksBefore: 120,
        clicksAfter: 200,
        clickGain: 80,
        measuredAt: '2026-05-22T12:00:00.000Z',
      },
    ]);
    expect(result.topWins).toEqual([{ actionId: 'action_1', score: 'strong_win' }]);
  });
});
