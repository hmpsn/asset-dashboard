import { describe, it, expect } from 'vitest';
import {
  resolvePageTitle,
  computeImpactScore,
  classifyDomain,
  cleanSlugToTitle,
  checkStrategyAlignment,
} from '../../server/insight-enrichment.js';
import type { PageKeywordMap } from '../../shared/types/workspace.js';

describe('insight-enrichment', () => {
  describe('cleanSlugToTitle', () => {
    it('converts a slug to a readable title', () => {
      expect(cleanSlugToTitle('/blog/best-ai-coding-agents')).toBe('Best AI Coding Agents');
    });
    it('handles nested paths', () => {
      expect(cleanSlugToTitle('/docs/getting-started/installation')).toBe('Installation');
    });
    it('handles URLs with domain', () => {
      expect(cleanSlugToTitle('https://example.com/blog/my-post')).toBe('My Post');
    });
    it('returns Home for root path', () => {
      expect(cleanSlugToTitle('/')).toBe('Home');
    });
  });

  describe('classifyDomain', () => {
    it('classifies GSC-only insight types as search', () => {
      expect(classifyDomain('ranking_mover')).toBe('search');
      expect(classifyDomain('ctr_opportunity')).toBe('search');
      expect(classifyDomain('ranking_opportunity')).toBe('search');
      expect(classifyDomain('serp_opportunity')).toBe('search');
      expect(classifyDomain('cannibalization')).toBe('search');
    });
    it('classifies GA4-centric types as traffic', () => {
      expect(classifyDomain('conversion_attribution')).toBe('traffic');
    });
    it('classifies mixed types as cross', () => {
      expect(classifyDomain('page_health')).toBe('cross');
      expect(classifyDomain('content_decay')).toBe('cross');
      expect(classifyDomain('keyword_cluster')).toBe('cross');
      expect(classifyDomain('competitor_gap')).toBe('cross');
      expect(classifyDomain('strategy_alignment')).toBe('cross');
      expect(classifyDomain('anomaly_digest')).toBe('cross');
    });
  });

  describe('checkStrategyAlignment', () => {
    function makeMap(pagePath: string, primaryKeyword: string, secondaryKeywords: string[] = []): Map<string, PageKeywordMap> {
      const entry: PageKeywordMap = {
        pagePath,
        pageTitle: 'Test Page',
        primaryKeyword,
        secondaryKeywords,
      };
      return new Map([[pagePath, entry]]);
    }

    it('returns untracked when page is not in strategy map', () => {
      const map = makeMap('/about', 'about us');
      const result = checkStrategyAlignment('/services', map);
      expect(result.alignment).toBe('untracked');
      expect(result.keyword).toBeNull();
    });

    it('returns aligned when actual keyword matches primary keyword', () => {
      const map = makeMap('/services', 'seo agency');
      const result = checkStrategyAlignment('/services', map, 'seo agency');
      expect(result.alignment).toBe('aligned');
      expect(result.keyword).toBe('seo agency');
    });

    it('returns aligned when actual keyword matches a secondary keyword', () => {
      const map = makeMap('/services', 'seo agency', ['digital marketing', 'seo services']);
      const result = checkStrategyAlignment('/services', map, 'seo services');
      expect(result.alignment).toBe('aligned');
    });

    it('returns misaligned when page is in strategy but ranking for a different keyword', () => {
      const map = makeMap('/services', 'seo agency');
      // Page should target "seo agency" but this insight is about "web design"
      const result = checkStrategyAlignment('/services', map, 'web design');
      expect(result.alignment).toBe('misaligned');
      expect(result.keyword).toBe('seo agency');
    });

    it('returns aligned (not misaligned) when no actualKeyword is provided', () => {
      const map = makeMap('/services', 'seo agency');
      const result = checkStrategyAlignment('/services', map);
      expect(result.alignment).toBe('aligned');
    });

    it('normalises URL to pathname for lookup', () => {
      const map = makeMap('/services', 'seo agency');
      const result = checkStrategyAlignment('https://example.com/services', map, 'web design');
      expect(result.alignment).toBe('misaligned');
    });

    it('comparison is case-insensitive', () => {
      const map = makeMap('/services', 'SEO Agency');
      const result = checkStrategyAlignment('/services', map, 'seo agency');
      expect(result.alignment).toBe('aligned');
    });
  });

  describe('computeImpactScore', () => {
    it('scores critical severity highest', () => {
      const critical = computeImpactScore('critical', { clicks: 100 });
      const warning = computeImpactScore('warning', { clicks: 100 });
      expect(critical).toBeGreaterThan(warning);
    });
    it('factors in traffic volume', () => {
      const highTraffic = computeImpactScore('warning', { clicks: 10000 });
      const lowTraffic = computeImpactScore('warning', { clicks: 10 });
      expect(highTraffic).toBeGreaterThan(lowTraffic);
    });
  });
});
