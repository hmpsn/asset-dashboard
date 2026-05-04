import { describe, it, expect } from 'vitest';
import { computeOpportunityScore } from '../../server/routes/keyword-strategy.js';

describe('computeOpportunityScore', () => {
  it('returns undefined when volume is 0 and no other signals', () => {
    expect(computeOpportunityScore({ volume: 0 })).toBeUndefined();
  });

  it('returns a number when difficulty alone is present', () => {
    const score = computeOpportunityScore({ difficulty: 30 });
    expect(typeof score).toBe('number');
    expect(score).toBeGreaterThan(0);
  });
});
