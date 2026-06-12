import { describe, it, expect } from 'vitest';
import { computeOpportunityScore } from '../../server/keyword-strategy-helpers.js';

describe('A5 parity cluster contract tests', () => {
  describe('A5-2: opportunityScore fallback uses canonical computeOpportunityScore', () => {
    it('returns a numeric score for a gap with volume and difficulty', () => {
      const score = computeOpportunityScore({ volume: 500, difficulty: 30 });
      expect(typeof score).toBe('number');
      expect(score).toBeGreaterThan(0);
    });

    it('returns undefined when gap has no data', () => {
      const score = computeOpportunityScore({});
      expect(score).toBeUndefined();
    });

    it('applies trend multiplier for rising keywords', () => {
      const base = computeOpportunityScore({ volume: 1000, difficulty: 50 })!;
      const rising = computeOpportunityScore({ volume: 1000, difficulty: 50, trendDirection: 'rising' })!;
      expect(rising).toBeGreaterThan(base);
    });

    it('applies trend multiplier for declining keywords', () => {
      const base = computeOpportunityScore({ volume: 1000, difficulty: 50 })!;
      const declining = computeOpportunityScore({ volume: 1000, difficulty: 50, trendDirection: 'declining' })!;
      expect(declining).toBeLessThan(base);
    });
  });

  describe('A5-2: briefing-candidates no longer has deriveOpportunityScore', () => {
    it('briefing-candidates.ts does not export or contain deriveOpportunityScore', async () => {
      const mod = await import('../../server/briefing-candidates.js');
      expect((mod as Record<string, unknown>)['deriveOpportunityScore']).toBeUndefined();
    }, 15_000);
  });
});
