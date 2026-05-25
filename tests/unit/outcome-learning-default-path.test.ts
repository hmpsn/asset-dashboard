import { describe, expect, it } from 'vitest';

import type { LearningsSlice } from '../../shared/types/intelligence.js';
import {
  applyOutcomeAdjustmentScore,
  buildOutcomeAdjustment,
  buildOutcomeLearningStatusNote,
} from '../../server/outcome-learning-default-path.js';

function makeLearnings(overrides: Partial<LearningsSlice> = {}): LearningsSlice {
  return {
    availability: 'ready',
    summary: {
      workspaceId: 'ws-outcome-test',
      computedAt: new Date().toISOString(),
      confidence: 'medium',
      totalScoredActions: 10,
      content: null,
      strategy: {
        winRateByDifficultyRange: {
          '0-20': 0.72,
          '21-40': 0.61,
          '41-60': 0.39,
          '61-80': 0.24,
          '81-100': 0.18,
        },
        winRateByCheckpoint: {},
        bestIntentTypes: [],
        keywordVolumeSweetSpot: null,
      },
      technical: null,
      overall: {
        totalWinRate: 0.58,
        strongWinRate: 0.21,
        topActionTypes: [],
        recentTrend: 'improving',
      },
    },
    confidence: 'medium',
    topActionTypes: [],
    overallWinRate: 0.58,
    recentTrend: 'improving',
    playbooks: [],
    roiAttribution: [],
    topWins: [],
    weCalledIt: [],
    winRateByActionType: {},
    ...overrides,
  };
}

describe('buildOutcomeAdjustment', () => {
  it('returns a neutral adjustment when learnings are disabled', () => {
    const result = buildOutcomeAdjustment({
      actionType: 'content_published',
      learnings: makeLearnings({ availability: 'disabled' }),
      difficulty: 32,
    });

    expect(result.availability).toBe('disabled');
    expect(result.multiplier).toBe(1);
    expect(result.reasons).toEqual([]);
  });

  it('boosts scores when the action type and difficulty range have performed well', () => {
    const result = buildOutcomeAdjustment({
      actionType: 'content_published',
      learnings: makeLearnings({
        winRateByActionType: {
          content_published: 0.69,
        },
      }),
      difficulty: 18,
    });

    expect(result.availability).toBe('ready');
    expect(result.multiplier).toBeGreaterThan(1);
    expect(result.reasons.join(' ')).toContain('content_published has performed well');
    expect(result.reasons.join(' ')).toContain('Difficulty range 0-20 has been a strong performer');
  });

  it('down-ranks scores when a difficulty range has underperformed', () => {
    const result = buildOutcomeAdjustment({
      actionType: 'strategy_keyword_added',
      learnings: makeLearnings({
        winRateByActionType: {
          strategy_keyword_added: 0.31,
        },
      }),
      difficulty: 78,
    });

    expect(result.multiplier).toBeLessThan(1);
    expect(result.reasons.join(' ')).toContain('underperformed');
  });

  it('treats zero-percent win rates as a real demotion signal, not neutral', () => {
    const result = buildOutcomeAdjustment({
      actionType: 'content_published',
      learnings: makeLearnings({
        winRateByActionType: {
          content_published: 0,
        },
        summary: {
          ...makeLearnings().summary!,
          strategy: {
            ...makeLearnings().summary!.strategy,
            winRateByDifficultyRange: {
              '0-20': 0,
              '21-40': 0.4,
              '41-60': 0.39,
              '61-80': 0.24,
              '81-100': 0.18,
            },
          },
        },
      }),
      difficulty: 12,
    });

    expect(result.multiplier).toBeLessThan(1);
    expect(result.reasons.join(' ')).toContain('0% win rate');
  });
});

describe('applyOutcomeAdjustmentScore', () => {
  it('applies the multiplier and clamps the result into a score range', () => {
    expect(applyOutcomeAdjustmentScore(90, { availability: 'ready', multiplier: 1.2, reasons: [] })).toBe(100);
    expect(applyOutcomeAdjustmentScore(10, { availability: 'ready', multiplier: 0.5, reasons: [] })).toBe(5);
  });
});

describe('buildOutcomeLearningStatusNote', () => {
  it('returns clear messages for each unavailable state', () => {
    expect(buildOutcomeLearningStatusNote('disabled', 'content')).toContain('disabled');
    expect(buildOutcomeLearningStatusNote('no_data', 'strategy')).toContain('does not yet have enough measured strategy outcomes');
    expect(buildOutcomeLearningStatusNote('degraded', 'all')).toContain('could not be loaded');
  });

  it('returns an empty string when learnings are ready', () => {
    expect(buildOutcomeLearningStatusNote('ready', 'all')).toBe('');
    expect(buildOutcomeLearningStatusNote('not_requested', 'content')).toBe('');
  });
});
