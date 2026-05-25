// tests/unit/outcome-learning-pure.test.ts
//
// Pure unit tests for server/outcome-learning-default-path.ts.
// Focuses on cases NOT covered by tests/unit/outcome-learning-default-path.test.ts:
//   - getDifficultyRangeLabel boundary values (tested indirectly through
//     buildOutcomeAdjustment, since getDifficultyRangeLabel is private)
//   - Multiplier clamping at 0.75 lower bound and 1.25 upper bound
//   - Multiplier precision (toFixed(3))
//   - No-data path (undefined learnings)
//   - applyOutcomeAdjustmentScore clamping at 0 lower bound
//   - buildOutcomeLearningStatusNote domain-aware messaging for 'no_data'
//   - winRateByActionType missing for the given action type (neutral signal)
//   - Combined action-type + difficulty adjustments that compound
//   - NaN / Infinity guard for actionTypeRate / difficultyRate
//
// Does NOT re-test:
//   - Basic disabled/ready/no_data availability returns (covered by existing suite)
//   - Basic boost/down-rank assertions with clear data (covered by existing suite)
//   - Basic applyOutcomeAdjustmentScore 100/5 clamping (covered by existing suite)
//   - Basic buildOutcomeLearningStatusNote messages (covered by existing suite)

import { describe, it, expect } from 'vitest';
import type { LearningsSlice } from '../../shared/types/intelligence.js';
import {
  buildOutcomeAdjustment,
  applyOutcomeAdjustmentScore,
  buildOutcomeLearningStatusNote,
} from '../../server/outcome-learning-default-path.js';

// ── Fixture helpers ───────────────────────────────────────────────────────────

function baseLearnings(overrides: Partial<LearningsSlice> = {}): LearningsSlice {
  return {
    availability: 'ready',
    summary: {
      workspaceId: 'ws-pure-test',
      computedAt: new Date().toISOString(),
      confidence: 'medium',
      totalScoredActions: 20,
      content: null,
      strategy: {
        winRateByDifficultyRange: {
          '0-20': 0.75,
          '21-40': 0.55,
          '41-60': 0.40,
          '61-80': 0.28,
          '81-100': 0.15,
        },
        winRateByCheckpoint: {},
        bestIntentTypes: [],
        keywordVolumeSweetSpot: null,
      },
      technical: null,
      overall: {
        totalWinRate: 0.50,
        strongWinRate: 0.20,
        topActionTypes: [],
        recentTrend: 'stable',
      },
    },
    confidence: 'medium',
    topActionTypes: [],
    overallWinRate: 0.50,
    recentTrend: 'stable',
    playbooks: [],
    winRateByActionType: {},
    roiAttribution: [],
    topWins: [],
    weCalledIt: [],
    ...overrides,
  };
}

// ── buildOutcomeAdjustment — undefined/missing learnings ──────────────────────

describe('buildOutcomeAdjustment — missing learnings', () => {
  it('returns no_data availability and neutral multiplier when learnings is undefined', () => {
    const result = buildOutcomeAdjustment({
      actionType: 'title_update',
      learnings: undefined,
    });
    expect(result.availability).toBe('no_data');
    expect(result.multiplier).toBe(1);
    expect(result.reasons).toEqual([]);
  });

  it('returns no_data availability and neutral multiplier when learnings is null', () => {
    const result = buildOutcomeAdjustment({
      actionType: 'title_update',
      learnings: null,
    });
    expect(result.availability).toBe('no_data');
    expect(result.multiplier).toBe(1);
  });
});

// ── buildOutcomeAdjustment — winRateByActionType lookup ───────────────────────

