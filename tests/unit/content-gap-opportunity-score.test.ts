import { describe, it, expect } from 'vitest';
import { computeOpportunityScore } from '../../server/routes/keyword-strategy.js';

describe('computeOpportunityScore', () => {
  it('returns 0 for a gap with no data', () => {
    expect(computeOpportunityScore({})).toBe(0);
  });

  it('rewards rising trend', () => {
    const rising = computeOpportunityScore({ volume: 1000, difficulty: 40, trendDirection: 'rising' });
    const stable = computeOpportunityScore({ volume: 1000, difficulty: 40, trendDirection: 'stable' });
    expect(rising).toBeGreaterThan(stable);
  });

  it('penalises declining trend', () => {
    const declining = computeOpportunityScore({ volume: 1000, difficulty: 40, trendDirection: 'declining' });
    const stable = computeOpportunityScore({ volume: 1000, difficulty: 40, trendDirection: 'stable' });
    expect(declining).toBeLessThan(stable);
  });

  it('rewards high volume + low difficulty', () => {
    const easy = computeOpportunityScore({ volume: 5000, difficulty: 20 });
    const hard = computeOpportunityScore({ volume: 5000, difficulty: 80 });
    expect(easy).toBeGreaterThan(hard);
  });

  it('rewards GSC impressions (existing relevance signal)', () => {
    const withImpr = computeOpportunityScore({ volume: 500, difficulty: 50, impressions: 1000 });
    const withoutImpr = computeOpportunityScore({ volume: 500, difficulty: 50, impressions: 0 });
    expect(withImpr).toBeGreaterThan(withoutImpr);
  });

  it('caps at 100', () => {
    expect(computeOpportunityScore({ volume: 50000, difficulty: 5, impressions: 5000, trendDirection: 'rising' })).toBeLessThanOrEqual(100);
  });
});
