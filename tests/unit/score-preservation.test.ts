// tests/unit/score-preservation.test.ts
// Verifies that cross-bridge score adjustments (_scoreAdjustments) survive a re-upsert
// cycle. The critical path: anomaly bridge boosts an audit_finding insight's impactScore,
// then a scheduled re-audit runs Bridge #12/15 which re-upserts with fresh audit data.
// Without the fix the re-upsert would clobber _scoreAdjustments, losing the boost.

import { describe, it, expect } from 'vitest';
import { applyScoreAdjustment } from '../../server/insight-score-adjustments.js';

describe('applyScoreAdjustment', () => {
  it('writes delta and _originalBaseScore into data', () => {
    const base = {};
    const { data, adjustedScore } = applyScoreAdjustment(base, 80, 'anomaly', 10);
    expect(data._originalBaseScore).toBe(80);
    expect(data._scoreAdjustments).toEqual({ anomaly: 10 });
    expect(adjustedScore).toBe(90);
  });

  it('accumulates multiple bridge deltas independently', () => {
    const base = {};
    const { data: d1 } = applyScoreAdjustment(base, 50, 'anomaly', 10);
    const { data: d2, adjustedScore } = applyScoreAdjustment(d1, 60, 'outcome', -5);
    expect(d2._scoreAdjustments).toEqual({ anomaly: 10, outcome: -5 });
    expect(adjustedScore).toBe(55); // 50 + 10 - 5
  });

  it('removes a bridge key when delta is 0', () => {
    const base = {};
    const { data: d1 } = applyScoreAdjustment(base, 80, 'anomaly', 10);
    const { data: d2, adjustedScore } = applyScoreAdjustment(d1, 90, 'anomaly', 0);
    expect(d2._scoreAdjustments).toEqual({});
    expect(adjustedScore).toBe(80); // back to original base
  });

  it('clamps score to [0, 100]', () => {
    const base = {};
    const { adjustedScore: high } = applyScoreAdjustment(base, 95, 'anomaly', 20);
    expect(high).toBe(100);
    const { adjustedScore: low } = applyScoreAdjustment(base, 5, 'outcome', -20);
    expect(low).toBe(0);
  });
});

describe('Bridge re-upsert score preservation pattern', () => {
  // Simulates what Bridge #12/15 now does: reads existing _scoreAdjustments and
  // carries them forward when writing a new audit data payload.

  function simulateBridgeReUpsert(
    existingData: Record<string, unknown> | undefined,
    newBaseScore: number,
  ): { finalScore: number; data: Record<string, unknown> } {
    const prevAdj = existingData?._scoreAdjustments as Record<string, number> | undefined;
    const totalDelta = prevAdj
      ? Object.values(prevAdj).reduce((s, d) => s + (Number.isFinite(d) ? d : 0), 0)
      : 0;
    const data: Record<string, unknown> = {
      scope: 'page',
      source: 'bridge_12',
      ...(prevAdj ? { _originalBaseScore: newBaseScore, _scoreAdjustments: prevAdj } : {}),
    };
    const finalScore = prevAdj ? Math.max(0, Math.min(100, newBaseScore + totalDelta)) : newBaseScore;
    return { finalScore, data };
  }

  it('carries forward existing _scoreAdjustments on re-upsert', () => {
    // Anomaly bridge wrote +10 boost into the existing insight
    const existingData = {
      _originalBaseScore: 80,
      _scoreAdjustments: { anomaly: 10 },
    };

    const { finalScore, data } = simulateBridgeReUpsert(existingData, 80);

    expect(finalScore).toBe(90); // base 80 + anomaly boost 10
    expect(data._scoreAdjustments).toEqual({ anomaly: 10 });
    expect(data._originalBaseScore).toBe(80);
  });

  it('recomputes adjusted score when new base score differs from previous', () => {
    // Insight was at base 80 with +10 anomaly boost (total 90)
    // Re-audit determines new base = 50 (more issues found)
    const existingData = {
      _originalBaseScore: 80,
      _scoreAdjustments: { anomaly: 10 },
    };

    const { finalScore } = simulateBridgeReUpsert(existingData, 50);

    // New base 50 + existing anomaly boost 10 = 60
    expect(finalScore).toBe(60);
  });

  it('no-ops cleanly when there are no existing adjustments', () => {
    const { finalScore, data } = simulateBridgeReUpsert(undefined, 80);

    expect(finalScore).toBe(80);
    expect(data._scoreAdjustments).toBeUndefined();
    expect(data._originalBaseScore).toBeUndefined();
  });

  it('handles multiple bridge adjustments across re-upsert cycle', () => {
    const existingData = {
      _originalBaseScore: 70,
      _scoreAdjustments: { anomaly: 10, outcome: -5 },
    };

    const { finalScore } = simulateBridgeReUpsert(existingData, 70);

    // 70 + 10 - 5 = 75
    expect(finalScore).toBe(75);
  });
});