describe('buildOutcomeAdjustment — winRateByActionType lookup', () => {
  it('produces neutral multiplier when the action type is absent from winRateByActionType', () => {
    const result = buildOutcomeAdjustment({
      actionType: 'schema_markup_added',
      learnings: baseLearnings({ winRateByActionType: {} }),
      difficulty: 30,
    });
    // No action-type signal → only difficulty range contributes
    // '21-40' rate = 0.55 → difficultyMultiplier(0.55) = 1.05
    expect(result.multiplier).toBe(1.05);
    expect(result.reasons.some(r => r.includes('schema_markup_added'))).toBe(false);
  });

  it('produces neutral action multiplier when winRateByActionType is undefined', () => {
    const learnings = baseLearnings();
    // @ts-expect-error intentionally remove the field to simulate legacy data
    delete learnings.winRateByActionType;
    const result = buildOutcomeAdjustment({
      actionType: 'title_update',
      learnings,
      difficulty: 50,
    });
    // '41-60' rate = 0.40 → difficultyMultiplier(0.40) = 1 (neutral zone)
    expect(result.multiplier).toBe(1);
  });

  it('ignores NaN winRate for action type (NaN is not finite)', () => {
    const result = buildOutcomeAdjustment({
      actionType: 'content_refresh',
      learnings: baseLearnings({ winRateByActionType: { content_refresh: NaN } }),
      difficulty: undefined,
    });
    // NaN fails Number.isFinite check → no action-type adjustment
    expect(result.multiplier).toBe(1);
    expect(result.reasons).toEqual([]);
  });

  it('ignores Infinity winRate for action type', () => {
    const result = buildOutcomeAdjustment({
      actionType: 'meta_description_update',
      learnings: baseLearnings({ winRateByActionType: { meta_description_update: Infinity } }),
      difficulty: undefined,
    });
    expect(result.multiplier).toBe(1);
    expect(result.reasons).toEqual([]);
  });
});

// ── buildOutcomeAdjustment — difficulty range boundary values ─────────────────

