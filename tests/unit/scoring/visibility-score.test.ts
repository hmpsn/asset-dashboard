import { describe, it, expect } from 'vitest';
import { computeVisibilityScore } from '../../../server/scoring/visibility-score.js';

describe('computeVisibilityScore', () => {
  it('returns 0 for empty input', () => {
    expect(computeVisibilityScore([])).toBe(0);
  });

  it('returns 100 when every page ranks #1 (volume-weighted)', () => {
    expect(computeVisibilityScore([
      { position: 1, volume: 1000 },
      { position: 1, volume: 500 },
    ])).toBe(100);
  });

  it('returns 0 when every page is unranked (null position)', () => {
    expect(computeVisibilityScore([
      { position: null, volume: 1000 },
      { position: null, volume: 500 },
    ])).toBe(0);
  });

  it('is monotonic — improving a page position never lowers the score', () => {
    const worse = computeVisibilityScore([{ position: 10, volume: 1000 }, { position: 8, volume: 800 }]);
    const better = computeVisibilityScore([{ position: 3, volume: 1000 }, { position: 8, volume: 800 }]);
    expect(better).toBeGreaterThan(worse);
  });

  it('returns the exact integer score for a mixed set (pins the formula)', () => {
    // captured = 1000·ctr(1) + 1000·ctr(15) + 0 = 1000·(0.28 + 0.009) = 289
    // potential = 3000·ctr(1) = 840 → 289/840 = 34.4 → 34
    expect(computeVisibilityScore([
      { position: 1, volume: 1000 },
      { position: 15, volume: 1000 },
      { position: null, volume: 1000 },
    ])).toBe(34);
  });

  it('counts unranked pages with volume in the denominator (drags the score down)', () => {
    expect(computeVisibilityScore([{ position: 1, volume: 1000 }])).toBe(100);
    expect(computeVisibilityScore([
      { position: 1, volume: 1000 },
      { position: null, volume: 1000 },
    ])).toBe(50);
  });

  it('does NOT drop a ranked page just because its volume is null (weighted mode)', () => {
    // A #1 ranking with unknown volume must not zero out the score. The null-volume
    // page gets the median positive volume (1000) as its weight, so it counts as a win.
    // captured = 1000·ctr(1); potential = 1000·ctr(1) (#1 page) + 1000·ctr(1) (unranked) → 50.
    expect(computeVisibilityScore([
      { position: 1, volume: null },
      { position: null, volume: 1000 },
    ])).toBe(50);
  });

  it('falls back to an unweighted mean when all volumes are null', () => {
    expect(computeVisibilityScore([{ position: 1, volume: null }, { position: 1, volume: null }])).toBe(100);
    expect(computeVisibilityScore([{ position: 1, volume: null }, { position: null, volume: null }])).toBe(50);
  });

  it('does not divide by zero when all volumes are zero', () => {
    expect(computeVisibilityScore([{ position: 1, volume: 0 }, { position: 1, volume: 0 }])).toBe(100);
  });

  it('honors a calibrated curve at non-#1 positions (proves the curve is consulted)', () => {
    const curve = { 1: 0.2, 2: 0.1 } as Record<number, number>;
    expect(computeVisibilityScore([{ position: 1, volume: 100 }], curve)).toBe(100);
    // ctr(2)/ctr(1) = 0.1/0.2 = 0.5 → 50
    expect(computeVisibilityScore([{ position: 2, volume: 100 }], curve)).toBe(50);
  });

  it('scores deep rankings (position > 20) near zero via the curve clamp', () => {
    // ctr(50) clamps to position-20 CTR (0.005); 0.005/0.28 ≈ 1.8% → 2
    expect(computeVisibilityScore([{ position: 50, volume: 1000 }])).toBe(2);
  });

  it('treats non-finite or out-of-range positions as unranked', () => {
    expect(computeVisibilityScore([{ position: Number.NaN, volume: 1000 }])).toBe(0);
    expect(computeVisibilityScore([{ position: -5, volume: 1000 }])).toBe(0);
    expect(computeVisibilityScore([{ position: 0, volume: 1000 }])).toBe(0);
  });
});
