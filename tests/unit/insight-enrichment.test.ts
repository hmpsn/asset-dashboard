import { describe, it, expect } from 'vitest';
import {
  resolvePageTitle,
  computeImpactScore,
  classifyDomain,
  cleanSlugToTitle,
} from '../../server/insight-enrichment.js';

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