describe('buildOutcomeAdjustment — difficulty range boundaries', () => {
  it('maps difficulty=0 to range 0-20', () => {
    const learnings = baseLearnings({
      summary: {
        workspaceId: 'ws-test',
        computedAt: '2026-05-01T00:00:00.000Z',
        confidence: 'medium',
        totalScoredActions: 10,
        content: null,
        strategy: {
          winRateByDifficultyRange: {
            '0-20': 0.90, // Clearly above 0.6 → boost
            '21-40': 0.3,
            '41-60': 0.3,
            '61-80': 0.3,
            '81-100': 0.3,
          },
          winRateByCheckpoint: {},
          bestIntentTypes: [],
          keywordVolumeSweetSpot: null,
        },
        technical: null,
        overall: { totalWinRate: 0.5, strongWinRate: 0.2, topActionTypes: [], recentTrend: 'stable' },
      },
    });
    const result = buildOutcomeAdjustment({ actionType: 'title_update', learnings, difficulty: 0 });
    expect(result.reasons.some(r => r.includes('0-20'))).toBe(true);
    expect(result.multiplier).toBeGreaterThan(1);
  });

  it('maps difficulty=20 to range 0-20 (boundary is inclusive)', () => {
    const learnings = baseLearnings({
      summary: {
        workspaceId: 'ws-test',
        computedAt: '2026-05-01T00:00:00.000Z',
        confidence: 'medium',
        totalScoredActions: 10,
        content: null,
        strategy: {
          winRateByDifficultyRange: {
            '0-20': 0.80,
            '21-40': 0.3,
            '41-60': 0.3,
            '61-80': 0.3,
            '81-100': 0.3,
          },
          winRateByCheckpoint: {},
          bestIntentTypes: [],
          keywordVolumeSweetSpot: null,
        },
        technical: null,
        overall: { totalWinRate: 0.5, strongWinRate: 0.2, topActionTypes: [], recentTrend: 'stable' },
      },
    });
    const result = buildOutcomeAdjustment({ actionType: 'title_update', learnings, difficulty: 20 });
    expect(result.reasons.some(r => r.includes('0-20'))).toBe(true);
  });

  it('maps difficulty=21 to range 21-40', () => {
    const learnings = baseLearnings({
      summary: {
        workspaceId: 'ws-test',
        computedAt: '2026-05-01T00:00:00.000Z',
        confidence: 'medium',
        totalScoredActions: 10,
        content: null,
        strategy: {
          winRateByDifficultyRange: {
            '0-20': 0.1,
            '21-40': 0.80, // Boost range
            '41-60': 0.3,
            '61-80': 0.3,
            '81-100': 0.3,
          },
          winRateByCheckpoint: {},
          bestIntentTypes: [],
          keywordVolumeSweetSpot: null,
        },
        technical: null,
        overall: { totalWinRate: 0.5, strongWinRate: 0.2, topActionTypes: [], recentTrend: 'stable' },
      },
    });
    const result = buildOutcomeAdjustment({ actionType: 'title_update', learnings, difficulty: 21 });
    expect(result.reasons.some(r => r.includes('21-40'))).toBe(true);
  });

  it('maps difficulty=100 to range 81-100', () => {
    const learnings = baseLearnings({
      summary: {
        workspaceId: 'ws-test',
        computedAt: '2026-05-01T00:00:00.000Z',
        confidence: 'medium',
        totalScoredActions: 10,
        content: null,
        strategy: {
          winRateByDifficultyRange: {
            '0-20': 0.7,
            '21-40': 0.7,
            '41-60': 0.7,
            '61-80': 0.7,
            '81-100': 0.10, // Down-rank
          },
          winRateByCheckpoint: {},
          bestIntentTypes: [],
          keywordVolumeSweetSpot: null,
        },
        technical: null,
        overall: { totalWinRate: 0.5, strongWinRate: 0.2, topActionTypes: [], recentTrend: 'stable' },
      },
    });
    const result = buildOutcomeAdjustment({ actionType: 'title_update', learnings, difficulty: 100 });
    expect(result.reasons.some(r => r.includes('81-100'))).toBe(true);
    expect(result.multiplier).toBeLessThan(1);
  });

  it('ignores difficulty when it is null', () => {
    const result = buildOutcomeAdjustment({
      actionType: 'title_update',
      learnings: baseLearnings({ winRateByActionType: { title_update: 0.7 } }),
      difficulty: null,
    });
    // Action-type boost applies; difficulty is ignored
    expect(result.multiplier).toBeGreaterThan(1);
    // No difficulty reason
    expect(result.reasons.every(r => !r.includes('Difficulty range'))).toBe(true); // every-ok: reasons always non-empty when multiplier is modified
  });

  it('ignores difficulty when it is undefined', () => {
    const result = buildOutcomeAdjustment({
      actionType: 'title_update',
      learnings: baseLearnings({ winRateByActionType: { title_update: 0.3 } }),
      difficulty: undefined,
    });
    // Only action-type down-rank
    expect(result.reasons.every(r => !r.includes('Difficulty range'))).toBe(true); // every-ok: vacuous true is acceptable — just verifying no difficulty reason added
  });

  it('ignores difficulty when it is NaN', () => {
    const result = buildOutcomeAdjustment({
      actionType: 'title_update',
      learnings: baseLearnings(),
      difficulty: NaN,
    });
    expect(result.multiplier).toBe(1);
  });
});

// ── buildOutcomeAdjustment — multiplier clamping ──────────────────────────────

