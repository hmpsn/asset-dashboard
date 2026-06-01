import { describe, it, expect } from 'vitest';
import {
  buildCtrCurve,
  ctrAt,
  industryCtr,
  MIN_CALIBRATION_IMPRESSIONS,
  MAX_TRACKED_POSITION,
  type GscKeywordObservation,
} from '../../server/scoring/ctr-curve.js';

describe('industryCtr', () => {
  it('is monotonically non-increasing across positions 1..20', () => {
    let prev = Infinity;
    for (let p = 1; p <= MAX_TRACKED_POSITION; p++) {
      const ctr = industryCtr(p);
      expect(ctr).toBeLessThanOrEqual(prev);
      prev = ctr;
    }
  });
  it('clamps out-of-range positions', () => {
    expect(industryCtr(0)).toBe(industryCtr(1));
    expect(industryCtr(-5)).toBe(industryCtr(1));
    expect(industryCtr(999)).toBe(industryCtr(MAX_TRACKED_POSITION));
  });
});

describe('buildCtrCurve', () => {
  it('falls back to the industry curve with no observations', () => {
    expect(buildCtrCurve(null).source).toBe('industry');
    expect(buildCtrCurve([]).source).toBe('industry');
    expect(buildCtrCurve([]).observations).toBe(0);
    expect(buildCtrCurve([]).curve[1]).toBe(industryCtr(1));
  });

  it('marks the source "blended" below the calibration threshold', () => {
    const obs: GscKeywordObservation[] = [
      { query: 'a', clicks: 5, impressions: 100, position: 3 },
    ];
    const built = buildCtrCurve(obs);
    expect(built.observations).toBeLessThan(MIN_CALIBRATION_IMPRESSIONS);
    expect(built.source).toBe('blended');
    // observed bucket is SHRUNK toward the industry prior (PRIOR_IMPRESSIONS=200):
    // (5 + 200*0.10) / (100 + 200) = 25/300; untouched buckets fall back to industry
    expect(built.curve[3]).toBeCloseTo(25 / 300, 5);
    expect(built.curve[10]).toBe(industryCtr(10));
  });

  it('marks the source "calibrated" at/above the threshold and uses observed CTR', () => {
    const obs: GscKeywordObservation[] = [
      { query: 'a', clicks: 120, impressions: 400, position: 2 },
      { query: 'b', clicks: 60, impressions: 300, position: 2 },  // bucket 2 raw = 180/700
      { query: 'c', clicks: 0, impressions: 0, position: 5 },     // zero-impression skipped
    ];
    const built = buildCtrCurve(obs);
    expect(built.observations).toBeGreaterThanOrEqual(MIN_CALIBRATION_IMPRESSIONS);
    expect(built.source).toBe('calibrated');
    // shrunk: (180 + 200*industryCtr(2)=0.15) / (700 + 200) = 210/900
    expect(built.curve[2]).toBeCloseTo(210 / 900, 5);
    expect(built.curve[5]).toBe(industryCtr(5)); // no usable obs there
  });

  it('rounds fractional positions into integer buckets and keeps CTR ≤ 1', () => {
    const obs: GscKeywordObservation[] = [
      { query: 'x', clicks: 50, impressions: 40, position: 1.4 }, // raw 1.25 → shrinkage + clamp keep ≤ 1
    ];
    const built = buildCtrCurve(obs);
    // (50 + 200*industryCtr(1)=0.28) / (40 + 200) = 106/240
    expect(built.curve[1]).toBeCloseTo(106 / 240, 5);
    expect(built.curve[1]).toBeLessThanOrEqual(1);
  });

  it('ALWAYS returns a monotonic non-increasing curve, even when raw buckets invert', () => {
    // Sparse near-top bucket with a freak-low CTR + a viral deep bucket with a high
    // CTR would invert a naive curve and zero a real striking-distance keyword.
    const obs: GscKeywordObservation[] = [
      { query: 'rare', clicks: 1, impressions: 800, position: 3 },   // ~0.00125 (very low for pos 3)
      { query: 'viral', clicks: 400, impressions: 800, position: 8 }, // 0.5 (absurdly high for pos 8)
    ];
    const { curve } = buildCtrCurve(obs);
    let prev = Infinity;
    for (let p = 1; p <= MAX_TRACKED_POSITION; p++) {
      expect(curve[p]).toBeLessThanOrEqual(prev + 1e-12);
      prev = curve[p];
    }
    // and the inverted deep bucket cannot exceed a better position
    expect(curve[8]).toBeLessThanOrEqual(curve[3]);
  });
});

describe('ctrAt', () => {
  it('reads a built curve and falls back to industry for missing positions', () => {
    const { curve } = buildCtrCurve([{ query: 'a', clicks: 5, impressions: 100, position: 3 }]);
    expect(ctrAt(3, curve)).toBeCloseTo(25 / 300, 5); // shrunk: (5 + 200*0.10)/(100+200)
    expect(ctrAt(7, curve)).toBe(industryCtr(7));
    expect(ctrAt(2, null)).toBe(industryCtr(2));
  });
});
