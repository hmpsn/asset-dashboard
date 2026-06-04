/**
 * Unit tests for server/intelligence/learnings-slice.ts
 *
 * Coverage targets:
 *  1. Default-on availability states (ready / no_data / degraded).
 *  3. weCalledIt filtering — strong_win only, 50-action scan limit, 5-entry cap.
 *  4. Lazy cache coherency — getOutcomesForAction called at most once per action ID.
 *  5. scoringConfig population — workspace found vs not-found.
 *  6. ROI attribution mapping — happy path and exception-graceful path.
 *  7. topWins — correct args forwarded to getTopWinsFromActions.
 *  8. Summary field mapping — confidence, topActionTypes, overallWinRate, recentTrend.
 *  9. winRateByActionType — derived from topActionTypes.
 * 10. Graceful degradation — each optional sub-section throws independently.
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';

// ── Module mocks (must appear before any real imports) ────────────────────────
// vi.mock is hoisted to the top of the file by Vitest. Factories must not close
// over variables declared in the test module — use vi.fn() directly.

vi.mock('../../server/workspace-learnings.js', () => ({
  getWorkspaceLearnings: vi.fn().mockReturnValue(null),
}));

vi.mock('../../server/outcome-playbooks.js', () => ({
  getPlaybooks: vi.fn().mockReturnValue([]),
}));

// roi-attribution.js is no longer used by learnings-slice (Task 2.3).
// The module may still exist for other callers; the mock here prevents any
// accidental import from reaching real DB code.
vi.mock('../../server/roi-attribution.js', () => ({
  getROIAttributionsRaw: vi.fn().mockReturnValue([]),
}));

vi.mock('../../server/outcome-tracking.js', () => ({
  getActionsByWorkspace: vi.fn().mockReturnValue([]),
  getOutcomesForAction: vi.fn().mockReturnValue([]),
  getTopWinsFromActions: vi.fn().mockReturnValue([]),
}));

vi.mock('../../server/workspaces.js', () => ({
  getWorkspace: vi.fn().mockReturnValue(null),
}));

vi.mock('../../server/logger.js', () => ({
  createLogger: () => ({
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('../../server/errors.js', () => ({
  isProgrammingError: vi.fn().mockReturnValue(false),
}));

// ── Real imports (after mocks) ─────────────────────────────────────────────────
import { assembleLearnings } from '../../server/intelligence/learnings-slice.js';
import { getWorkspaceLearnings } from '../../server/workspace-learnings.js';
import { getPlaybooks } from '../../server/outcome-playbooks.js';
import { getActionsByWorkspace, getOutcomesForAction, getTopWinsFromActions } from '../../server/outcome-tracking.js';
// getROIAttributionsRaw is imported to verify the mock is wired (the old path is dead after Task 2.3).
import { getROIAttributionsRaw } from '../../server/roi-attribution.js';
import { getWorkspace } from '../../server/workspaces.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeSummary(overrides: Record<string, unknown> = {}) {
  return {
    confidence: 'medium' as const,
    overall: {
      totalWinRate: 0.6,
      topActionTypes: [{ type: 'content_update', winRate: 0.7, count: 5 }],
      recentTrend: 'improving' as const,
    },
    ...overrides,
  };
}

/** Build a minimal TrackedAction-shaped object. */
function makeAction(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    workspaceId: 'ws-1',
    actionType: 'content_update',
    sourceType: 'manual',
    sourceId: null,
    pageUrl: `/page/${id}`,
    targetKeyword: null,
    // baselineSnapshot.clicks is read by the roiAttribution loop (Task 2.3)
    baselineSnapshot: { clicks: 100 },
    trailingHistory: {},
    attribution: {},
    measurementWindow: 30,
    measurementComplete: false,
    sourceFlag: 'manual',
    baselineConfidence: 'medium',
    context: {},
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

/** Build a minimal ActionOutcome-shaped object. */
function makeOutcome(actionId: string, score: string | null = 'strong_win') {
  return {
    id: `outcome-${actionId}`,
    actionId,
    checkpointDays: 30,
    // metricsSnapshot.clicks is read by the roiAttribution loop (Task 2.3)
    metricsSnapshot: { clicks: 150 },
    score,
    deltaSummary: { delta_percent: 20 },
    competitorContext: null,
    measuredAt: '2024-06-01T00:00:00Z',
  };
}

/** @deprecated Was used for the old getROIAttributionsRaw path (roi_attributions, dead table).
 * Retained as a no-op to avoid breaking the test file structure; the new roiAttribution tests
 * build their data via makeAction + makeOutcome (Task 2.3). */
function makeROIRow(_id: string) {
  return {
    id: _id,
    pageUrl: `/roi-page/${_id}`,
    actionType: 'content_update',
    clicksBefore: 100,
    clicksAfter: 150,
    clickGain: 50,
    measuredAt: '2024-06-01T00:00:00Z',
  };
}

const WS_ID = 'ws-test-1';

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('assembleLearnings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: no learnings, no actions, no workspace
    vi.mocked(getWorkspaceLearnings).mockReturnValue(null);
    vi.mocked(getPlaybooks).mockReturnValue([]);
    vi.mocked(getActionsByWorkspace).mockReturnValue([]);
    vi.mocked(getOutcomesForAction).mockReturnValue([]);
    vi.mocked(getTopWinsFromActions).mockReturnValue([]);
    vi.mocked(getROIAttributionsRaw).mockReturnValue([]); // kept for completeness; no longer called by assembleLearnings (Task 2.3)
    vi.mocked(getWorkspace).mockReturnValue(null);
  });

  // ── 1. Availability states ────────────────────────────────────────────────────

  describe('availability states', () => {
    it('returns no_data when getWorkspaceLearnings returns null', async () => {
      vi.mocked(getWorkspaceLearnings).mockReturnValue(null);
      const result = await assembleLearnings(WS_ID);
      expect(result.availability).toBe('no_data');
    });

    it('attempts all learnings data sources by default', async () => {
      await assembleLearnings(WS_ID);

      expect(getWorkspaceLearnings).toHaveBeenCalledWith(WS_ID, 'all');
      expect(getActionsByWorkspace).toHaveBeenCalledWith(WS_ID);
      expect(getWorkspace).toHaveBeenCalledWith(WS_ID);
      expect(getROIAttributionsRaw).not.toHaveBeenCalled();
    });

    it('returns ready when getWorkspaceLearnings returns a summary', async () => {
      vi.mocked(getWorkspaceLearnings).mockReturnValue(makeSummary() as any);
      const result = await assembleLearnings(WS_ID);
      expect(result.availability).toBe('ready');
    });

    it('returns degraded when getWorkspaceLearnings throws', async () => {
      vi.mocked(getWorkspaceLearnings).mockImplementation(() => {
        throw new Error('DB exploded');
      });
      const result = await assembleLearnings(WS_ID);
      expect(result.availability).toBe('degraded');
    });

    it('degraded result has null summary', async () => {
      vi.mocked(getWorkspaceLearnings).mockImplementation(() => {
        throw new Error('fail');
      });
      const result = await assembleLearnings(WS_ID);
      expect(result.summary).toBeNull();
    });

    it('degraded result has null confidence', async () => {
      vi.mocked(getWorkspaceLearnings).mockImplementation(() => {
        throw new Error('fail');
      });
      const result = await assembleLearnings(WS_ID);
      expect(result.confidence).toBeNull();
    });

    it('degraded result has empty topActionTypes', async () => {
      vi.mocked(getWorkspaceLearnings).mockImplementation(() => {
        throw new Error('fail');
      });
      const result = await assembleLearnings(WS_ID);
      expect(result.topActionTypes).toEqual([]);
    });

    it('degraded result has zero overallWinRate', async () => {
      vi.mocked(getWorkspaceLearnings).mockImplementation(() => {
        throw new Error('fail');
      });
      const result = await assembleLearnings(WS_ID);
      expect(result.overallWinRate).toBe(0);
    });

    it('degraded result has null recentTrend', async () => {
      vi.mocked(getWorkspaceLearnings).mockImplementation(() => {
        throw new Error('fail');
      });
      const result = await assembleLearnings(WS_ID);
      expect(result.recentTrend).toBeNull();
    });
  });

  // ── 3. Summary field mapping ──────────────────────────────────────────────────

  describe('summary field mapping', () => {
    it('maps confidence from summary', async () => {
      vi.mocked(getWorkspaceLearnings).mockReturnValue(makeSummary({ confidence: 'high' }) as any);
      const result = await assembleLearnings(WS_ID);
      expect(result.confidence).toBe('high');
    });

    it('maps overallWinRate from summary.overall.totalWinRate', async () => {
      vi.mocked(getWorkspaceLearnings).mockReturnValue(makeSummary() as any);
      const result = await assembleLearnings(WS_ID);
      expect(result.overallWinRate).toBe(0.6);
    });

    it('maps recentTrend from summary.overall.recentTrend', async () => {
      vi.mocked(getWorkspaceLearnings).mockReturnValue(
        makeSummary({ overall: { totalWinRate: 0.5, topActionTypes: [], recentTrend: 'declining' } }) as any,
      );
      const result = await assembleLearnings(WS_ID);
      expect(result.recentTrend).toBe('declining');
    });

    it('maps topActionTypes sliced to first 5', async () => {
      const actionTypes = Array.from({ length: 8 }, (_, i) => ({
        type: `type_${i}`,
        winRate: 0.5 + i * 0.01,
        count: i + 1,
      }));
      vi.mocked(getWorkspaceLearnings).mockReturnValue(
        makeSummary({ overall: { totalWinRate: 0.5, topActionTypes: actionTypes, recentTrend: 'stable' } }) as any,
      );
      const result = await assembleLearnings(WS_ID);
      expect(result.topActionTypes).toHaveLength(5);
      expect(result.topActionTypes[0].type).toBe('type_0');
    });

    it('sets summary field to the returned object', async () => {
      const summary = makeSummary();
      vi.mocked(getWorkspaceLearnings).mockReturnValue(summary as any);
      const result = await assembleLearnings(WS_ID);
      expect(result.summary).toBe(summary);
    });

    it('builds winRateByActionType from topActionTypes', async () => {
      vi.mocked(getWorkspaceLearnings).mockReturnValue(
        makeSummary({
          overall: {
            totalWinRate: 0.6,
            topActionTypes: [
              { type: 'content_update', winRate: 0.7, count: 3 },
              { type: 'title_rewrite', winRate: 0.4, count: 2 },
            ],
            recentTrend: 'improving',
          },
        }) as any,
      );
      const result = await assembleLearnings(WS_ID);
      expect(result.winRateByActionType).toEqual({
        content_update: 0.7,
        title_rewrite: 0.4,
      });
    });

    it('winRateByActionType is empty object when summary is null', async () => {
      vi.mocked(getWorkspaceLearnings).mockReturnValue(null);
      const result = await assembleLearnings(WS_ID);
      expect(result.winRateByActionType).toEqual({});
    });

    it('forwards playbooks from getPlaybooks', async () => {
      const playbook = { id: 'pb-1', name: 'Test Playbook' };
      vi.mocked(getPlaybooks).mockReturnValue([playbook] as any);
      const result = await assembleLearnings(WS_ID);
      expect(result.playbooks).toEqual([playbook]);
    });
  });

  // ── 4. weCalledIt filtering ───────────────────────────────────────────────────

  describe('weCalledIt filtering', () => {
    it('only includes actions with strong_win outcome', async () => {
      const action = makeAction('a1');
      vi.mocked(getActionsByWorkspace).mockReturnValue([action] as any);
      vi.mocked(getOutcomesForAction).mockReturnValue([makeOutcome('a1', 'strong_win')] as any);
      const result = await assembleLearnings(WS_ID);
      expect(result.weCalledIt).toHaveLength(1);
      expect(result.weCalledIt![0].score).toBe('strong_win');
    });

    it('does NOT include win (non-strong) outcomes', async () => {
      const action = makeAction('a1');
      vi.mocked(getActionsByWorkspace).mockReturnValue([action] as any);
      vi.mocked(getOutcomesForAction).mockReturnValue([makeOutcome('a1', 'win')] as any);
      const result = await assembleLearnings(WS_ID);
      expect(result.weCalledIt).toHaveLength(0);
    });

    it('does NOT include null score outcomes', async () => {
      const action = makeAction('a1');
      vi.mocked(getActionsByWorkspace).mockReturnValue([action] as any);
      vi.mocked(getOutcomesForAction).mockReturnValue([makeOutcome('a1', null)] as any);
      const result = await assembleLearnings(WS_ID);
      expect(result.weCalledIt).toHaveLength(0);
    });

    it('caps weCalledIt at 5 entries even when more qualify', async () => {
      // 10 actions, all strong_win — only 5 should appear
      const actions = Array.from({ length: 10 }, (_, i) => makeAction(`a${i}`));
      vi.mocked(getActionsByWorkspace).mockReturnValue(actions as any);
      vi.mocked(getOutcomesForAction).mockImplementation((actionId: string) =>
        [makeOutcome(actionId, 'strong_win')] as any,
      );
      const result = await assembleLearnings(WS_ID);
      expect(result.weCalledIt).toHaveLength(5);
    });

    it('only scans the first 50 actions — action 51 is excluded even if strong_win', async () => {
      // 51 actions: actions 0–49 have no strong_win, action 50 (index 50) has strong_win
      const actions = Array.from({ length: 51 }, (_, i) => makeAction(`a${i}`));
      vi.mocked(getActionsByWorkspace).mockReturnValue(actions as any);
      vi.mocked(getOutcomesForAction).mockImplementation((actionId: string) => {
        // Only the 51st action (id="a50") has a strong_win
        if (actionId === 'a50') return [makeOutcome(actionId, 'strong_win')] as any;
        return [];
      });
      const result = await assembleLearnings(WS_ID);
      expect(result.weCalledIt).toHaveLength(0);
    });

    it('action at index 49 (the 50th) IS included if it has strong_win', async () => {
      // 50 actions: only the last one (index 49) qualifies
      const actions = Array.from({ length: 50 }, (_, i) => makeAction(`a${i}`));
      vi.mocked(getActionsByWorkspace).mockReturnValue(actions as any);
      vi.mocked(getOutcomesForAction).mockImplementation((actionId: string) => {
        if (actionId === 'a49') return [makeOutcome(actionId, 'strong_win')] as any;
        return [];
      });
      const result = await assembleLearnings(WS_ID);
      expect(result.weCalledIt).toHaveLength(1);
      expect(result.weCalledIt![0].actionId).toBe('a49');
    });

    it('sets prediction to "<actionType> on <pageUrl>"', async () => {
      const action = makeAction('a1', { actionType: 'title_rewrite', pageUrl: '/about' });
      vi.mocked(getActionsByWorkspace).mockReturnValue([action] as any);
      vi.mocked(getOutcomesForAction).mockReturnValue([makeOutcome('a1', 'strong_win')] as any);
      const result = await assembleLearnings(WS_ID);
      expect(result.weCalledIt![0].prediction).toBe('title_rewrite on /about');
    });

    it('prediction falls back to "site" when pageUrl is null', async () => {
      const action = makeAction('a1', { pageUrl: null });
      vi.mocked(getActionsByWorkspace).mockReturnValue([action] as any);
      vi.mocked(getOutcomesForAction).mockReturnValue([makeOutcome('a1', 'strong_win')] as any);
      const result = await assembleLearnings(WS_ID);
      expect(result.weCalledIt![0].prediction).toMatch(/on site$/);
    });

    it('pageUrl field falls back to empty string when action.pageUrl is null', async () => {
      const action = makeAction('a1', { pageUrl: null });
      vi.mocked(getActionsByWorkspace).mockReturnValue([action] as any);
      vi.mocked(getOutcomesForAction).mockReturnValue([makeOutcome('a1', 'strong_win')] as any);
      const result = await assembleLearnings(WS_ID);
      expect(result.weCalledIt![0].pageUrl).toBe('');
    });

    it('pageUrl field is preserved when action.pageUrl is a string', async () => {
      const action = makeAction('a1', { pageUrl: '/my-page' });
      vi.mocked(getActionsByWorkspace).mockReturnValue([action] as any);
      vi.mocked(getOutcomesForAction).mockReturnValue([makeOutcome('a1', 'strong_win')] as any);
      const result = await assembleLearnings(WS_ID);
      expect(result.weCalledIt![0].pageUrl).toBe('/my-page');
    });

    it('sets outcome and score both to "strong_win"', async () => {
      const action = makeAction('a1');
      vi.mocked(getActionsByWorkspace).mockReturnValue([action] as any);
      vi.mocked(getOutcomesForAction).mockReturnValue([makeOutcome('a1', 'strong_win')] as any);
      const result = await assembleLearnings(WS_ID);
      expect(result.weCalledIt![0].outcome).toBe('strong_win');
      expect(result.weCalledIt![0].score).toBe('strong_win');
    });

    it('sets measuredAt from the strong_win outcome', async () => {
      const action = makeAction('a1');
      const outcome = { ...makeOutcome('a1', 'strong_win'), measuredAt: '2024-09-15T00:00:00Z' };
      vi.mocked(getActionsByWorkspace).mockReturnValue([action] as any);
      vi.mocked(getOutcomesForAction).mockReturnValue([outcome] as any);
      const result = await assembleLearnings(WS_ID);
      expect(result.weCalledIt![0].measuredAt).toBe('2024-09-15T00:00:00Z');
    });

    it('measuredAt falls back to empty string when outcome.measuredAt is null/undefined', async () => {
      const action = makeAction('a1');
      const outcome = { ...makeOutcome('a1', 'strong_win'), measuredAt: undefined };
      vi.mocked(getActionsByWorkspace).mockReturnValue([action] as any);
      vi.mocked(getOutcomesForAction).mockReturnValue([outcome] as any);
      const result = await assembleLearnings(WS_ID);
      expect(result.weCalledIt![0].measuredAt).toBe('');
    });

    it('weCalledIt is empty array when no actions exist', async () => {
      vi.mocked(getActionsByWorkspace).mockReturnValue([]);
      const result = await assembleLearnings(WS_ID);
      expect(result.weCalledIt).toEqual([]);
    });

    it('stores the actionId on each weCalledIt entry', async () => {
      const action = makeAction('action-xyz');
      vi.mocked(getActionsByWorkspace).mockReturnValue([action] as any);
      vi.mocked(getOutcomesForAction).mockReturnValue([makeOutcome('action-xyz', 'strong_win')] as any);
      const result = await assembleLearnings(WS_ID);
      expect(result.weCalledIt![0].actionId).toBe('action-xyz');
    });
  });

  // ── 5. Lazy cache coherency ───────────────────────────────────────────────────

  describe('lazy cache coherency — getOutcomesForAction called at most once per action', () => {
    it('calls getOutcomesForAction exactly once for an action that appears in both loops', async () => {
      // Action "shared" will be hit by both getTopWinsFromActions (via cachedGetOutcomes)
      // and the weCalledIt loop. The cache should prevent a second call.
      const action = makeAction('shared');
      vi.mocked(getActionsByWorkspace).mockReturnValue([action] as any);
      vi.mocked(getOutcomesForAction).mockReturnValue([makeOutcome('shared', 'strong_win')] as any);

      // Make getTopWinsFromActions actually call cachedGetOutcomes so the cache is warmed
      vi.mocked(getTopWinsFromActions).mockImplementation((actions, _limit, getOutcomes) => {
        if (getOutcomes) getOutcomes('shared'); // warms the cache
        return [];
      });

      await assembleLearnings(WS_ID);

      // Even though both loops reference action "shared", the underlying function
      // should be called only once (cache hit on the second access).
      expect(vi.mocked(getOutcomesForAction).mock.calls.length).toBe(1);
    });

    it('calls getOutcomesForAction once per distinct action ID', async () => {
      const actions = [makeAction('a1'), makeAction('a2'), makeAction('a3')];
      vi.mocked(getActionsByWorkspace).mockReturnValue(actions as any);
      vi.mocked(getOutcomesForAction).mockImplementation((actionId: string) =>
        [makeOutcome(actionId, 'strong_win')] as any,
      );

      await assembleLearnings(WS_ID);

      // Three distinct action IDs → three calls total (one each)
      const calledIds = vi.mocked(getOutcomesForAction).mock.calls.map(c => c[0]);
      const uniqueIds = new Set(calledIds);
      expect(calledIds.length).toBe(uniqueIds.size);
    });

    it('passes cachedGetOutcomes to getTopWinsFromActions', async () => {
      const action = makeAction('a1');
      vi.mocked(getActionsByWorkspace).mockReturnValue([action] as any);

      let capturedGetOutcomes: ((id: string) => unknown) | undefined;
      vi.mocked(getTopWinsFromActions).mockImplementation((_actions, _limit, getOutcomes) => {
        capturedGetOutcomes = getOutcomes;
        return [];
      });

      await assembleLearnings(WS_ID);

      expect(capturedGetOutcomes).toBeTypeOf('function');
    });

    it('getTopWinsFromActions is called with limit=5', async () => {
      await assembleLearnings(WS_ID);
      expect(vi.mocked(getTopWinsFromActions)).toHaveBeenCalledWith(
        expect.anything(),
        5,
        expect.anything(),
      );
    });

    it('repeated calls to cachedGetOutcomes with same ID produce same result', async () => {
      const action = makeAction('a1');
      vi.mocked(getActionsByWorkspace).mockReturnValue([action] as any);

      const outcomes = [makeOutcome('a1', 'strong_win')];
      vi.mocked(getOutcomesForAction).mockReturnValue(outcomes as any);

      let firstResult: unknown;
      let secondResult: unknown;
      vi.mocked(getTopWinsFromActions).mockImplementation((_actions, _limit, getOutcomes) => {
        if (getOutcomes) {
          firstResult = getOutcomes('a1');
          secondResult = getOutcomes('a1'); // second call — should hit cache
        }
        return [];
      });

      await assembleLearnings(WS_ID);

      // Cache returns the same array reference
      expect(firstResult).toBe(secondResult);
      // Underlying function called only once despite two cachedGetOutcomes calls
      expect(vi.mocked(getOutcomesForAction).mock.calls.length).toBe(1);
    });
  });

  // ── 6. scoringConfig ─────────────────────────────────────────────────────────

  describe('scoringConfig', () => {
    it('is undefined when getWorkspace returns null', async () => {
      vi.mocked(getWorkspace).mockReturnValue(null);
      const result = await assembleLearnings(WS_ID);
      expect(result.scoringConfig).toBeUndefined();
    });

    it('is undefined when workspace exists but scoringConfig is undefined', async () => {
      vi.mocked(getWorkspace).mockReturnValue({ id: WS_ID } as any);
      const result = await assembleLearnings(WS_ID);
      expect(result.scoringConfig).toBeUndefined();
    });

    it('is populated when workspace has a scoringConfig', async () => {
      const config = {
        content_update: {
          primary_metric: 'clicks',
          thresholds: { strong_win: 0.3, win: 0.1, neutral_band: 0.05 },
        },
      };
      vi.mocked(getWorkspace).mockReturnValue({ id: WS_ID, scoringConfig: config } as any);
      const result = await assembleLearnings(WS_ID);
      expect(result.scoringConfig).toEqual(config);
    });

    it('is undefined when getWorkspace throws', async () => {
      vi.mocked(getWorkspace).mockImplementation(() => {
        throw new Error('workspace exploded');
      });
      const result = await assembleLearnings(WS_ID);
      expect(result.scoringConfig).toBeUndefined();
    });
  });

  // ── 7. ROI attribution mapping (Task 2.3: reads live action_outcomes, not roi_attributions) ─

  describe('ROI attribution mapping', () => {
    it('maps ROI rows to roiAttribution array with correct field names', async () => {
      // action-1 has a win outcome: clicksBefore=100 (baselineSnapshot), clicksAfter=150 (metricsSnapshot)
      const action = makeAction('action-1');
      vi.mocked(getActionsByWorkspace).mockReturnValue([action] as any);
      vi.mocked(getOutcomesForAction).mockReturnValue([makeOutcome('action-1', 'win')] as any);
      const result = await assembleLearnings(WS_ID);
      expect(result.roiAttribution).toHaveLength(1);
      expect(result.roiAttribution![0]).toEqual({
        actionId: 'action-1',
        pageUrl: `/page/action-1`,
        actionType: 'content_update',
        clicksBefore: 100,
        clicksAfter: 150,
        clickGain: 50,
        measuredAt: '2024-06-01T00:00:00Z',
      });
    });

    it('maps actionId from action.id (not a separate id field)', async () => {
      const action = makeAction('myid');
      vi.mocked(getActionsByWorkspace).mockReturnValue([action] as any);
      vi.mocked(getOutcomesForAction).mockReturnValue([makeOutcome('myid', 'win')] as any);
      const result = await assembleLearnings(WS_ID);
      expect(result.roiAttribution![0]).toHaveProperty('actionId', 'myid');
      expect(result.roiAttribution![0]).not.toHaveProperty('id');
    });

    it('returns empty roiAttribution when no actions', async () => {
      vi.mocked(getActionsByWorkspace).mockReturnValue([]);
      const result = await assembleLearnings(WS_ID);
      expect(result.roiAttribution).toEqual([]);
    });

    it('returns empty roiAttribution when all outcomes are non-win scores', async () => {
      const action = makeAction('a1');
      vi.mocked(getActionsByWorkspace).mockReturnValue([action] as any);
      vi.mocked(getOutcomesForAction).mockReturnValue([makeOutcome('a1', 'neutral')] as any);
      const result = await assembleLearnings(WS_ID);
      expect(result.roiAttribution).toEqual([]);
    });

    it('returns empty roiAttribution when outcome-tracking throws', async () => {
      vi.mocked(getActionsByWorkspace).mockImplementation(() => {
        throw new Error('tracking db error');
      });
      const result = await assembleLearnings(WS_ID);
      expect(result.roiAttribution).toEqual([]);
    });

    it('maps multiple actions preserving insertion order (ordered by action list)', async () => {
      const actions = [makeAction('r1'), makeAction('r2'), makeAction('r3')];
      vi.mocked(getActionsByWorkspace).mockReturnValue(actions as any);
      vi.mocked(getOutcomesForAction).mockImplementation((actionId: string) =>
        [makeOutcome(actionId, 'win')] as any,
      );
      const result = await assembleLearnings(WS_ID);
      expect(result.roiAttribution!.map(r => r.actionId)).toEqual(['r1', 'r2', 'r3']);
    });

    it('does not call getROIAttributionsRaw (dead table no longer consulted)', async () => {
      const action = makeAction('a1');
      vi.mocked(getActionsByWorkspace).mockReturnValue([action] as any);
      vi.mocked(getOutcomesForAction).mockReturnValue([makeOutcome('a1', 'win')] as any);
      await assembleLearnings(WS_ID);
      // getROIAttributionsRaw must not be called — roi_attributions has zero writers (Task 2.3)
      expect(vi.mocked(getROIAttributionsRaw)).not.toHaveBeenCalled();
    });
  });

  // ── 8. topWins ───────────────────────────────────────────────────────────────

  describe('topWins', () => {
    it('returns the value from getTopWinsFromActions as topWins', async () => {
      const topWins = [
        {
          actionId: 'a1',
          actionType: 'content_update',
          pageUrl: '/page',
          targetKeyword: null,
          delta: { delta_percent: 40 },
          score: 'strong_win',
          createdAt: '2024-01-01',
          scoredAt: '2024-06-01',
        },
      ];
      vi.mocked(getTopWinsFromActions).mockReturnValue(topWins as any);
      const result = await assembleLearnings(WS_ID);
      expect(result.topWins).toEqual(topWins);
    });

    it('topWins is empty array when getTopWinsFromActions returns []', async () => {
      vi.mocked(getTopWinsFromActions).mockReturnValue([]);
      const result = await assembleLearnings(WS_ID);
      expect(result.topWins).toEqual([]);
    });

    it('topWins is [] when outcome-tracking throws', async () => {
      vi.mocked(getActionsByWorkspace).mockImplementation(() => {
        throw new Error('tracking db down');
      });
      const result = await assembleLearnings(WS_ID);
      expect(result.topWins).toEqual([]);
    });

    it('calls getTopWinsFromActions with actions from getActionsByWorkspace', async () => {
      const actions = [makeAction('a1'), makeAction('a2')];
      vi.mocked(getActionsByWorkspace).mockReturnValue(actions as any);
      await assembleLearnings(WS_ID);
      expect(vi.mocked(getTopWinsFromActions)).toHaveBeenCalledWith(
        actions,
        5,
        expect.any(Function),
      );
    });
  });

  // ── 9. Graceful degradation — independent sub-sections ───────────────────────

  describe('graceful degradation of independent sub-sections', () => {
    it('win outcome (not strong_win) contributes to roiAttribution but not weCalledIt', async () => {
      // Task 2.3: roiAttribution and weCalledIt now come from the same action_outcomes loop.
      // A "win" outcome is included in roiAttribution but excluded from weCalledIt (strong_win only).
      vi.mocked(getWorkspaceLearnings).mockReturnValue(makeSummary() as any);
      const action = makeAction('a1');
      vi.mocked(getActionsByWorkspace).mockReturnValue([action] as any);
      vi.mocked(getOutcomesForAction).mockReturnValue([makeOutcome('a1', 'win')] as any);

      const result = await assembleLearnings(WS_ID);
      expect(result.availability).toBe('ready');
      expect(result.weCalledIt).toHaveLength(0); // win, not strong_win
      expect(result.roiAttribution).toHaveLength(1); // win qualifies
    });

    it('outcome-tracking failure degrades roiAttribution, weCalledIt, and topWins to empty', async () => {
      // Task 2.3: all three fields come from the same outcome-tracking block — all fail together.
      vi.mocked(getWorkspaceLearnings).mockReturnValue(makeSummary() as any);
      vi.mocked(getActionsByWorkspace).mockImplementation(() => {
        throw new Error('tracking fail');
      });

      const result = await assembleLearnings(WS_ID);
      expect(result.availability).toBe('ready');
      expect(result.roiAttribution).toEqual([]);
      expect(result.weCalledIt).toEqual([]);
      expect(result.topWins).toEqual([]);
    });

    it('workspace failure does not affect availability or weCalledIt', async () => {
      vi.mocked(getWorkspaceLearnings).mockReturnValue(makeSummary() as any);
      vi.mocked(getWorkspace).mockImplementation(() => {
        throw new Error('workspace fail');
      });
      const action = makeAction('a1');
      vi.mocked(getActionsByWorkspace).mockReturnValue([action] as any);
      vi.mocked(getOutcomesForAction).mockReturnValue([makeOutcome('a1', 'strong_win')] as any);

      const result = await assembleLearnings(WS_ID);
      expect(result.availability).toBe('ready');
      expect(result.weCalledIt).toHaveLength(1);
      expect(result.scoringConfig).toBeUndefined();
    });

    it('all sub-sections fail simultaneously — result is still a valid shape', async () => {
      vi.mocked(getWorkspaceLearnings).mockReturnValue(makeSummary() as any);
      vi.mocked(getActionsByWorkspace).mockImplementation(() => { throw new Error(); });
      vi.mocked(getWorkspace).mockImplementation(() => { throw new Error(); });

      const result = await assembleLearnings(WS_ID);
      // Core fields still come from the summary
      expect(result.availability).toBe('ready');
      expect(result.overallWinRate).toBe(0.6);
      // Optional fields degrade gracefully
      expect(result.roiAttribution).toEqual([]);
      expect(result.weCalledIt).toEqual([]);
      expect(result.topWins).toEqual([]);
      expect(result.scoringConfig).toBeUndefined();
    });
  });

  // ── 10. Edge cases ────────────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('passes workspaceId to getWorkspaceLearnings', async () => {
      await assembleLearnings('specific-ws');
      expect(vi.mocked(getWorkspaceLearnings)).toHaveBeenCalledWith('specific-ws', expect.anything());
    });

    it('passes opts.learningsDomain to getWorkspaceLearnings when provided', async () => {
      await assembleLearnings(WS_ID, { learningsDomain: 'content' } as any);
      expect(vi.mocked(getWorkspaceLearnings)).toHaveBeenCalledWith(WS_ID, 'content');
    });

    it('defaults learningsDomain to "all" when opts is undefined', async () => {
      await assembleLearnings(WS_ID);
      expect(vi.mocked(getWorkspaceLearnings)).toHaveBeenCalledWith(WS_ID, 'all');
    });

    it('passes workspaceId to getActionsByWorkspace', async () => {
      await assembleLearnings('my-ws');
      expect(vi.mocked(getActionsByWorkspace)).toHaveBeenCalledWith('my-ws');
    });

    it('passes workspaceId to getWorkspace', async () => {
      await assembleLearnings('my-ws');
      expect(vi.mocked(getWorkspace)).toHaveBeenCalledWith('my-ws');
    });

    it('result always has the required LearningsSlice fields', async () => {
      const result = await assembleLearnings(WS_ID);
      expect(result).toHaveProperty('availability');
      expect(result).toHaveProperty('summary');
      expect(result).toHaveProperty('confidence');
      expect(result).toHaveProperty('topActionTypes');
      expect(result).toHaveProperty('overallWinRate');
      expect(result).toHaveProperty('recentTrend');
      expect(result).toHaveProperty('playbooks');
    });
  });
});