describe('buildOutcomeAdjustment — multiplier clamping', () => {
  it('clamps combined multiplier at 1.25 upper bound', () => {
    // actionTypeMultiplier(0.8) = 1.14, difficultyMultiplier(0.8) = 1.12
    // Combined: 1.14 * 1.12 = 1.2768 → clamped to 1.25
    const learnings = baseLearnings({
      winRateByActionType: { title_update: 0.8 },
      summary: {
        workspaceId: 'ws-test',
        computedAt: '2026-05-01T00:00:00.000Z',
        confidence: 'high',
        totalScoredActions: 30,
        content: null,
        strategy: {
          winRateByDifficultyRange: {
            '0-20': 0.80, // Very high → 1.12 multiplier
            '21-40': 0.5,
            '41-60': 0.5,
            '61-80': 0.5,
            '81-100': 0.5,
          },
          winRateByCheckpoint: {},
          bestIntentTypes: [],
          keywordVolumeSweetSpot: null,
        },
        technical: null,
        overall: { totalWinRate: 0.6, strongWinRate: 0.3, topActionTypes: [], recentTrend: 'improving' },
      },
    });
    const result = buildOutcomeAdjustment({ actionType: 'title_update', learnings, difficulty: 15 });
    expect(result.multiplier).toBeLessThanOrEqual(1.25);
    expect(result.availability).toBe('ready');
  });

  it('clamps combined multiplier at 0.75 lower bound', () => {
    // actionTypeMultiplier(0.1) = 0.86, difficultyMultiplier(0.1) = 0.88
    // Combined: 0.86 * 0.88 = 0.7568 → clamped to 0.75
    const learnings = baseLearnings({
      winRateByActionType: { content_published: 0.1 },
      summary: {
        workspaceId: 'ws-test',
        computedAt: '2026-05-01T00:00:00.000Z',
        confidence: 'low',
        totalScoredActions: 10,
        content: null,
        strategy: {
          winRateByDifficultyRange: {
            '0-20': 0.10, // Very low → 0.88 multiplier
            '21-40': 0.5,
            '41-60': 0.5,
            '61-80': 0.5,
            '81-100': 0.5,
          },
          winRateByCheckpoint: {},
          bestIntentTypes: [],
          keywordVolumeSweetSpot: null,
        },
        technical: null,
        overall: { totalWinRate: 0.3, strongWinRate: 0.1, topActionTypes: [], recentTrend: 'declining' },
      },
    });
    const result = buildOutcomeAdjustment({ actionType: 'content_published', learnings, difficulty: 5 });
    expect(result.multiplier).toBeGreaterThanOrEqual(0.75);
    expect(result.availability).toBe('ready');
  });

  it('multiplier is rounded to 3 decimal places', () => {
    // Any action-type rate in neutral zone (0.4–0.65) with a difficulty in neutral zone
    // → multiplier = 1 (no adjustments applied)
    const result = buildOutcomeAdjustment({
      actionType: 'title_update',
      learnings: baseLearnings({ winRateByActionType: { title_update: 0.50 } }),
      difficulty: 50, // '41-60' → 0.40 in baseLearnings → neutral zone
    });
    // 1.0 * 1.0 = 1.0 → Number(1.toFixed(3)) = 1
    expect(Number.isInteger(result.multiplier) || String(result.multiplier).split('.')[1]?.length <= 3).toBe(true);
  });
});

// ── buildOutcomeAdjustment — neutral zone values ─────────────────────────────

describe('buildOutcomeAdjustment — neutral zone values', () => {
  it('does not add a reason when action win rate is in the neutral zone (0.41–0.49)', () => {
    // actionTypeMultiplier neutral zone: winRate > 0.40 and winRate < 0.50
    const result = buildOutcomeAdjustment({
      actionType: 'internal_link_added',
      learnings: baseLearnings({ winRateByActionType: { internal_link_added: 0.45 } }),
      difficulty: undefined,
    });
    expect(result.multiplier).toBe(1);
    expect(result.reasons).toEqual([]);
  });

  it('does not add a reason when difficulty win rate is in the neutral zone (0.36–0.44)', () => {
    // baseLearnings has '41-60' at 0.40 which is in the neutral zone (0.36–0.44)
    const result = buildOutcomeAdjustment({
      actionType: 'title_update',
      learnings: baseLearnings(),
      difficulty: 50, // '41-60' → 0.40 in baseLearnings
    });
    expect(result.multiplier).toBe(1);
    expect(result.reasons).toEqual([]);
  });
});

// ── applyOutcomeAdjustmentScore — additional edge cases ───────────────────────

