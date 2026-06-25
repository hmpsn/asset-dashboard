/**
 * A1 — learnings corruption fixes (audit #1). Unit coverage for:
 *  1. backfill maps each rec type to its mapped ActionType (not hardcoded audit_fix_applied)
 *  2. not_acted_on actions excluded from learnings aggregation
 *  3. phantom-metric guard → inconclusive (generic, any metric)
 *  4. difficulty multiplier disabled (returns 1.0)
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// 1. Backfill rec-type → ActionType mapping
// ---------------------------------------------------------------------------

const backfillMocks = vi.hoisted(() => ({
  stmts: {
    allWorkspaceIds: { all: vi.fn(() => []) },
    publishedPosts: { all: vi.fn(() => []) },
    resolvedInsights: { all: vi.fn(() => []) },
    recommendationSet: { get: vi.fn(() => undefined) },
  },
  parseJsonSafeArray: vi.fn(() => []),
  recordAction: vi.fn(),
  getActionBySource: vi.fn(() => null),
  loadRecommendationSet: vi.fn(() => null),
}));

vi.mock('../../server/db/index.js', () => ({ default: { prepare: vi.fn() } }));
vi.mock('../../server/db/stmt-cache.js', () => ({ createStmtCache: () => () => backfillMocks.stmts }));
vi.mock('../../server/db/json-validation.js', () => ({ parseJsonSafeArray: backfillMocks.parseJsonSafeArray }));
vi.mock('../../server/logger.js', () => ({
  createLogger: () => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}));
vi.mock('../../server/outcome-tracking.js', () => ({
  recordAction: backfillMocks.recordAction,
  getActionBySource: backfillMocks.getActionBySource,
  // Consumed by computeWorkspaceLearnings (A1.2 not_acted_on exclusion).
  getActionsByWorkspace: vi.fn(() => []),
  getOutcomesForAction: vi.fn(() => []),
}));
vi.mock('../../server/recommendation-storage.js', () => ({
  loadRecommendationSet: backfillMocks.loadRecommendationSet,
}));

import { backfillCompletedRecommendations } from '../../server/outcome-backfill.js';
import { isMetricPresent } from '../../server/outcome-measurement.js';
import {
  computeWorkspaceLearnings,
  type ScoredActionWithOutcome,
} from '../../server/workspace-learnings.js';
import { buildOutcomeAdjustment } from '../../server/outcome-learning-default-path.js';
import type { LearningsSlice } from '../../shared/types/intelligence.js';
import type { TrackedAction, ActionOutcome, Attribution } from '../../shared/types/outcome-tracking.js';

describe('A1.1 backfill rec-type mapping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    backfillMocks.getActionBySource.mockReturnValue(null);
    backfillMocks.loadRecommendationSet.mockReturnValue(null);
  });

  it.each([
    ['content', 'audit:content', 'content_published'],
    ['metadata', 'audit:meta', 'meta_updated'],
    ['schema', 'audit:schema', 'schema_deployed'],
    ['content_refresh', 'decay', 'content_refreshed'],
  ])('maps completed %s rec → %s (not audit_fix_applied)', (type, source, expected) => {
    backfillMocks.loadRecommendationSet.mockReturnValue({
      workspaceId: 'ws_1',
      generatedAt: '2026-01-01T00:00:00.000Z',
      recommendations: [{ id: `rec_${type}`, status: 'completed', type, source, affectedPages: ['/p'] }],
      summary: {},
    });

    backfillCompletedRecommendations('ws_1');

    expect(backfillMocks.recordAction).toHaveBeenCalledWith(
      expect.objectContaining({ sourceId: `rec_${type}`, actionType: expected }),
    );
    expect(backfillMocks.recordAction).not.toHaveBeenCalledWith(
      expect.objectContaining({ sourceId: `rec_${type}`, actionType: 'audit_fix_applied' }),
    );
  });

  it('maps an audit-family type (technical) → audit_fix_applied', () => {
    backfillMocks.loadRecommendationSet.mockReturnValue({
      workspaceId: 'ws_1',
      generatedAt: '2026-01-01T00:00:00.000Z',
      recommendations: [{ id: 'rec_tech', status: 'completed', type: 'technical', source: 'audit:speed', affectedPages: [] }],
      summary: {},
    });

    backfillCompletedRecommendations('ws_1');

    expect(backfillMocks.recordAction).toHaveBeenCalledWith(
      expect.objectContaining({ sourceId: 'rec_tech', actionType: 'audit_fix_applied' }),
    );
  });

  it('defaults a legacy rec missing type to audit_fix_applied without throwing', () => {
    backfillMocks.loadRecommendationSet.mockReturnValue({
      workspaceId: 'ws_1',
      generatedAt: '2026-01-01T00:00:00.000Z',
      recommendations: [{ id: 'rec_legacy', status: 'completed', affectedPages: [] }],
      summary: {},
    });

    expect(() => backfillCompletedRecommendations('ws_1')).not.toThrow();
    expect(backfillMocks.recordAction).toHaveBeenCalledWith(
      expect.objectContaining({ sourceId: 'rec_legacy', actionType: 'audit_fix_applied' }),
    );
  });
});

// ---------------------------------------------------------------------------
// 3. Phantom-metric guard
// ---------------------------------------------------------------------------

describe('A1.3 isMetricPresent (generic phantom-metric guard)', () => {
  const cap = '2026-01-01T00:00:00Z';

  it('returns false when the metric is absent from both snapshots', () => {
    expect(isMetricPresent('click_recovery', { captured_at: cap, clicks: 10 }, { captured_at: cap, clicks: 20 })).toBe(false);
    expect(isMetricPresent('target_improvement', { captured_at: cap }, { captured_at: cap })).toBe(false);
    expect(isMetricPresent('content_produced', { captured_at: cap, position: 5 }, { captured_at: cap, position: 3 })).toBe(false);
  });

  it('returns true when the metric is present in at least one snapshot', () => {
    expect(isMetricPresent('position', { captured_at: cap, position: 5 }, { captured_at: cap })).toBe(true);
    expect(isMetricPresent('clicks', { captured_at: cap }, { captured_at: cap, clicks: 0 })).toBe(true);
    expect(isMetricPresent('page_health_score', { captured_at: cap, page_health_score: 80 }, { captured_at: cap, page_health_score: 90 })).toBe(true);
  });

  it('treats null the same as undefined (absent)', () => {
    expect(isMetricPresent('voice_score', { captured_at: cap, voice_score: null as unknown as number }, { captured_at: cap })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. not_acted_on exclusion from learnings aggregation
// ---------------------------------------------------------------------------

vi.mock('../../server/db/outcome-mappers.js', () => ({ rowToWorkspaceLearnings: vi.fn(() => null) }));

import { getActionsByWorkspace, getOutcomesForAction } from '../../server/outcome-tracking.js';

let _id = 0;
function uid() { return `a1-${++_id}`; }

function makeAction(attribution: Attribution, actionType = 'content_published'): TrackedAction {
  return {
    id: uid(),
    workspaceId: 'ws-na',
    actionType: actionType as TrackedAction['actionType'],
    sourceType: 'post',
    sourceId: uid(),
    pageUrl: null,
    targetKeyword: null,
    baselineSnapshot: { captured_at: '2026-01-01T00:00:00Z', position: 15 },
    trailingHistory: { metric: 'position', dataPoints: [] },
    attribution,
    measurementWindow: 90,
    measurementComplete: true,
    sourceFlag: 'live',
    baselineConfidence: 'exact',
    context: {},
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

function makeOutcome(actionId: string, score: ActionOutcome['score']): ActionOutcome {
  return {
    id: uid(),
    actionId,
    checkpointDays: 90,
    metricsSnapshot: { captured_at: '2026-03-01T00:00:00Z', position: 4 },
    score,
    deltaSummary: { primary_metric: 'position', baseline_value: 15, current_value: 4, delta_absolute: -11, delta_percent: -73, direction: 'improved' },
    competitorContext: null,
    measuredAt: '2026-03-01T00:00:00Z',
    attributedValue: null,
    valueBasis: null,
  };
}

describe('A1.2 not_acted_on exclusion', () => {
  beforeEach(() => vi.clearAllMocks());

  it('excludes not_acted_on actions from the scored learnings set', () => {
    const executed = makeAction('platform_executed');
    const notActed = makeAction('not_acted_on');
    const outcomes: Record<string, ActionOutcome[]> = {
      [executed.id]: [makeOutcome(executed.id, 'win')],
      [notActed.id]: [makeOutcome(notActed.id, 'win')],
    };
    vi.mocked(getActionsByWorkspace).mockReturnValue([executed, notActed]);
    vi.mocked(getOutcomesForAction).mockImplementation((id: string) => outcomes[id] ?? []);

    const result = computeWorkspaceLearnings('ws-na');

    // Only the executed action contributes — the not_acted_on win is dropped.
    expect(result.totalScoredActions).toBe(1);
  });

  it('keeps externally_executed and platform_executed actions', () => {
    const a = makeAction('platform_executed');
    const b = makeAction('externally_executed');
    const outcomes: Record<string, ActionOutcome[]> = {
      [a.id]: [makeOutcome(a.id, 'win')],
      [b.id]: [makeOutcome(b.id, 'loss')],
    };
    vi.mocked(getActionsByWorkspace).mockReturnValue([a, b]);
    vi.mocked(getOutcomesForAction).mockImplementation((id: string) => outcomes[id] ?? []);

    const result = computeWorkspaceLearnings('ws-na');
    expect(result.totalScoredActions).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 4. Difficulty multiplier disabled
// ---------------------------------------------------------------------------

describe('A1.4 difficulty multiplier disabled', () => {
  function readyLearnings(over: Partial<LearningsSlice> = {}): LearningsSlice {
    return {
      availability: 'ready',
      summary: {
        workspaceId: 'ws',
        computedAt: '2026-01-01T00:00:00Z',
        confidence: 'high',
        totalScoredActions: 30,
        content: null,
        technical: null,
        overall: { totalWinRate: 0.5, strongWinRate: 0.2, topActionTypes: [], recentTrend: 'stable' },
        strategy: {
          winRateByDifficultyRange: { '0-20': 0.9 }, // would multiply UP if enabled
          winRateByCheckpoint: {},
          bestIntentTypes: [],
          keywordVolumeSweetSpot: null,
        },
      },
      confidence: 'high',
      topActionTypes: [],
      overallWinRate: 0.5,
      recentTrend: 'stable',
      playbooks: [],
      winRateByActionType: {},
      ...over,
    };
  }

  it('returns 1.0 difficulty contribution even with a strongly-matching bin', () => {
    const res = buildOutcomeAdjustment({
      actionType: 'content_published',
      learnings: readyLearnings(),
      difficulty: 10, // KD 10 → '0-20' label → 0.9 win rate → would boost if enabled
    });
    // No difficulty reason is emitted while disabled.
    expect(res.reasons.some(r => r.toLowerCase().includes('difficulty'))).toBe(false);
    // With no action-type win rate provided, the net multiplier is exactly 1.0.
    expect(res.multiplier).toBe(1);
  });

  it('still applies the action-type multiplier (only difficulty is disabled)', () => {
    const res = buildOutcomeAdjustment({
      actionType: 'content_published',
      learnings: readyLearnings({ winRateByActionType: { content_published: 0.7 } }),
      difficulty: 10,
    });
    // action-type boost (winRate 0.7 → 1.14) applies; difficulty does not.
    expect(res.multiplier).toBeGreaterThan(1);
    expect(res.reasons.some(r => r.toLowerCase().includes('difficulty'))).toBe(false);
  });
});
