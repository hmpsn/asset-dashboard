import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScoringConfig, TrackedAction } from '../../shared/types/outcome-tracking.js';

const h = vi.hoisted(() => ({
  getPendingActions: vi.fn(),
  recordOutcome: vi.fn(),
  getOutcomesForAction: vi.fn(),
  getActionsByPage: vi.fn(),
  updateActionContext: vi.fn(),
  updateBaselineSnapshot: vi.fn(),
  markActionComplete: vi.fn(),
  readKeywordRankSnapshot: vi.fn(() => null),
  resolveScoringConfig: vi.fn(),
  getWorkspace: vi.fn(),
  getPageTrend: vi.fn(),
  broadcastToWorkspace: vi.fn(),
  isProgrammingError: vi.fn(() => false),
}));

vi.mock('../../server/logger.js', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }),
}));

vi.mock('../../server/outcome-tracking.js', () => ({
  getPendingActions: h.getPendingActions,
  recordOutcome: h.recordOutcome,
  getOutcomesForAction: h.getOutcomesForAction,
  getActionsByPage: h.getActionsByPage,
  updateActionContext: h.updateActionContext,
  updateBaselineSnapshot: h.updateBaselineSnapshot,
  markActionComplete: h.markActionComplete,
}));

// A4: keyword-level rank-snapshot reader (touches the real DB) — mocked so the
// runtime tests stay hermetic. Default: no snapshot (null), the FM-2 baseline.
vi.mock('../../server/outcome-measurement-keywords.js', () => ({
  readKeywordRankSnapshot: h.readKeywordRankSnapshot,
}));

vi.mock('../../server/outcome-scoring-defaults.js', () => ({
  resolveScoringConfig: h.resolveScoringConfig,
}));

vi.mock('../../server/workspaces.js', () => ({
  getWorkspace: h.getWorkspace,
}));

vi.mock('../../server/search-console.js', () => ({
  getPageTrend: h.getPageTrend,
}));

vi.mock('../../server/broadcast.js', () => ({
  broadcastToWorkspace: h.broadcastToWorkspace,
}));

vi.mock('../../server/ws-events.js', () => ({
  WS_EVENTS: { OUTCOME_SCORED: 'outcome_scored' },
}));

vi.mock('../../server/errors.js', () => ({
  isProgrammingError: h.isProgrammingError,
}));

import {
  fetchGscSnapshot,
  captureBaselineFromGsc,
  measurePendingOutcomes,
} from '../../server/outcome-measurement.js';