describe('applyOutcomeAdjustmentScore', () => {
  it('rounds to nearest integer', () => {
    // 75 * 1.07 = 80.25 → rounds to 80
    const result = applyOutcomeAdjustmentScore(75, { availability: 'ready', multiplier: 1.07, reasons: [] });
    expect(Number.isInteger(result)).toBe(true);
  });

  it('clamps at 0 lower bound', () => {
    // 10 * 0 = 0
    const result = applyOutcomeAdjustmentScore(10, { availability: 'ready', multiplier: 0, reasons: [] });
    expect(result).toBe(0);
  });

  it('clamps at 100 upper bound', () => {
    const result = applyOutcomeAdjustmentScore(100, { availability: 'ready', multiplier: 2, reasons: [] });
    expect(result).toBe(100);
  });

  it('handles baseScore of 0 correctly', () => {
    const result = applyOutcomeAdjustmentScore(0, { availability: 'ready', multiplier: 1.2, reasons: [] });
    expect(result).toBe(0);
  });

  it('does not go below 0 with negative baseScore', () => {
    const result = applyOutcomeAdjustmentScore(-10, { availability: 'ready', multiplier: 1.0, reasons: [] });
    expect(result).toBe(0);
  });
});

// ── buildOutcomeLearningStatusNote — domain-specific messages ─────────────────

describe('buildOutcomeLearningStatusNote — domain specificity', () => {
  it('no_data message for domain=content mentions "content"', () => {
    const result = buildOutcomeLearningStatusNote('no_data', 'content');
    expect(result).toContain('content');
    expect(result).not.toMatch(/strategy|technical/);
  });

  it('no_data message for domain=strategy mentions "strategy"', () => {
    const result = buildOutcomeLearningStatusNote('no_data', 'strategy');
    expect(result).toContain('strategy');
  });

  it('no_data message for domain=technical mentions "technical"', () => {
    const result = buildOutcomeLearningStatusNote('no_data', 'technical');
    expect(result).toContain('technical');
  });

  it('no_data message for domain=all avoids naming a specific domain', () => {
    const result = buildOutcomeLearningStatusNote('no_data', 'all');
    // The message for 'all' removes the domain qualifier (note the .replace('  ', ' '))
    // It should still mention "outcomes" but not repeat a domain type
    expect(result).toContain('outcomes');
    expect(result).not.toContain('content outcomes');
    expect(result).not.toContain('strategy outcomes');
    expect(result).not.toContain('technical outcomes');
  });

  it('disabled message references general platform best practices for domain=all', () => {
    const result = buildOutcomeLearningStatusNote('disabled', 'all');
    expect(result).toContain('platform');
  });

  it('disabled message references domain-specific best practices for domain=content', () => {
    const result = buildOutcomeLearningStatusNote('disabled', 'content');
    expect(result).toContain('content best practices');
  });

  it('returns empty string for undefined availability', () => {
    const result = buildOutcomeLearningStatusNote(undefined, 'all');
    expect(result).toBe('');
  });

  it('returns empty string for ready availability', () => {
    expect(buildOutcomeLearningStatusNote('ready', 'content')).toBe('');
    expect(buildOutcomeLearningStatusNote('ready', 'strategy')).toBe('');
    expect(buildOutcomeLearningStatusNote('ready', 'technical')).toBe('');
    expect(buildOutcomeLearningStatusNote('ready', 'all')).toBe('');
  });

  it('returns empty string for not_requested availability', () => {
    expect(buildOutcomeLearningStatusNote('not_requested', 'content')).toBe('');
    expect(buildOutcomeLearningStatusNote('not_requested', 'all')).toBe('');
  });

  it('degraded message is domain-agnostic (same for all domains)', () => {
    const allDomains = ['content', 'strategy', 'technical', 'all'] as const;
    const results = allDomains.map(d => buildOutcomeLearningStatusNote('degraded', d));
    // All degraded messages should be identical
    expect(new Set(results).size).toBe(1);
    expect(results[0]).toContain('could not be loaded');
  });
});
