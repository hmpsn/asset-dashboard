/**
 * Unit tests for server/outcome-measurement.ts — pure measurement engine functions.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the logger
vi.mock('../../server/logger.js', () => ({
  createLogger: () => ({
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock outcome-tracking (DB-dependent)
vi.mock('../../server/outcome-tracking.js', () => ({
  getPendingActions: vi.fn(() => []),
  recordOutcome: vi.fn(),
  getOutcomesForAction: vi.fn(() => []),
  getActionsByPage: vi.fn(() => []),
  updateActionContext: vi.fn(),
}));

// Mock broadcast
vi.mock('../../server/broadcast.js', () => ({
  broadcastToWorkspace: vi.fn(),
}));

// Mock ws-events
vi.mock('../../server/ws-events.js', () => ({
  WS_EVENTS: { OUTCOME_SCORED: 'outcome_scored' },
}));

import { computeDelta, scoreOutcome, isDueForCheckpoint } from '../../server/outcome-measurement.js';
import { getOutcomesForAction } from '../../server/outcome-tracking.js';
import type { BaselineSnapshot, TrackedAction, DeltaSummary, ScoringConfig } from '../../shared/types/outcome-tracking.js';

// --- Helpers ---

function makeSnapshot(overrides: Partial<BaselineSnapshot> = {}): BaselineSnapshot {
  return {
    captured_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeAction(overrides: Partial<TrackedAction> = {}): TrackedAction {
  return {
    id: 'ta-001',
    workspaceId: 'ws-test',
    actionType: 'content_published',
    sourceType: 'insight',
    sourceId: null,
    pageUrl: null,
    targetKeyword: null,
    baselineSnapshot: makeSnapshot({ clicks: 100, impressions: 500 }),
    trailingHistory: { metric: 'clicks', dataPoints: [] },
    attribution: 'platform_executed',
    measurementWindow: 90,
    measurementComplete: false,
    sourceFlag: 'live',
    baselineConfidence: 'exact',
    context: {},
    createdAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString(), // 40 days ago
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

const DEFAULT_CONFIG: ScoringConfig = {
  content_published: {
    primary_metric: 'position',
    thresholds: { strong_win: 10, win: 3, neutral_band: 1 },
  },
  insight_acted_on: {
    primary_metric: 'clicks',
    thresholds: { strong_win: 30, win: 15, neutral_band: 10 },
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

function makeClicksConfig(): ScoringConfig {
  return {
    ...DEFAULT_CONFIG,
    insight_acted_on: {
      primary_metric: 'clicks',
      thresholds: { strong_win: 30, win: 15, neutral_band: 10 },
    },
  };
}

// --- computeDelta ---

describe('computeDelta', () => {
  it('returns improved direction when clicks increase', () => {
    const baseline = makeSnapshot({ clicks: 100 });
    const current = makeSnapshot({ clicks: 150 });
    const delta = computeDelta(baseline, current, 'clicks');
    expect(delta.direction).toBe('improved');
    expect(delta.delta_absolute).toBe(50);
    expect(delta.delta_percent).toBeCloseTo(50);
  });

  it('returns improved direction when impressions increase', () => {
    const baseline = makeSnapshot({ impressions: 1000 });
    const current = makeSnapshot({ impressions: 1300 });
    const delta = computeDelta(baseline, current, 'impressions');
    expect(delta.direction).toBe('improved');
    expect(delta.delta_absolute).toBe(300);
  });

  it('returns improved direction when position DECREASES (lower is better)', () => {
    const baseline = makeSnapshot({ position: 15 });
    const current = makeSnapshot({ position: 8 });
    const delta = computeDelta(baseline, current, 'position');
    expect(delta.direction).toBe('improved');
    expect(delta.delta_absolute).toBe(-7);
  });

  it('returns declined when position INCREASES (moving down in rankings)', () => {
    const baseline = makeSnapshot({ position: 5 });
    const current = makeSnapshot({ position: 12 });
    const delta = computeDelta(baseline, current, 'position');
    expect(delta.direction).toBe('declined');
  });

  it('returns declined when clicks decrease', () => {
    const baseline = makeSnapshot({ clicks: 200 });
    const current = makeSnapshot({ clicks: 120 });
    const delta = computeDelta(baseline, current, 'clicks');
    expect(delta.direction).toBe('declined');
    expect(delta.delta_absolute).toBe(-80);
  });

  it('returns stable when within 0.01% threshold', () => {
    const baseline = makeSnapshot({ clicks: 100 });
    const current = makeSnapshot({ clicks: 100 });
    const delta = computeDelta(baseline, current, 'clicks');
    expect(delta.direction).toBe('stable');
  });

  it('handles undefined baseline value — defaults to 0', () => {
    const baseline = makeSnapshot(); // no clicks field
    const current = makeSnapshot({ clicks: 50 });
    const delta = computeDelta(baseline, current, 'clicks');
    expect(delta.baseline_value).toBe(0);
    expect(delta.current_value).toBe(50);
    expect(delta.delta_absolute).toBe(50);
  });

  it('handles zero baseline — returns 100% delta and improved direction when current > 0', () => {
    const baseline = makeSnapshot({ clicks: 0 });
    const current = makeSnapshot({ clicks: 80 });
    const delta = computeDelta(baseline, current, 'clicks');
    expect(delta.delta_percent).toBe(100);
    expect(delta.delta_absolute).toBe(80);
    expect(delta.direction).toBe('improved');
  });

  it('returns correct delta_absolute and delta_percent for normal case', () => {
    const baseline = makeSnapshot({ clicks: 200 });
    const current = makeSnapshot({ clicks: 250 });
    const delta = computeDelta(baseline, current, 'clicks');
    expect(delta.delta_absolute).toBe(50);
    expect(delta.delta_percent).toBeCloseTo(25);
  });

  it('returns correct primary_metric in result', () => {
    const baseline = makeSnapshot({ clicks: 100 });
    const current = makeSnapshot({ clicks: 110 });
    const delta = computeDelta(baseline, current, 'clicks');
    expect(delta.primary_metric).toBe('clicks');
  });
});

// --- scoreOutcome ---

describe('scoreOutcome', () => {
  const makeClicksDelta = (overrides: Partial<DeltaSummary> = {}): DeltaSummary => ({
    primary_metric: 'clicks',
    baseline_value: 100,
    current_value: 150,
    delta_absolute: 50,
    delta_percent: 50,
    direction: 'improved',
    ...overrides,
  });

  const makePositionDelta = (overrides: Partial<DeltaSummary> = {}): DeltaSummary => ({
    primary_metric: 'position',
    baseline_value: 15,
    current_value: 5,
    delta_absolute: -10,
    delta_percent: -66.67,
    direction: 'improved',
    ...overrides,
  });

  it('returns earlySignal for 7-day checkpoint, score is null', () => {
    const delta = makeClicksDelta({ direction: 'improved' });
    const result = scoreOutcome('insight_acted_on', delta, 7, makeClicksConfig());
    expect(result.score).toBeNull();
    expect(result.earlySignal).toBeDefined();
  });

  it('returns on_track early signal for improved direction at 7-day checkpoint', () => {
    const delta = makeClicksDelta({ direction: 'improved' });
    const result = scoreOutcome('insight_acted_on', delta, 7, makeClicksConfig());
    expect(result.earlySignal).toBe('on_track');
  });

  it('returns no_movement early signal when stable and delta < 0.5% at 7-day checkpoint', () => {
    const delta = makeClicksDelta({
      direction: 'stable',
      delta_percent: 0.1,
    });
    const result = scoreOutcome('insight_acted_on', delta, 7, makeClicksConfig());
    expect(result.earlySignal).toBe('no_movement');
  });

  it('returns too_early for declined direction at 7-day checkpoint', () => {
    const delta = makeClicksDelta({ direction: 'declined', delta_percent: -20 });
    const result = scoreOutcome('insight_acted_on', delta, 7, makeClicksConfig());
    expect(result.earlySignal).toBe('too_early');
  });

  it('returns strong_win for large improvement at 30-day checkpoint', () => {
    const delta = makeClicksDelta({ delta_percent: 40 }); // >= strong_win threshold of 30
    const result = scoreOutcome('insight_acted_on', delta, 30, makeClicksConfig());
    expect(result.score).toBe('strong_win');
    expect(result.earlySignal).toBeUndefined();
  });

  it('returns win for moderate improvement at 30-day checkpoint', () => {
    const delta = makeClicksDelta({ delta_percent: 20 }); // >= win (15), < strong_win (30)
    const result = scoreOutcome('insight_acted_on', delta, 30, makeClicksConfig());
    expect(result.score).toBe('win');
  });

  it('returns neutral when within neutral band at 30-day checkpoint', () => {
    const delta = makeClicksDelta({ delta_percent: 5, direction: 'improved' }); // <= neutral_band of 10
    const result = scoreOutcome('insight_acted_on', delta, 30, makeClicksConfig());
    expect(result.score).toBe('neutral');
  });

  it('returns loss for decline at 30-day checkpoint', () => {
    const delta = makeClicksDelta({ delta_percent: -20, direction: 'declined' }); // outside neutral band, negative
    const result = scoreOutcome('insight_acted_on', delta, 30, makeClicksConfig());
    expect(result.score).toBe('loss');
  });

  it('scores position decrease as improvement (lower is better)', () => {
    // Position drops from 15 to 5: delta_percent = -66.67 → effectivePercent = +66.67 → strong_win
    const result = scoreOutcome('content_published', makePositionDelta(), 30, DEFAULT_CONFIG);
    expect(result.score).toBe('strong_win');
  });

  it('scores position increase as loss (higher position = worse ranking)', () => {
    const delta: DeltaSummary = {
      primary_metric: 'position',
      baseline_value: 5,
      current_value: 20,
      delta_absolute: 15,
      delta_percent: 300, // positive = got worse
      direction: 'declined',
    };
    const result = scoreOutcome('content_published', delta, 30, DEFAULT_CONFIG);
    // effectivePercent = -300 → well below neutral band → loss
    expect(result.score).toBe('loss');
  });

  it('handles 60-day and 90-day checkpoints with full score (not earlySignal)', () => {
    const delta = makeClicksDelta({ delta_percent: 40 });
    const result60 = scoreOutcome('insight_acted_on', delta, 60, makeClicksConfig());
    const result90 = scoreOutcome('insight_acted_on', delta, 90, makeClicksConfig());
    expect(result60.score).toBe('strong_win');
    expect(result60.earlySignal).toBeUndefined();
    expect(result90.score).toBe('strong_win');
    expect(result90.earlySignal).toBeUndefined();
  });
});

// --- isDueForCheckpoint ---

describe('isDueForCheckpoint', () => {
  beforeEach(() => {
    vi.mocked(getOutcomesForAction).mockReturnValue([]);
  });

  it('returns false when not enough days have elapsed', () => {
    const action = makeAction({
      createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(), // 5 days ago
    });
    expect(isDueForCheckpoint(action, 7)).toBe(false);
  });

  it('returns true when enough days have elapsed and no prior outcome', () => {
    const action = makeAction({
      createdAt: new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString(), // 35 days ago
    });
    vi.mocked(getOutcomesForAction).mockReturnValue([]);
    expect(isDueForCheckpoint(action, 30)).toBe(true);
  });

  it('returns false if the checkpoint outcome already exists', () => {
    const action = makeAction({
      createdAt: new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString(), // 35 days ago
    });
    vi.mocked(getOutcomesForAction).mockReturnValue([
      {
        id: 'ao-001',
        actionId: action.id,
        checkpointDays: 30,
        metricsSnapshot: makeSnapshot(),
        score: 'win',
        deltaSummary: {
          primary_metric: 'clicks',
          baseline_value: 100,
          current_value: 130,
          delta_absolute: 30,
          delta_percent: 30,
          direction: 'improved',
        },
        competitorContext: null,
        measuredAt: new Date().toISOString(),
      },
    ]);
    expect(isDueForCheckpoint(action, 30)).toBe(false);
  });

  it('returns false for 30-day checkpoint when only 10 days have elapsed', () => {
    const action = makeAction({
      createdAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(), // 10 days ago
    });
    expect(isDueForCheckpoint(action, 30)).toBe(false);
  });
});