function makeAction(overrides: Partial<TrackedAction> = {}): TrackedAction {
  return {
    id: 'action-1',
    workspaceId: 'ws-1',
    actionType: 'insight_acted_on',
    sourceType: 'insight',
    sourceId: null,
    pageUrl: '/blog/test',
    targetKeyword: null,
    baselineSnapshot: {
      clicks: 100,
      impressions: 200,
      position: 10,
      captured_at: '2026-03-01T00:00:00.000Z',
    },
    trailingHistory: { metric: 'clicks', dataPoints: [] },
    attribution: 'platform_executed',
    measurementWindow: 90,
    measurementComplete: false,
    sourceFlag: 'live',
    baselineConfidence: 'exact',
    context: {},
    createdAt: new Date(Date.now() - (40 * 24 * 60 * 60 * 1000)).toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

const scoringConfig: ScoringConfig = {
  insight_acted_on: {
    primary_metric: 'clicks',
    thresholds: { strong_win: 30, win: 15, neutral_band: 10 },
  },
  content_published: {
    primary_metric: 'position',
    thresholds: { strong_win: 10, win: 3, neutral_band: 1 },
  },
  strategy_keyword_added: {
    primary_metric: 'position',
    thresholds: { strong_win: 10, win: 5, neutral_band: 3 },
  },
  schema_deployed: {
    primary_metric: 'ctr',
    thresholds: { strong_win: 20, win: 10, neutral_band: 5 },
  },
  audit_fix_applied: {
    primary_metric: 'page_health_score',
    thresholds: { strong_win: 15, win: 5, neutral_band: 3 },
  },
  content_refreshed: {
    primary_metric: 'click_recovery',
    thresholds: { strong_win: 80, win: 40, neutral_band: 20 },
  },
  internal_link_added: {
    primary_metric: 'target_improvement',
    thresholds: { strong_win: 20, win: 10, neutral_band: 5 },
  },
  meta_updated: {
    primary_metric: 'ctr',
    thresholds: { strong_win: 15, win: 5, neutral_band: 5 },
  },
  brief_created: {
    primary_metric: 'content_produced',
    thresholds: { strong_win: 1, win: 1, neutral_band: 0 },
  },
  voice_calibrated: {
    primary_metric: 'voice_score',
    thresholds: { strong_win: 85, win: 70, neutral_band: 10 },
  },
};

describe('outcome measurement runtime paths', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    h.resolveScoringConfig.mockReturnValue(scoringConfig);
    h.getWorkspace.mockReturnValue({
      webflowSiteId: 'site-1',
      gscPropertyUrl: 'https://example.com',
      liveDomain: 'example.com',
      scoringConfig: null,
    });
    h.getOutcomesForAction.mockReturnValue([]);
    h.getActionsByPage.mockReturnValue([]);
    h.getPendingActions.mockReturnValue([]);

    h.getPageTrend.mockResolvedValue([
      { clicks: 10, impressions: 100, ctr: 10, position: 8 },
      { clicks: 20, impressions: 200, ctr: 10, position: 4 },
    ]);

    h.recordOutcome.mockImplementation((input: Record<string, unknown>) => ({
      id: 'outcome-1',
      actionId: input.actionId,
      checkpointDays: input.checkpointDays,
      metricsSnapshot: input.metricsSnapshot,
      score: input.score,
      earlySignal: input.earlySignal,
      deltaSummary: input.deltaSummary,
      competitorContext: null,
      measuredAt: '2026-05-01T00:00:00.000Z',
    }));
    h.isProgrammingError.mockReturnValue(false);
  });

  it('fetchGscSnapshot returns averaged snapshot when workspace is connected and rows exist', async () => {
    const snapshot = await fetchGscSnapshot('ws-1', '/blog/test', 14);

    expect(snapshot).toBeTruthy();
    expect(snapshot?.clicks).toBe(15);
    expect(snapshot?.impressions).toBe(150);
    expect(snapshot?.ctr).toBe(10);
    expect(snapshot?.position).toBe(6);
    expect(h.getPageTrend).toHaveBeenCalledWith('site-1', 'https://example.com', 'https://example.com/blog/test', 14);
  });

  it('captureBaselineFromGsc persists averaged baseline snapshot', async () => {
    await captureBaselineFromGsc('action-1', 'ws-1', '/blog/test');

    expect(h.updateBaselineSnapshot).toHaveBeenCalledTimes(1);
    expect(h.updateBaselineSnapshot).toHaveBeenCalledWith(
      'action-1',
      'ws-1',
      expect.objectContaining({
        clicks: 15,
        impressions: 150,
        ctr: 10,
        position: 6,
      }),
    );
  });

  it('fetch and baseline helpers gracefully handle missing workspace linkage and provider errors', async () => {
    h.getWorkspace.mockReturnValue(undefined);
    expect(await fetchGscSnapshot('ws-1', '/blog/test', 14)).toBeNull();
    await captureBaselineFromGsc('action-1', 'ws-1', '/blog/test');
    expect(h.updateBaselineSnapshot).not.toHaveBeenCalled();

    h.getWorkspace.mockReturnValue({
      webflowSiteId: 'site-1',
      gscPropertyUrl: 'https://example.com',
      liveDomain: 'example.com',
      scoringConfig: null,
    });
    h.isProgrammingError.mockReturnValue(true);
    h.getPageTrend.mockRejectedValueOnce(new Error('gsc unavailable'));
    expect(await fetchGscSnapshot('ws-1', '/blog/test', 14)).toBeNull();
  });

  it('measurePendingOutcomes scores due checkpoints and broadcasts outcomes', async () => {
    h.getPendingActions.mockReturnValue([makeAction()]);

    const result = await measurePendingOutcomes(undefined, new Map([['ws-1', 1]]));

    expect(result.workspaceIds).toEqual(['ws-1']);
    expect(result.errors).toBe(0);
    expect(result.measured).toBe(2);
    expect(h.recordOutcome).toHaveBeenCalledTimes(2);
    expect(h.broadcastToWorkspace).toHaveBeenCalledTimes(2);
    expect(h.updateActionContext).not.toHaveBeenCalled();
  });

  it('broadcasts only opaque scoring invalidations for client-hidden actions', async () => {
    h.getPendingActions.mockReturnValue([
      makeAction({ actionType: 'voice_calibrated' }),
    ]);

    const result = await measurePendingOutcomes(undefined, new Map([['ws-1', 1]]));

    expect(result.errors).toBe(0);
    expect(result.measured).toBe(2);
    expect(h.broadcastToWorkspace).toHaveBeenCalledTimes(2);
    for (const call of h.broadcastToWorkspace.mock.calls) {
      expect(call).toEqual(['ws-1', 'outcome_scored', {}]);
    }
  });

  it('records insufficient_data when search-metric impressions are below minimum', async () => {
    h.getPendingActions.mockReturnValue([
      makeAction({
        baselineSnapshot: {
          clicks: 5,
          impressions: 10,
          position: 12,
          captured_at: '2026-05-01T00:00:00.000Z',
        },
        createdAt: new Date(Date.now() - (8 * 24 * 60 * 60 * 1000)).toISOString(),
      }),
    ]);

    h.getPageTrend.mockResolvedValue([
      { clicks: 4, impressions: 20, ctr: 20, position: 11 },
    ]);

    const result = await measurePendingOutcomes();

    expect(result.measured).toBe(1);
    expect(h.recordOutcome).toHaveBeenCalledWith(expect.objectContaining({
      score: 'insufficient_data',
      checkpointDays: 7,
    }));
  });

  it('marks action inconclusive when baseline lacks all search fields', async () => {
    h.getPendingActions.mockReturnValue([
      makeAction({
        baselineSnapshot: { captured_at: '2026-05-01T00:00:00.000Z' },
        createdAt: new Date(Date.now() - (8 * 24 * 60 * 60 * 1000)).toISOString(),
      }),
    ]);
    h.getPageTrend.mockResolvedValue([{ clicks: 30, impressions: 300, ctr: 10, position: 5 }]);

    const result = await measurePendingOutcomes();
    expect(result.measured).toBe(1);
    expect(h.recordOutcome).toHaveBeenCalledWith(expect.objectContaining({
      score: 'inconclusive',
      checkpointDays: 7,
    }));
  });

  it('updates related action context and records scoring errors without aborting the run', async () => {
    const action = makeAction({
      workspaceId: 'ws-priority-miss',
      pageUrl: '/landing',
      createdAt: new Date(Date.now() - (40 * 24 * 60 * 60 * 1000)).toISOString(),
      baselineSnapshot: {
        clicks: 100,
        impressions: 200,
        captured_at: '2026-03-01T00:00:00.000Z',
      },
    });
    h.getPendingActions.mockReturnValue([action]);
    h.getActionsByPage.mockReturnValue([{ id: 'sibling-1' }, { id: action.id }]);
    h.getWorkspace.mockReturnValue({
      webflowSiteId: 'site-1',
      gscPropertyUrl: 'https://example.com',
      liveDomain: 'example.com',
      scoringConfig: null,
    });
    let callCount = 0;
    h.recordOutcome.mockImplementation((input: Record<string, unknown>) => {
      callCount += 1;
      if (callCount === 2) throw new Error('write failed');
      return {
        id: 'outcome-1',
        actionId: input.actionId,
        checkpointDays: input.checkpointDays,
        metricsSnapshot: input.metricsSnapshot,
        score: input.score,
        earlySignal: input.earlySignal,
        deltaSummary: input.deltaSummary,
        competitorContext: null,
        measuredAt: '2026-05-01T00:00:00.000Z',
      };
    });

    const result = await measurePendingOutcomes(undefined, new Map([['ws-other', 1]]));
    expect(result.measured).toBe(1);
    expect(result.errors).toBe(1);
    expect(h.updateActionContext).toHaveBeenCalledWith(
      action.id,
      action.workspaceId,
      expect.objectContaining({ relatedActions: ['sibling-1'] }),
    );
  });
});
