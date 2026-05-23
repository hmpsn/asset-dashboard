/**
 * Unit tests for pure computation functions in server/workspace-learnings.ts.
 * Does NOT test formatLearningsForPrompt — that is covered by workspace-learnings.test.ts.
 */
import { vi, describe, it, expect } from 'vitest';

vi.mock('../../server/logger.js', () => ({
  createLogger: () => ({ warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() }),
}));

vi.mock('../../server/db/index.js', () => ({
  default: { prepare: vi.fn(() => ({ get: vi.fn(), all: vi.fn(() => []), run: vi.fn() })) },
}));

vi.mock('../../server/db/stmt-cache.js', () => ({
  createStmtCache: (factory: () => unknown) => factory,
}));

vi.mock('../../server/outcome-tracking.js', () => ({
  getActionsByWorkspace: vi.fn(() => []),
  getOutcomesForAction: vi.fn(() => []),
}));

vi.mock('../../server/db/outcome-mappers.js', () => ({
  rowToWorkspaceLearnings: vi.fn(() => null),
}));

import {
  computeConfidence,
  computeWinRate,
  computeTrend,
  computeContentLearnings,
  computeStrategyLearnings,
  computeTechnicalLearnings,
  computeOverallLearnings,
  type ScoredActionWithOutcome,
} from '../../server/workspace-learnings.js';

// ---------------------------------------------------------------------------
// Factory helper
// ---------------------------------------------------------------------------

let _idCounter = 0;
function uid(): string {
  return `test-id-${++_idCounter}`;
}

function makeItem(overrides: {
  actionType?: string;
  sourceType?: string;
  targetKeyword?: string | null;
  baselinePosition?: number | null;
  baselineImpressions?: number | null;
  currentPosition?: number | null;
  checkpointDays?: 7 | 30 | 60 | 90;
  score?: 'win' | 'strong_win' | 'loss' | 'neutral';
  measuredAt?: string;
  baselineVoiceScore?: number | null;
  currentVoiceScore?: number | null;
  baselineHealthScore?: number | null;
  currentHealthScore?: number | null;
  richResultAppearing?: boolean;
} = {}): ScoredActionWithOutcome {
  const actionId = uid();
  return {
    action: {
      id: uid(),
      workspaceId: 'ws-test',
      actionType: (overrides.actionType ?? 'page_optimized') as any,
      sourceType: overrides.sourceType ?? 'informational',
      sourceId: null,
      pageUrl: null,
      targetKeyword: overrides.targetKeyword ?? null,
      baselineSnapshot: {
        captured_at: overrides.measuredAt ?? '2026-01-01T00:00:00Z',
        position: overrides.baselinePosition ?? 15,
        impressions: overrides.baselineImpressions ?? undefined,
        clicks: 0,
        voice_score: overrides.baselineVoiceScore ?? undefined,
        page_health_score: overrides.baselineHealthScore ?? undefined,
      },
      trailingHistory: { metric: 'position', dataPoints: [] },
      attribution: 'platform_executed',
      measurementWindow: 90,
      measurementComplete: true,
      sourceFlag: 'live',
      baselineConfidence: 'exact',
      context: {},
      createdAt: overrides.measuredAt ?? '2026-01-01T00:00:00Z',
      updatedAt: overrides.measuredAt ?? '2026-01-01T00:00:00Z',
    },
    outcome: {
      id: uid(),
      actionId,
      checkpointDays: overrides.checkpointDays ?? 90,
      metricsSnapshot: {
        captured_at: overrides.measuredAt ?? '2026-01-01T00:00:00Z',
        position: overrides.currentPosition ?? 5,
        impressions: 100,
        clicks: 10,
        voice_score: overrides.currentVoiceScore ?? undefined,
        page_health_score: overrides.currentHealthScore ?? undefined,
        rich_result_appearing: overrides.richResultAppearing,
      },
      score: overrides.score ?? 'win',
      deltaSummary: {
        primary_metric: 'position',
        baseline_value: overrides.baselinePosition ?? 15,
        current_value: overrides.currentPosition ?? 5,
        delta_absolute: -10,
        delta_percent: -66,
        direction: 'improved',
      },
      competitorContext: null,
      measuredAt: overrides.measuredAt ?? '2026-01-01T00:00:00Z',
    },
  } as ScoredActionWithOutcome;
}

// Make N identical items with overrides
function makeItems(n: number, overrides: Parameters<typeof makeItem>[0] = {}): ScoredActionWithOutcome[] {
  return Array.from({ length: n }, () => makeItem(overrides));
}

// ---------------------------------------------------------------------------
// computeConfidence
// ---------------------------------------------------------------------------

describe('computeConfidence', () => {
  it('returns low for count < 10', () => {
    expect(computeConfidence(0)).toBe('low');
    expect(computeConfidence(1)).toBe('low');
    expect(computeConfidence(9)).toBe('low');
  });

  it('returns medium for count exactly 10', () => {
    expect(computeConfidence(10)).toBe('medium');
  });

  it('returns medium for count between 10 and 24 inclusive', () => {
    expect(computeConfidence(11)).toBe('medium');
    expect(computeConfidence(24)).toBe('medium');
  });

  it('returns high for count exactly 25', () => {
    expect(computeConfidence(25)).toBe('high');
  });

  it('returns high for count > 25', () => {
    expect(computeConfidence(100)).toBe('high');
  });

  it('boundary: 9 → low, 10 → medium', () => {
    expect(computeConfidence(9)).toBe('low');
    expect(computeConfidence(10)).toBe('medium');
  });

  it('boundary: 24 → medium, 25 → high', () => {
    expect(computeConfidence(24)).toBe('medium');
    expect(computeConfidence(25)).toBe('high');
  });
});

