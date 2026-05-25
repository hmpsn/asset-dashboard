import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  isFeatureEnabled: vi.fn(),
  getWorkspaceLearnings: vi.fn(),
  getPlaybooks: vi.fn(),
  getROIAttributionsRaw: vi.fn(),
  getActionsByWorkspace: vi.fn(),
  getOutcomesForAction: vi.fn(),
  getTopWinsFromActions: vi.fn(),
  getWorkspace: vi.fn(),
  isProgrammingError: vi.fn(),
  logWarn: vi.fn(),
  logDebug: vi.fn(),
}));

vi.mock('../../server/feature-flags.js', () => ({
  isFeatureEnabled: mocks.isFeatureEnabled,
}));

vi.mock('../../server/workspace-learnings.js', () => ({
  getWorkspaceLearnings: mocks.getWorkspaceLearnings,
}));

vi.mock('../../server/outcome-playbooks.js', () => ({
  getPlaybooks: mocks.getPlaybooks,
}));

vi.mock('../../server/roi-attribution.js', () => ({
  getROIAttributionsRaw: mocks.getROIAttributionsRaw,
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

  mocks.isFeatureEnabled.mockReturnValue(true);
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
  mocks.getPlaybooks.mockReturnValue([{ name: 'Refresh decaying pages' }]);
  mocks.getROIAttributionsRaw.mockReturnValue([
    {
      id: 'roi_1',
      pageUrl: '/services',
      actionType: 'content_update',
      clicksBefore: 120,
      clicksAfter: 200,
      clickGain: 80,
      measuredAt: '2026-05-20T10:00:00.000Z',
    },
  ]);

  mocks.getActionsByWorkspace.mockReturnValue([
    { id: 'action_1', actionType: 'schema_fix', pageUrl: '/pricing' },
    { id: 'action_2', actionType: 'internal_link', pageUrl: null },
  ]);
  mocks.getOutcomesForAction.mockImplementation((actionId: string) => {
    if (actionId === 'action_1') {
      return [{ score: 'strong_win', measuredAt: '2026-05-22T12:00:00.000Z' }];
    }
    return [{ score: 'neutral', measuredAt: '2026-05-23T12:00:00.000Z' }];
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
    expect(result.playbooks).toEqual([{ name: 'Refresh decaying pages' }]);

    expect(result.roiAttribution).toEqual([
      {
        actionId: 'roi_1',
        pageUrl: '/services',
        actionType: 'content_update',
        clicksBefore: 120,
        clicksAfter: 200,
        clickGain: 80,
        measuredAt: '2026-05-20T10:00:00.000Z',
      },
    ]);

    expect(result.topWins).toEqual([{ actionId: 'action_1', score: 'strong_win' }]);
    expect(result.weCalledIt).toEqual([
      {
        actionId: 'action_1',
        prediction: 'schema_fix on /pricing',
        outcome: 'strong_win',
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
  });

  it('returns disabled baseline when feature flag is off', async () => {
    mocks.isFeatureEnabled.mockReturnValue(false);

    const result = await assembleLearnings('ws_disabled');

    expect(result).toEqual({
      availability: 'disabled',
      summary: null,
      confidence: null,
      topActionTypes: [],
      overallWinRate: 0,
      recentTrend: null,
      playbooks: [],
    });
    expect(mocks.getWorkspaceLearnings).not.toHaveBeenCalled();
    expect(mocks.getPlaybooks).not.toHaveBeenCalled();
    expect(mocks.getROIAttributionsRaw).not.toHaveBeenCalled();
  });

  it('degrades core load failures and preserves stable defaults', async () => {
    mocks.getWorkspaceLearnings.mockImplementation(() => {
      throw new Error('learnings unavailable');
    });
    mocks.getROIAttributionsRaw.mockImplementation(() => {
      throw new Error('roi unavailable');
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
    expect(result.playbooks).toEqual([{ name: 'Refresh decaying pages' }]);
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
    mocks.getROIAttributionsRaw.mockImplementation(() => {
      throw new Error('roi unavailable');
    });

    const result = await assembleLearnings('ws_no_data');

    expect(result.availability).toBe('no_data');
    expect(result.summary).toBeNull();
    expect(result.confidence).toBeNull();
    expect(result.playbooks).toEqual([]);
    expect(result.roiAttribution).toEqual([]);
    expect(result.topWins).toEqual([{ actionId: 'action_1', score: 'strong_win' }]);
  });
});
