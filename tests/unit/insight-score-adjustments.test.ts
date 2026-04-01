import { describe, it, expect } from 'vitest';
import { applyScoreAdjustment, computeAdjustedScore } from '../../server/insight-score-adjustments.js';

describe('applyScoreAdjustment', () => {
  it('applies a single adjustment from original base', () => {
    const data: Record<string, unknown> = {};
    const result = applyScoreAdjustment(data, 50, 'outcome', -10);
    expect(result.adjustedScore).toBe(40);
    expect(result.data._originalBaseScore).toBe(50);
    expect(result.data._scoreAdjustments).toEqual({ outcome: -10 });
  });

  it('preserves existing adjustments from other bridges', () => {
    const data: Record<string, unknown> = {
      _originalBaseScore: 50,
      _scoreAdjustments: { anomaly: 10 },
    };
    const result = applyScoreAdjustment(data, 60, 'outcome', -10);
    expect(result.data._originalBaseScore).toBe(50); // preserved, not overwritten
    expect(result.data._scoreAdjustments).toEqual({ anomaly: 10, outcome: -10 });
    expect(result.adjustedScore).toBe(50); // 50 + 10 + (-10) = 50
  });

  it('updates an existing adjustment for the same bridge', () => {
    const data: Record<string, unknown> = {
      _originalBaseScore: 50,
      _scoreAdjustments: { outcome: -10 },
    };
    const result = applyScoreAdjustment(data, 40, 'outcome', -20);
    expect(result.data._scoreAdjustments).toEqual({ outcome: -20 });
    expect(result.adjustedScore).toBe(30); // 50 + (-20) = 30
  });

  it('clamps score to 0-100 range', () => {
    const data: Record<string, unknown> = {};
    const low = applyScoreAdjustment(data, 5, 'outcome', -20);
    expect(low.adjustedScore).toBe(0);

    const high = applyScoreAdjustment({}, 95, 'anomaly', 10);
    expect(high.adjustedScore).toBe(100);
  });

  it('removes adjustment when delta is 0', () => {
    const data: Record<string, unknown> = {
      _originalBaseScore: 50,
      _scoreAdjustments: { outcome: -10 },
    };
    const result = applyScoreAdjustment(data, 40, 'outcome', 0);
    expect(result.data._scoreAdjustments).toEqual({});
    expect(result.adjustedScore).toBe(50); // back to base
  });
});

describe('computeAdjustedScore', () => {
  it('computes from base + all adjustments', () => {
    const data = {
      _originalBaseScore: 50,
      _scoreAdjustments: { outcome: -10, anomaly: 10 },
    };
    expect(computeAdjustedScore(data, 50)).toBe(50);
  });

  it('returns currentImpactScore when no adjustments exist', () => {
    expect(computeAdjustedScore({}, 70)).toBe(70);
  });
});