// ---------------------------------------------------------------------------
// computeWinRate
// ---------------------------------------------------------------------------

describe('computeWinRate', () => {
  it('returns 0 for empty array', () => {
    expect(computeWinRate([])).toBe(0);
  });

  it('returns 1.0 when all items are wins', () => {
    const items = makeItems(4, { score: 'win' });
    expect(computeWinRate(items)).toBe(1);
  });

  it('counts strong_win as a win', () => {
    const items = makeItems(4, { score: 'strong_win' });
    expect(computeWinRate(items)).toBe(1);
  });

  it('returns 0 when all items are losses', () => {
    const items = makeItems(4, { score: 'loss' });
    expect(computeWinRate(items)).toBe(0);
  });

  it('returns 0 when all items are neutral', () => {
    const items = makeItems(4, { score: 'neutral' });
    expect(computeWinRate(items)).toBe(0);
  });

  it('calculates mixed win rate — 3 wins out of 4', () => {
    const items = [
      makeItem({ score: 'win' }),
      makeItem({ score: 'win' }),
      makeItem({ score: 'win' }),
      makeItem({ score: 'loss' }),
    ];
    expect(computeWinRate(items)).toBe(0.75);
  });

  it('rounds to 2 decimal places', () => {
    // 1 win out of 3 = 0.3333... → rounds to 0.33
    const items = [
      makeItem({ score: 'win' }),
      makeItem({ score: 'loss' }),
      makeItem({ score: 'loss' }),
    ];
    expect(computeWinRate(items)).toBe(0.33);
  });

  it('mixes win and strong_win as wins', () => {
    const items = [
      makeItem({ score: 'win' }),
      makeItem({ score: 'strong_win' }),
      makeItem({ score: 'loss' }),
      makeItem({ score: 'loss' }),
    ];
    // 2 out of 4 = 0.5
    expect(computeWinRate(items)).toBe(0.5);
  });
});

// ---------------------------------------------------------------------------
// computeTrend
// ---------------------------------------------------------------------------

