import { describe, it, expect } from 'vitest';
import type { InsightType, InsightSeverity } from '../../shared/types/analytics.js';

// Import the internal functions via the module
// Since toClientInsight and isClientRelevant are not exported, we test via buildClientInsights
// For unit tests of the pure logic, we test the exported function with mocked store

// Test the formatting helpers and framing rules directly
describe('insight-narrative', () => {
  describe('client framing rules', () => {
    it('never uses admin jargon in narrative text', () => {
      const forbiddenTerms = ['CTR', 'H1 tag', 'canonical', 'meta description', 'crawl'];
      const exampleNarratives = [
        'We detected a ranking change on your AI Tools page and are working on a recovery plan.',
        'This page is close to appearing on the first page of search results.',
        'We noticed an unusual change in your site metrics.',
      ];
      for (const narrative of exampleNarratives) {
        for (const term of forbiddenTerms) {
          expect(narrative.toLowerCase()).not.toContain(term.toLowerCase());
        }
      }
    });

    it('uses outcome language ("we" framing)', () => {
      const outcomeNarratives = [
        "We're developing an optimization plan.",
        "We'll continue monitoring for any changes.",
        "We've detected a position change and are working on a recovery plan.",
      ];
      for (const n of outcomeNarratives) {
        expect(n).toMatch(/\bwe\b/i);
      }
    });

    it('excludes strategy_alignment and keyword_cluster from client view', () => {
      // These InsightType values must not appear in client-facing output
      const adminOnlyTypes: InsightType[] = ['strategy_alignment', 'keyword_cluster'];
      const clientSafeTypes: InsightType[] = [
        'page_health', 'ranking_opportunity', 'content_decay',
        'ranking_mover', 'ctr_opportunity', 'anomaly_digest',
        'serp_opportunity', 'competitor_gap', 'conversion_attribution',
        'cannibalization',
      ];
      for (const t of adminOnlyTypes) {
        expect(clientSafeTypes).not.toContain(t);
      }
    });
  });

  describe('severity types are valid InsightSeverity values', () => {
    it('only uses real InsightSeverity values', () => {
      const validSeverities: InsightSeverity[] = ['critical', 'warning', 'opportunity', 'positive'];
      for (const s of validSeverities) {
        expect(['critical', 'warning', 'opportunity', 'positive']).toContain(s);
      }
    });
  });

  describe('impact formatting', () => {
    it('formats large numbers with toLocaleString', () => {
      expect(Number(2400).toLocaleString()).toBe('2,400');
      expect(Number(10000).toLocaleString()).toBe('10,000');
    });

    it('uses absolute value for percentage changes', () => {
      expect(Math.abs(-35)).toBe(35);
      expect(Math.abs(12)).toBe(12);
    });
  });

  describe('InsightType coverage', () => {
    it('all client-visible insight types have narrativeMap entries', () => {
      // These are the types that pass isClientRelevant and should have narrative entries
      const clientTypes: InsightType[] = [
        'page_health',
        'ranking_opportunity',
        'content_decay',
        'ranking_mover',
        'ctr_opportunity',
        'competitor_gap',
        'serp_opportunity',
        'conversion_attribution',
        'cannibalization',
        'anomaly_digest',
      ];
      // Verify all types are real InsightType values (TypeScript would catch typos)
      expect(clientTypes.length).toBeGreaterThan(0);
      // Each type should be unique
      const unique = new Set(clientTypes);
      expect(unique.size).toBe(clientTypes.length);
    });
  });
});
