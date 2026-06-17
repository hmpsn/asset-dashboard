import { describe, it, expect } from 'vitest';
import { buildOrientMetrics } from '../../server/keyword-strategy-orient.js';

describe('buildOrientMetrics', () => {
  const current = [
    { currentPosition: 1, volume: 1000, clicks: 100, impressions: 1000 },
    { currentPosition: 11, volume: 500, clicks: 10, impressions: 500 },
  ];

  it('returns current values with null deltas when there is no prior snapshot', () => {
    const m = buildOrientMetrics(current, null);
    expect(m.clicks).toBe(110);
    expect(m.impressions).toBe(1500);
    expect(m.rankedKeywords).toBe(2);
    expect(m.avgPosition).toBe(6); // (1 + 11) / 2
    expect(m.visibilityScore).toBeGreaterThan(0);
    expect(m.visibilityScore).toBeLessThanOrEqual(100);
    expect(m.visibilityScoreDelta).toBeNull();
    expect(m.clicksDelta).toBeNull();
    expect(m.impressionsDelta).toBeNull();
    expect(m.rankedKeywordsDelta).toBeNull();
    expect(m.avgPositionDelta).toBeNull();
  });

  it('computes deltas vs the prior snapshot', () => {
    const prior = [{ currentPosition: 5, volume: 1000, clicks: 50, impressions: 800 }];
    const m = buildOrientMetrics(current, prior);
    expect(m.clicksDelta).toBe(60); // 110 - 50
    expect(m.impressionsDelta).toBe(700); // 1500 - 800
    expect(m.rankedKeywordsDelta).toBe(1); // 2 - 1
    expect(m.avgPositionDelta).toBe(1); // 6 - 5 (worse; positive = position got larger)
    expect(typeof m.visibilityScoreDelta).toBe('number');
  });

  it('suppresses the visibility-score delta when volume coverage differs between snapshots', () => {
    const withVol = [{ currentPosition: 1, volume: 1000, clicks: 100, impressions: 1000 }];
    const noVol = [{ currentPosition: 1, clicks: 80, impressions: 900 }]; // no volume → unweighted mode
    const m = buildOrientMetrics(withVol, noVol);
    expect(m.visibilityScoreDelta).toBeNull(); // weighting-mode mismatch → suppressed
    expect(m.clicksDelta).toBe(20); // raw stat deltas still computed (100 − 80)
  });

  it('treats an empty prior page set as no prior (null deltas)', () => {
    expect(buildOrientMetrics(current, []).clicksDelta).toBeNull();
  });

  it('yields a positive visibility-score delta when positions improve', () => {
    const prior = [{ currentPosition: 20, volume: 1000 }, { currentPosition: 20, volume: 500 }];
    const better = [{ currentPosition: 1, volume: 1000 }, { currentPosition: 1, volume: 500 }];
    expect(buildOrientMetrics(better, prior).visibilityScoreDelta!).toBeGreaterThan(0);
  });

  it('handles an empty current page set (zeros, score 0)', () => {
    const m = buildOrientMetrics([], null);
    expect(m.visibilityScore).toBe(0);
    expect(m.clicks).toBe(0);
    expect(m.rankedKeywords).toBe(0);
    expect(m.avgPosition).toBe(0);
  });
});