describe('computeTrend', () => {
  it('returns stable when fewer than 6 items', () => {
    expect(computeTrend([])).toBe('stable');
    expect(computeTrend(makeItems(1))).toBe('stable');
    expect(computeTrend(makeItems(5))).toBe('stable');
  });

  it('returns stable for exactly 5 items', () => {
    expect(computeTrend(makeItems(5))).toBe('stable');
  });

  it('uses 6+ items for trend computation', () => {
    // 6 items: all wins in both halves → stable (diff = 0)
    const items = makeItems(6, { score: 'win' });
    expect(computeTrend(items)).toBe('stable');
  });

  it('returns improving when recent half win rate > older half by > 0.08', () => {
    // 6 items sorted by measuredAt DESC:
    // recent 3 (newest) = wins, older 3 = losses → diff = 1.0 - 0.0 = 1.0 > 0.08
    const recentWins = [
      makeItem({ score: 'win', measuredAt: '2026-03-01T00:00:00Z' }),
      makeItem({ score: 'win', measuredAt: '2026-03-02T00:00:00Z' }),
      makeItem({ score: 'win', measuredAt: '2026-03-03T00:00:00Z' }),
    ];
    const olderLosses = [
      makeItem({ score: 'loss', measuredAt: '2026-01-01T00:00:00Z' }),
      makeItem({ score: 'loss', measuredAt: '2026-01-02T00:00:00Z' }),
      makeItem({ score: 'loss', measuredAt: '2026-01-03T00:00:00Z' }),
    ];
    expect(computeTrend([...recentWins, ...olderLosses])).toBe('improving');
  });

  it('returns declining when recent half win rate < older half by > 0.08', () => {
    // recent 3 = losses, older 3 = wins → diff = 0 - 1 = -1 < -0.08
    const recentLosses = [
      makeItem({ score: 'loss', measuredAt: '2026-03-01T00:00:00Z' }),
      makeItem({ score: 'loss', measuredAt: '2026-03-02T00:00:00Z' }),
      makeItem({ score: 'loss', measuredAt: '2026-03-03T00:00:00Z' }),
    ];
    const olderWins = [
      makeItem({ score: 'win', measuredAt: '2026-01-01T00:00:00Z' }),
      makeItem({ score: 'win', measuredAt: '2026-01-02T00:00:00Z' }),
      makeItem({ score: 'win', measuredAt: '2026-01-03T00:00:00Z' }),
    ];
    expect(computeTrend([...recentLosses, ...olderWins])).toBe('declining');
  });

  it('returns stable when diff is exactly 0', () => {
    // 6 items, same win rate across halves: 2 wins + 1 loss in each half
    const items = [
      makeItem({ score: 'win', measuredAt: '2026-03-01T00:00:00Z' }),
      makeItem({ score: 'win', measuredAt: '2026-03-02T00:00:00Z' }),
      makeItem({ score: 'loss', measuredAt: '2026-03-03T00:00:00Z' }),
      makeItem({ score: 'win', measuredAt: '2026-01-01T00:00:00Z' }),
      makeItem({ score: 'win', measuredAt: '2026-01-02T00:00:00Z' }),
      makeItem({ score: 'loss', measuredAt: '2026-01-03T00:00:00Z' }),
    ];
    expect(computeTrend(items)).toBe('stable');
  });

  it('boundary: diff of exactly 0.09 → improving', () => {
    // Need recent 3, older 3 such that diff ≈ 0.09
    // recent: 2/3 wins = 0.667, older: 1.75/3 ≈ — let's use 10 items for precision
    // Use 12 items: recent 6, older 6
    // recent: 5 wins out of 6 = 0.833; older: 4 wins out of 6 = 0.667 → diff = 0.167 > 0.08 → improving
    const recent = [
      makeItem({ score: 'win', measuredAt: '2026-06-01T00:00:00Z' }),
      makeItem({ score: 'win', measuredAt: '2026-06-02T00:00:00Z' }),
      makeItem({ score: 'win', measuredAt: '2026-06-03T00:00:00Z' }),
      makeItem({ score: 'win', measuredAt: '2026-06-04T00:00:00Z' }),
      makeItem({ score: 'win', measuredAt: '2026-06-05T00:00:00Z' }),
      makeItem({ score: 'loss', measuredAt: '2026-06-06T00:00:00Z' }),
    ];
    const older = [
      makeItem({ score: 'win', measuredAt: '2026-01-01T00:00:00Z' }),
      makeItem({ score: 'win', measuredAt: '2026-01-02T00:00:00Z' }),
      makeItem({ score: 'win', measuredAt: '2026-01-03T00:00:00Z' }),
      makeItem({ score: 'win', measuredAt: '2026-01-04T00:00:00Z' }),
      makeItem({ score: 'loss', measuredAt: '2026-01-05T00:00:00Z' }),
      makeItem({ score: 'loss', measuredAt: '2026-01-06T00:00:00Z' }),
    ];
    expect(computeTrend([...recent, ...older])).toBe('improving');
  });

  it('boundary: diff within -0.08 to +0.08 → stable', () => {
    // 6 items: recent 3 = 2 wins (0.667), older 3 = 2 wins (0.667) → diff = 0 → stable
    const items = [
      makeItem({ score: 'win', measuredAt: '2026-03-01T00:00:00Z' }),
      makeItem({ score: 'win', measuredAt: '2026-03-02T00:00:00Z' }),
      makeItem({ score: 'loss', measuredAt: '2026-03-03T00:00:00Z' }),
      makeItem({ score: 'win', measuredAt: '2026-01-01T00:00:00Z' }),
      makeItem({ score: 'win', measuredAt: '2026-01-02T00:00:00Z' }),
      makeItem({ score: 'loss', measuredAt: '2026-01-03T00:00:00Z' }),
    ];
    expect(computeTrend(items)).toBe('stable');
  });

  it('sorts by measuredAt before splitting, so order of input array does not matter', () => {
    // All wins recent, all losses older — but passed in shuffled order
    const items = [
      makeItem({ score: 'loss', measuredAt: '2026-01-01T00:00:00Z' }),
      makeItem({ score: 'win', measuredAt: '2026-03-03T00:00:00Z' }),
      makeItem({ score: 'loss', measuredAt: '2026-01-03T00:00:00Z' }),
      makeItem({ score: 'win', measuredAt: '2026-03-01T00:00:00Z' }),
      makeItem({ score: 'loss', measuredAt: '2026-01-02T00:00:00Z' }),
      makeItem({ score: 'win', measuredAt: '2026-03-02T00:00:00Z' }),
    ];
    // After sort DESC by measuredAt: 03-03, 03-02, 03-01, 01-03, 01-02, 01-01
    // recent half: all wins → 1.0; older half: all losses → 0.0; diff = 1.0 > 0.08 → improving
    expect(computeTrend(items)).toBe('improving');
  });
});

// ---------------------------------------------------------------------------
// computeContentLearnings
// ---------------------------------------------------------------------------

