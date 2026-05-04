import { describe, it, expect } from 'vitest';
import { computeOpportunityScore } from '../../server/routes/keyword-strategy.js';

describe('computeOpportunityScore', () => {
  it('returns undefined when no enrichment data present', () => {
    expect(computeOpportunityScore({})).toBeUndefined();
  });

  it('returns undefined when volume is 0 and no other signals', () => {
    expect(computeOpportunityScore({ volume: 0 })).toBeUndefined();
  });

  it('returns a number when difficulty alone is present', () => {
    const score = computeOpportunityScore({ difficulty: 30 });
    expect(typeof score).toBe('number');
    expect(score).toBeGreaterThan(0);
  });

  it('returns a number when volume is positive', () => {
    const score = computeOpportunityScore({ volume: 500, difficulty: 30 });
    expect(typeof score).toBe('number');
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it('returns a higher score for rising trend', () => {
    const rising = computeOpportunityScore({ volume: 500, difficulty: 30, trendDirection: 'rising' });
    const stable = computeOpportunityScore({ volume: 500, difficulty: 30, trendDirection: 'stable' });
    expect(rising!).toBeGreaterThan(stable!);
  });
});
