import { describe, it, expect } from 'vitest';
import { adjustKdImpactScore } from '../../server/recommendations.js';

describe('adjustKdImpactScore', () => {
  it('penalizes by 40% when KD is 30+ points above domain strength', () => {
    expect(adjustKdImpactScore(65, 80, 30)).toBe(Math.round(65 * 0.6));
  });
  it('penalizes by 40% at the exact boundary (kdGap = 30)', () => {
    // difficulty=60, domainStrength=30 → kdGap exactly 30 → inclusive boundary
    expect(adjustKdImpactScore(65, 60, 30)).toBe(Math.round(65 * 0.6));
  });
  it('penalizes by 20% when KD is 15-30 points above domain strength', () => {
    expect(adjustKdImpactScore(65, 50, 30)).toBe(Math.round(65 * 0.8));
  });
  it('penalizes by 20% at the exact lower boundary (kdGap = 15)', () => {
    // difficulty=45, domainStrength=30 → kdGap exactly 15 → inclusive boundary
    expect(adjustKdImpactScore(65, 45, 30)).toBe(Math.round(65 * 0.8));
  });
  it('boosts by 20% (capped 100) when KD is 20+ points below domain strength', () => {
    expect(adjustKdImpactScore(65, 10, 50)).toBe(Math.min(100, Math.round(65 * 1.2)));
  });
  it('boosts by 20% at the exact boundary (kdGap = -20)', () => {
    // difficulty=30, domainStrength=50 → kdGap exactly -20 → inclusive boundary
    expect(adjustKdImpactScore(65, 30, 50)).toBe(Math.min(100, Math.round(65 * 1.2)));
  });
  it('returns original score when domain strength is 0', () => {
    expect(adjustKdImpactScore(65, 70, 0)).toBe(65);
  });
});