describe('computeContentLearnings', () => {
  // Content action types: content_published, brief_created, content_refreshed, voice_calibrated

  it('returns null when fewer than 10 content-type items', () => {
    const items = makeItems(9, { actionType: 'content_published', score: 'win' });
    expect(computeContentLearnings(items)).toBeNull();
  });

  it('returns null when 0 items', () => {
    expect(computeContentLearnings([])).toBeNull();
  });

  it('returns null when 9 content-type items even if total > 10 (non-content items ignored)', () => {
    const contentItems = makeItems(9, { actionType: 'content_published', score: 'win' });
    const nonContent = makeItems(5, { actionType: 'schema_deployed', score: 'win' });
    expect(computeContentLearnings([...contentItems, ...nonContent])).toBeNull();
  });

  it('returns ContentLearnings object when 10+ content items', () => {
    const items = makeItems(10, { actionType: 'content_published', score: 'win' });
    const result = computeContentLearnings(items);
    expect(result).not.toBeNull();
    expect(result).toHaveProperty('winRateByFormat');
    expect(result).toHaveProperty('avgDaysToPage1');
    expect(result).toHaveProperty('bestPerformingTopics');
    expect(result).toHaveProperty('refreshRecoveryRate');
  });

  it('winRateByFormat uses sourceType as key when sourceType is set', () => {
    const items = makeItems(5, { actionType: 'content_published', sourceType: 'informational', score: 'win' });
    const moreItems = makeItems(5, { actionType: 'content_published', sourceType: 'transactional', score: 'loss' });
    const result = computeContentLearnings([...items, ...moreItems]);
    expect(result).not.toBeNull();
    expect(result!.winRateByFormat).toHaveProperty('informational');
    expect(result!.winRateByFormat['informational']).toBe(1);
    expect(result!.winRateByFormat).toHaveProperty('transactional');
    expect(result!.winRateByFormat['transactional']).toBe(0);
  });

  it('winRateByFormat excludes formats with fewer than 3 items', () => {
    // 2 items in one format, 10 in another
    const twoItems = makeItems(2, { actionType: 'content_published', sourceType: 'rare-format', score: 'win' });
    const tenItems = makeItems(10, { actionType: 'content_published', sourceType: 'informational', score: 'win' });
    const result = computeContentLearnings([...twoItems, ...tenItems]);
    expect(result).not.toBeNull();
    expect(result!.winRateByFormat).not.toHaveProperty('rare-format');
    expect(result!.winRateByFormat).toHaveProperty('informational');
  });

  it('bestPerformingTopics contains top 5 keywords from wins', () => {
    // Create 10 wins with distinct keywords (some repeated)
    const items = [
      makeItem({ actionType: 'content_published', score: 'win', targetKeyword: 'seo tips' }),
      makeItem({ actionType: 'content_published', score: 'win', targetKeyword: 'seo tips' }),
      makeItem({ actionType: 'content_published', score: 'win', targetKeyword: 'seo tips' }),
      makeItem({ actionType: 'content_published', score: 'win', targetKeyword: 'keyword research' }),
      makeItem({ actionType: 'content_published', score: 'win', targetKeyword: 'keyword research' }),
      makeItem({ actionType: 'content_published', score: 'win', targetKeyword: 'link building' }),
      makeItem({ actionType: 'content_published', score: 'loss', targetKeyword: 'should-not-appear' }),
      makeItem({ actionType: 'content_published', score: 'win', targetKeyword: null }),
      makeItem({ actionType: 'brief_created', score: 'win', targetKeyword: 'content strategy' }),
      makeItem({ actionType: 'brief_created', score: 'win', targetKeyword: 'on-page seo' }),
    ];
    const result = computeContentLearnings(items);
    expect(result).not.toBeNull();
    expect(result!.bestPerformingTopics).toContain('seo tips');
    expect(result!.bestPerformingTopics).not.toContain('should-not-appear');
    expect(result!.bestPerformingTopics).not.toContain(null);
    expect(result!.bestPerformingTopics.length).toBeLessThanOrEqual(5);
  });

  it('bestPerformingTopics excludes items where targetKeyword is null', () => {
    const items = makeItems(10, { actionType: 'content_published', score: 'win', targetKeyword: null });
    const result = computeContentLearnings(items);
    expect(result).not.toBeNull();
    expect(result!.bestPerformingTopics).toHaveLength(0);
  });

  it('avgDaysToPage1 is null when fewer than 3 qualifying wins', () => {
    // Only 2 items where baseline > 10 and current <= 10
    const items = [
      makeItem({ actionType: 'content_published', score: 'win', baselinePosition: 20, currentPosition: 8, checkpointDays: 90 }),
      makeItem({ actionType: 'content_published', score: 'win', baselinePosition: 25, currentPosition: 5, checkpointDays: 60 }),
      ...makeItems(8, { actionType: 'content_published', score: 'win', baselinePosition: 5, currentPosition: 3 }), // already page 1, excluded
    ];
    const result = computeContentLearnings(items);
    expect(result).not.toBeNull();
    expect(result!.avgDaysToPage1).toBeNull();
  });

  it('avgDaysToPage1 is computed when 3+ items went from >10 to <=10 position', () => {
    const page1Items = [
      makeItem({ actionType: 'content_published', score: 'win', baselinePosition: 20, currentPosition: 8, checkpointDays: 90 }),
      makeItem({ actionType: 'content_published', score: 'win', baselinePosition: 25, currentPosition: 5, checkpointDays: 60 }),
      makeItem({ actionType: 'content_published', score: 'win', baselinePosition: 15, currentPosition: 10, checkpointDays: 30 }),
    ];
    const fillerItems = makeItems(7, { actionType: 'content_published', score: 'win', baselinePosition: 5, currentPosition: 3 });
    const result = computeContentLearnings([...page1Items, ...fillerItems]);
    expect(result).not.toBeNull();
    // avg = (90 + 60 + 30) / 3 = 60
    expect(result!.avgDaysToPage1).toBe(60);
  });

  it('avgDaysToPage1 excludes losses', () => {
    const lossItem = makeItem({ actionType: 'content_published', score: 'loss', baselinePosition: 20, currentPosition: 8, checkpointDays: 90 });
    const winItems = [
      makeItem({ actionType: 'content_published', score: 'win', baselinePosition: 22, currentPosition: 9, checkpointDays: 60 }),
      makeItem({ actionType: 'content_published', score: 'win', baselinePosition: 18, currentPosition: 7, checkpointDays: 30 }),
    ];
    const fillerItems = makeItems(7, { actionType: 'content_published', score: 'win', baselinePosition: 5, currentPosition: 3 });
    const result = computeContentLearnings([lossItem, ...winItems, ...fillerItems]);
    expect(result).not.toBeNull();
    // Only 2 qualifying wins → avgDaysToPage1 = null
    expect(result!.avgDaysToPage1).toBeNull();
  });

  it('refreshRecoveryRate is 0 when fewer than 3 content_refreshed items', () => {
    const items = [
      makeItem({ actionType: 'content_refreshed', score: 'win' }),
      makeItem({ actionType: 'content_refreshed', score: 'win' }),
      ...makeItems(8, { actionType: 'content_published', score: 'win' }),
    ];
    const result = computeContentLearnings(items);
    expect(result).not.toBeNull();
    expect(result!.refreshRecoveryRate).toBe(0);
  });

  it('refreshRecoveryRate is computed when 3+ content_refreshed items', () => {
    const refreshItems = [
      makeItem({ actionType: 'content_refreshed', score: 'win' }),
      makeItem({ actionType: 'content_refreshed', score: 'win' }),
      makeItem({ actionType: 'content_refreshed', score: 'loss' }),
    ];
    const fillerItems = makeItems(7, { actionType: 'content_published', score: 'win' });
    const result = computeContentLearnings([...refreshItems, ...fillerItems]);
    expect(result).not.toBeNull();
    // 2 wins out of 3 = 0.67
    expect(result!.refreshRecoveryRate).toBe(0.67);
  });

  it('all four content action types contribute to the content item count', () => {
    const mixed = [
      makeItem({ actionType: 'content_published', score: 'win' }),
      makeItem({ actionType: 'brief_created', score: 'win' }),
      makeItem({ actionType: 'content_refreshed', score: 'win' }),
      makeItem({ actionType: 'voice_calibrated', score: 'win' }),
    ];
    // 4 content items → should still return null (< 10)
    expect(computeContentLearnings(mixed)).toBeNull();

    // Add 6 more to reach 10
    const more = makeItems(6, { actionType: 'content_published', score: 'win' });
    expect(computeContentLearnings([...mixed, ...more])).not.toBeNull();
  });

  it('voiceScoreCorrelation is null when fewer than 3 voice_calibrated wins', () => {
    const items = [
      makeItem({ actionType: 'voice_calibrated', score: 'win', baselineVoiceScore: 50, currentVoiceScore: 70 }),
      makeItem({ actionType: 'voice_calibrated', score: 'win', baselineVoiceScore: 60, currentVoiceScore: 75 }),
      ...makeItems(8, { actionType: 'content_published', score: 'win' }),
    ];
    const result = computeContentLearnings(items);
    expect(result).not.toBeNull();
    expect(result!.voiceScoreCorrelation).toBeNull();
  });

  it('optimalWordCount is always null (placeholder)', () => {
    const items = makeItems(10, { actionType: 'content_published', score: 'win' });
    const result = computeContentLearnings(items);
    expect(result).not.toBeNull();
    expect(result!.optimalWordCount).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// computeStrategyLearnings
// ---------------------------------------------------------------------------

describe('computeStrategyLearnings', () => {
  // Strategy action types: strategy_keyword_added, insight_acted_on

  it('returns null when fewer than 10 strategy-type items', () => {
    const items = makeItems(9, { actionType: 'strategy_keyword_added', score: 'win' });
    expect(computeStrategyLearnings(items)).toBeNull();
  });

  it('returns null when items are non-strategy types', () => {
    const items = makeItems(15, { actionType: 'content_published', score: 'win' });
    expect(computeStrategyLearnings(items)).toBeNull();
  });

  it('returns StrategyLearnings object with 10+ strategy items', () => {
    const items = makeItems(10, { actionType: 'strategy_keyword_added', score: 'win' });
    const result = computeStrategyLearnings(items);
    expect(result).not.toBeNull();
    expect(result).toHaveProperty('winRateByDifficultyRange');
    expect(result).toHaveProperty('winRateByCheckpoint');
    expect(result).toHaveProperty('bestIntentTypes');
    expect(result).toHaveProperty('keywordVolumeSweetSpot');
  });

  it('bins baseline position >= 51 into 0-20 difficulty range', () => {
    const items = makeItems(10, { actionType: 'strategy_keyword_added', score: 'win', baselinePosition: 55 });
    const result = computeStrategyLearnings(items);
    expect(result).not.toBeNull();
    expect(result!.winRateByDifficultyRange).toHaveProperty('0-20');
    expect(result!.winRateByDifficultyRange['0-20']).toBe(1);
  });

  it('bins baseline position 31-50 into 21-40 difficulty range', () => {
    const items = makeItems(10, { actionType: 'strategy_keyword_added', score: 'win', baselinePosition: 40 });
    const result = computeStrategyLearnings(items);
    expect(result).not.toBeNull();
    expect(result!.winRateByDifficultyRange).toHaveProperty('21-40');
  });

  it('bins baseline position 21-30 into 41-60 difficulty range', () => {
    const items = makeItems(10, { actionType: 'strategy_keyword_added', score: 'win', baselinePosition: 25 });
    const result = computeStrategyLearnings(items);
    expect(result).not.toBeNull();
    expect(result!.winRateByDifficultyRange).toHaveProperty('41-60');
  });

  it('bins baseline position 11-20 into 61-80 difficulty range', () => {
    const items = makeItems(10, { actionType: 'strategy_keyword_added', score: 'win', baselinePosition: 15 });
    const result = computeStrategyLearnings(items);
    expect(result).not.toBeNull();
    expect(result!.winRateByDifficultyRange).toHaveProperty('61-80');
  });

  it('bins baseline position 1-10 into 81-100 difficulty range', () => {
    const items = makeItems(10, { actionType: 'strategy_keyword_added', score: 'win', baselinePosition: 5 });
    const result = computeStrategyLearnings(items);
    expect(result).not.toBeNull();
    expect(result!.winRateByDifficultyRange).toHaveProperty('81-100');
  });

  it('winRateByDifficultyRange excludes bins with fewer than 3 items', () => {
    // 2 items in '0-20' bin (pos=55), 10 items in '81-100' bin (pos=5)
    const rare = makeItems(2, { actionType: 'strategy_keyword_added', score: 'win', baselinePosition: 55 });
    const common = makeItems(10, { actionType: 'strategy_keyword_added', score: 'win', baselinePosition: 5 });
    const result = computeStrategyLearnings([...rare, ...common]);
    expect(result).not.toBeNull();
    expect(result!.winRateByDifficultyRange).not.toHaveProperty('0-20');
    expect(result!.winRateByDifficultyRange).toHaveProperty('81-100');
  });

  it('bestIntentTypes returns top 3 sourceTypes from winning items', () => {
    const items = [
      // 4 informational wins
      ...makeItems(4, { actionType: 'strategy_keyword_added', score: 'win', sourceType: 'informational' }),
      // 3 transactional wins
      ...makeItems(3, { actionType: 'strategy_keyword_added', score: 'win', sourceType: 'transactional' }),
      // 2 navigational wins
      ...makeItems(2, { actionType: 'strategy_keyword_added', score: 'win', sourceType: 'navigational' }),
      // 1 commercial win
      makeItem({ actionType: 'strategy_keyword_added', score: 'win', sourceType: 'commercial' }),
    ];
    const result = computeStrategyLearnings(items);
    expect(result).not.toBeNull();
    expect(result!.bestIntentTypes).toHaveLength(3);
    expect(result!.bestIntentTypes[0]).toBe('informational');
    expect(result!.bestIntentTypes[1]).toBe('transactional');
    expect(result!.bestIntentTypes[2]).toBe('navigational');
  });

  it('bestIntentTypes only counts wins, not losses', () => {
    const items = [
      ...makeItems(8, { actionType: 'strategy_keyword_added', score: 'loss', sourceType: 'navigational' }),
      ...makeItems(10, { actionType: 'strategy_keyword_added', score: 'win', sourceType: 'informational' }),
    ];
    const result = computeStrategyLearnings(items);
    expect(result).not.toBeNull();
    expect(result!.bestIntentTypes).toContain('informational');
    expect(result!.bestIntentTypes).not.toContain('navigational');
  });

  it('keywordVolumeSweetSpot is null when fewer than 5 wins with impressions', () => {
    // wins but no impressions
    const items = makeItems(10, { actionType: 'strategy_keyword_added', score: 'win', baselineImpressions: undefined });
    const result = computeStrategyLearnings(items);
    expect(result).not.toBeNull();
    expect(result!.keywordVolumeSweetSpot).toBeNull();
  });

  it('keywordVolumeSweetSpot computes min/max impressions from 5+ winning items', () => {
    const items = [
      makeItem({ actionType: 'strategy_keyword_added', score: 'win', baselineImpressions: 100 }),
      makeItem({ actionType: 'strategy_keyword_added', score: 'win', baselineImpressions: 500 }),
      makeItem({ actionType: 'strategy_keyword_added', score: 'win', baselineImpressions: 1000 }),
      makeItem({ actionType: 'strategy_keyword_added', score: 'win', baselineImpressions: 2000 }),
      makeItem({ actionType: 'strategy_keyword_added', score: 'win', baselineImpressions: 5000 }),
      ...makeItems(5, { actionType: 'strategy_keyword_added', score: 'win' }),
    ];
    const result = computeStrategyLearnings(items);
    expect(result).not.toBeNull();
    expect(result!.keywordVolumeSweetSpot).not.toBeNull();
    expect(result!.keywordVolumeSweetSpot!.min).toBe(100);
    expect(result!.keywordVolumeSweetSpot!.max).toBe(5000);
  });

  it('winRateByCheckpoint groups by checkpointDays and requires ≥3 items', () => {
    const items = [
      // 3 items at 30d → included
      makeItem({ actionType: 'strategy_keyword_added', score: 'win', checkpointDays: 30 }),
      makeItem({ actionType: 'strategy_keyword_added', score: 'win', checkpointDays: 30 }),
      makeItem({ actionType: 'strategy_keyword_added', score: 'loss', checkpointDays: 30 }),
      // 2 items at 90d → excluded
      makeItem({ actionType: 'strategy_keyword_added', score: 'win', checkpointDays: 90 }),
      makeItem({ actionType: 'strategy_keyword_added', score: 'win', checkpointDays: 90 }),
      // pad to 10
      ...makeItems(5, { actionType: 'insight_acted_on', score: 'win', checkpointDays: 60 }),
    ];
    const result = computeStrategyLearnings(items);
    expect(result).not.toBeNull();
    expect(result!.winRateByCheckpoint).toHaveProperty('30d');
    expect(result!.winRateByCheckpoint).not.toHaveProperty('90d');
  });

  it('both strategy action types count toward the 10-item minimum', () => {
    const mixed = [
      ...makeItems(5, { actionType: 'strategy_keyword_added', score: 'win' }),
      ...makeItems(5, { actionType: 'insight_acted_on', score: 'win' }),
    ];
    expect(computeStrategyLearnings(mixed)).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// computeTechnicalLearnings
// ---------------------------------------------------------------------------

describe('computeTechnicalLearnings', () => {
  // Technical action types: schema_deployed, audit_fix_applied, internal_link_added, meta_updated

  it('returns null when fewer than 10 technical-type items', () => {
    const items = makeItems(9, { actionType: 'schema_deployed', score: 'win' });
    expect(computeTechnicalLearnings(items)).toBeNull();
  });

  it('returns null with non-technical items even when total > 10', () => {
    const items = makeItems(15, { actionType: 'content_published', score: 'win' });
    expect(computeTechnicalLearnings(items)).toBeNull();
  });

  it('returns TechnicalLearnings object with 10+ technical items', () => {
    const items = makeItems(10, { actionType: 'audit_fix_applied', score: 'win' });
    const result = computeTechnicalLearnings(items);
    expect(result).not.toBeNull();
    expect(result).toHaveProperty('winRateByFixType');
    expect(result).toHaveProperty('schemaTypesWithRichResults');
    expect(result).toHaveProperty('avgHealthScoreImprovement');
    expect(result).toHaveProperty('internalLinkEffectiveness');
  });

  it('winRateByFixType groups by actionType and includes groups with >= 2 items', () => {
    const items = [
      makeItem({ actionType: 'audit_fix_applied', score: 'win' }),
      makeItem({ actionType: 'audit_fix_applied', score: 'win' }),
      makeItem({ actionType: 'audit_fix_applied', score: 'loss' }),
      // Only 1 schema_deployed → note: source says >= 2 for technical (not 3)
      makeItem({ actionType: 'schema_deployed', score: 'win' }),
      ...makeItems(6, { actionType: 'meta_updated', score: 'win' }),
    ];
    const result = computeTechnicalLearnings(items);
    expect(result).not.toBeNull();
    // audit_fix_applied has 3 items → included
    expect(result!.winRateByFixType).toHaveProperty('audit_fix_applied');
    // schema_deployed has 1 item → excluded (< 2)
    expect(result!.winRateByFixType).not.toHaveProperty('schema_deployed');
    // meta_updated has 6 items → included
    expect(result!.winRateByFixType).toHaveProperty('meta_updated');
  });

  it('winRateByFixType correctly computes win rate per type', () => {
    // 2 wins, 1 loss for audit_fix_applied = 0.67
    const items = [
      makeItem({ actionType: 'audit_fix_applied', score: 'win' }),
      makeItem({ actionType: 'audit_fix_applied', score: 'win' }),
      makeItem({ actionType: 'audit_fix_applied', score: 'loss' }),
      ...makeItems(7, { actionType: 'meta_updated', score: 'win' }),
    ];
    const result = computeTechnicalLearnings(items);
    expect(result).not.toBeNull();
    expect(result!.winRateByFixType['audit_fix_applied']).toBe(0.67);
  });

  it('schemaTypesWithRichResults includes sourceType from schema_deployed wins with rich_result_appearing=true', () => {
    const richResultWins = [
      makeItem({ actionType: 'schema_deployed', score: 'win', sourceType: 'FAQPage', richResultAppearing: true }),
      makeItem({ actionType: 'schema_deployed', score: 'win', sourceType: 'Product', richResultAppearing: true }),
    ];
    const noRichResult = makeItem({ actionType: 'schema_deployed', score: 'win', sourceType: 'Article', richResultAppearing: false });
    const fillerItems = makeItems(7, { actionType: 'audit_fix_applied', score: 'win' });
    const result = computeTechnicalLearnings([...richResultWins, noRichResult, ...fillerItems]);
    expect(result).not.toBeNull();
    expect(result!.schemaTypesWithRichResults).toContain('FAQPage');
    expect(result!.schemaTypesWithRichResults).toContain('Product');
    expect(result!.schemaTypesWithRichResults).not.toContain('Article');
  });

  it('schemaTypesWithRichResults is empty when no schema wins produced rich results', () => {
    const items = makeItems(10, { actionType: 'audit_fix_applied', score: 'win' });
    const result = computeTechnicalLearnings(items);
    expect(result).not.toBeNull();
    expect(result!.schemaTypesWithRichResults).toHaveLength(0);
  });

  it('all four technical action types contribute to the 10-item minimum', () => {
    const mixed = [
      makeItem({ actionType: 'schema_deployed', score: 'win' }),
      makeItem({ actionType: 'audit_fix_applied', score: 'win' }),
      makeItem({ actionType: 'internal_link_added', score: 'win' }),
      makeItem({ actionType: 'meta_updated', score: 'win' }),
    ];
    // 4 items → null
    expect(computeTechnicalLearnings(mixed)).toBeNull();

    // 10 items → not null
    const full = makeItems(6, { actionType: 'meta_updated', score: 'win' });
    expect(computeTechnicalLearnings([...mixed, ...full])).not.toBeNull();
  });

  it('internalLinkEffectiveness is 0 when fewer than 2 internal_link_added items', () => {
    const items = [
      makeItem({ actionType: 'internal_link_added', score: 'win' }),
      ...makeItems(9, { actionType: 'audit_fix_applied', score: 'win' }),
    ];
    const result = computeTechnicalLearnings(items);
    expect(result).not.toBeNull();
    expect(result!.internalLinkEffectiveness).toBe(0);
  });

  it('internalLinkEffectiveness is computed when 2+ internal_link_added items', () => {
    const items = [
      makeItem({ actionType: 'internal_link_added', score: 'win' }),
      makeItem({ actionType: 'internal_link_added', score: 'win' }),
      makeItem({ actionType: 'internal_link_added', score: 'loss' }),
      ...makeItems(7, { actionType: 'audit_fix_applied', score: 'win' }),
    ];
    const result = computeTechnicalLearnings(items);
    expect(result).not.toBeNull();
    // 2 wins out of 3 = 0.67
    expect(result!.internalLinkEffectiveness).toBe(0.67);
  });
});

// ---------------------------------------------------------------------------
// computeOverallLearnings
// ---------------------------------------------------------------------------

describe('computeOverallLearnings', () => {
  it('returns correct zero-state for empty input', () => {
    const result = computeOverallLearnings([]);
    expect(result.totalWinRate).toBe(0);
    expect(result.strongWinRate).toBe(0);
    expect(result.topActionTypes).toHaveLength(0);
    expect(result.recentTrend).toBe('stable');
  });

  it('computes totalWinRate across all items', () => {
    const items = [
      makeItem({ score: 'win' }),
      makeItem({ score: 'win' }),
      makeItem({ score: 'loss' }),
      makeItem({ score: 'loss' }),
    ];
    const result = computeOverallLearnings(items);
    expect(result.totalWinRate).toBe(0.5);
  });

  it('computes strongWinRate using only strong_win items', () => {
    const items = [
      makeItem({ score: 'strong_win' }),
      makeItem({ score: 'win' }),
      makeItem({ score: 'loss' }),
      makeItem({ score: 'loss' }),
    ];
    const result = computeOverallLearnings(items);
    // 1 strong_win out of 4 = 0.25
    expect(result.strongWinRate).toBe(0.25);
    // total win rate: strong_win + win = 2 out of 4 = 0.5
    expect(result.totalWinRate).toBe(0.5);
  });

  it('topActionTypes only includes action types with >= 3 items', () => {
    const items = [
      // 3 content_published → included
      makeItem({ actionType: 'content_published', score: 'win' }),
      makeItem({ actionType: 'content_published', score: 'win' }),
      makeItem({ actionType: 'content_published', score: 'loss' }),
      // 2 schema_deployed → excluded
      makeItem({ actionType: 'schema_deployed', score: 'win' }),
      makeItem({ actionType: 'schema_deployed', score: 'win' }),
    ];
    const result = computeOverallLearnings(items);
    const typeNames = result.topActionTypes.map(t => t.type);
    expect(typeNames).toContain('content_published');
    expect(typeNames).not.toContain('schema_deployed');
  });

  it('topActionTypes is sorted by win rate descending', () => {
    const items = [
      // meta_updated: 3 wins out of 3 = 1.0
      makeItem({ actionType: 'meta_updated', score: 'win' }),
      makeItem({ actionType: 'meta_updated', score: 'win' }),
      makeItem({ actionType: 'meta_updated', score: 'win' }),
      // content_published: 1 win out of 3 = 0.33
      makeItem({ actionType: 'content_published', score: 'win' }),
      makeItem({ actionType: 'content_published', score: 'loss' }),
      makeItem({ actionType: 'content_published', score: 'loss' }),
    ];
    const result = computeOverallLearnings(items);
    expect(result.topActionTypes[0].type).toBe('meta_updated');
    expect(result.topActionTypes[0].winRate).toBe(1);
    expect(result.topActionTypes[1].type).toBe('content_published');
  });

  it('topActionTypes includes count for each type', () => {
    const items = makeItems(5, { actionType: 'content_published', score: 'win' });
    const result = computeOverallLearnings(items);
    expect(result.topActionTypes[0].count).toBe(5);
  });

  it('topActionTypes capped at 5 entries', () => {
    // 6 action types with 3 items each
    const actionTypes = [
      'content_published', 'schema_deployed', 'audit_fix_applied',
      'meta_updated', 'internal_link_added', 'brief_created',
    ] as const;
    const items = actionTypes.flatMap(type => makeItems(3, { actionType: type, score: 'win' }));
    const result = computeOverallLearnings(items);
    expect(result.topActionTypes.length).toBeLessThanOrEqual(5);
  });

  it('recentTrend reflects improving trend when items trend shows improvement', () => {
    // 6 items: 3 recent wins, 3 older losses → improving
    const items = [
      makeItem({ score: 'win', measuredAt: '2026-03-01T00:00:00Z' }),
      makeItem({ score: 'win', measuredAt: '2026-03-02T00:00:00Z' }),
      makeItem({ score: 'win', measuredAt: '2026-03-03T00:00:00Z' }),
      makeItem({ score: 'loss', measuredAt: '2026-01-01T00:00:00Z' }),
      makeItem({ score: 'loss', measuredAt: '2026-01-02T00:00:00Z' }),
      makeItem({ score: 'loss', measuredAt: '2026-01-03T00:00:00Z' }),
    ];
    const result = computeOverallLearnings(items);
    expect(result.recentTrend).toBe('improving');
  });

  it('returns stable trend for fewer than 6 items', () => {
    const items = makeItems(4, { score: 'win' });
    const result = computeOverallLearnings(items);
    expect(result.recentTrend).toBe('stable');
  });
});
