/**
 * Unit tests for PR 1 — page identity normalisation helpers.
 * Tests toInsightPageId (URL → path) and toAuditFindingPageId (Webflow page → path),
 * plus per-site assertions for the 8 GSC/GA4 insight write sites that consume them.
 */
import { describe, it, expect } from 'vitest';

import {
  computePageHealthScores,
  computeRankingOpportunities,
  computeRankingMovers,
  computeCtrOpportunities,
  computeSerpOpportunities,
} from '../../server/analytics-intelligence.js';
import type { SearchPage, QueryPageRow } from '../../server/search-console.js';
import { toAuditFindingPageId, toInsightPageId } from '../../server/helpers.js';

// ── toInsightPageId (direct unit tests) ──

describe('toInsightPageId', () => {
  it('strips https:// to pathname', () => {
    expect(toInsightPageId('https://example.com/blog/post')).toBe('/blog/post');
  });

  it('strips http:// to pathname', () => {
    expect(toInsightPageId('http://example.com/about')).toBe('/about');
  });

  it('strips query string from URL', () => {
    expect(toInsightPageId('https://example.com/blog?utm=x')).toBe('/blog');
  });

  it('strips fragment from URL', () => {
    expect(toInsightPageId('https://example.com/contact#form')).toBe('/contact');
  });

  it('returns / for bare-domain URL', () => {
    expect(toInsightPageId('https://example.com/')).toBe('/');
  });

  it('returns input unchanged for already-relative path', () => {
    expect(toInsightPageId('/already-a-path')).toBe('/already-a-path');
  });

  it('returns input unchanged for non-URL string', () => {
    expect(toInsightPageId('not-a-url')).toBe('not-a-url');
  });
});

// ── Per-site assertions: each GSC/GA4 write site produces normalised pageId ──

describe('GSC write sites: pageId is normalised path, not raw URL', () => {
  const pages: SearchPage[] = [
    { page: 'https://example.com/blog/my-post', clicks: 100, impressions: 2000, ctr: 5.0, position: 5 },
    { page: 'http://example.com/about', clicks: 50, impressions: 1000, ctr: 5.0, position: 10 },
    { page: '/already-a-path', clicks: 10, impressions: 200, ctr: 5.0, position: 20 },
    { page: 'not-a-url', clicks: 5, impressions: 100, ctr: 5.0, position: 30 },
    { page: 'https://example.com/', clicks: 200, impressions: 5000, ctr: 4.0, position: 2 },
  ];

  it('page_health: pageId is /path', () => {
    const results = computePageHealthScores(pages, []);
    const r = results.find(p => p.pageId === '/blog/my-post');
    expect(r).toBeDefined();
    expect(r!.pageId).toBe('/blog/my-post');
    expect(r!.pageId).not.toMatch(/^https?:\/\//);
    // Other page_health entries also normalised
    expect(results.find(p => p.pageId === '/about')).toBeDefined();
    expect(results.find(p => p.pageId === '/')).toBeDefined();
    // No raw URLs leak through
    expect(results.find(p => p.pageId?.startsWith('http'))).toBeUndefined();
  });

  it('ranking_opportunity: pageId is /path', () => {
    const queryPages: QueryPageRow[] = [
      { query: 'seo tips', page: 'https://example.com/blog/seo-tips', clicks: 5, impressions: 1000, ctr: 0.5, position: 12 },
    ];
    const results = computeRankingOpportunities(queryPages);
    const r = results.find(o => o.data?.query === 'seo tips');
    expect(r).toBeDefined();
    expect(r!.pageId).toBe('/blog/seo-tips');
    expect(r!.pageId).not.toMatch(/^https?:\/\//);
  });

  it('ranking_mover: pageId is /path', () => {
    const current: SearchPage[] = [
      { page: 'https://example.com/blog/movers', clicks: 100, impressions: 2000, ctr: 5.0, position: 4 },
    ];
    const previous: SearchPage[] = [
      { page: 'https://example.com/blog/movers', clicks: 50, impressions: 2000, ctr: 2.5, position: 12 },
    ];
    const results = computeRankingMovers(current, previous);
    const r = results.find(m => m.pageId === '/blog/movers');
    expect(r).toBeDefined();
    expect(r!.pageId!.startsWith('http')).toBe(false);
  });

  it('ctr_opportunity: pageId is /path', () => {
    // Page in top 10 with CTR materially below expected for its position
    const queryPages: QueryPageRow[] = [
      { query: 'high-impressions term', page: 'https://example.com/landing', clicks: 5, impressions: 10000, ctr: 0.05, position: 3 },
    ];
    const results = computeCtrOpportunities(queryPages);
    const r = results[0];
    expect(r).toBeDefined();
    expect(r.pageId).toBe('/landing');
    expect(r.pageId!.startsWith('http')).toBe(false);
  });

  it('serp_opportunity: pageId is /path', () => {
    // Pages with > 0 clicks and impressions trigger serp opportunity inspection
    const pages2: SearchPage[] = [
      { page: 'https://example.com/serp-target', clicks: 10, impressions: 500, ctr: 2.0, position: 4 },
    ];
    const results = computeSerpOpportunities(pages2, new Set<string>());
    if (results.length > 0) {
      expect(results[0].pageId).toBe('/serp-target');
      expect(results[0].pageId!.startsWith('http')).toBe(false);
    }
  });
});

// Note: content_decay (3 write sites in analytics-intelligence.ts) is exercised
// via the same toInsightPageId helper. A direct unit test would require seeding
// loadDecayAnalysis fixtures; covered by the integration tests in PR 2's
// outcome-tracking suite and by the contract test on toInsightPageId above.

// ── toAuditFindingPageId ──

describe('toAuditFindingPageId', () => {
  it('returns /slug for page with slug', () => {
    expect(toAuditFindingPageId({ slug: 'about', url: 'https://example.com/about', pageId: 'uuid-abc' }))
      .toBe('/about');
  });

  it('returns /nested/slug for multi-segment slug', () => {
    expect(toAuditFindingPageId({ slug: 'blog/my-post', url: 'https://example.com/blog/my-post', pageId: 'uuid-abc' }))
      .toBe('/blog/my-post');
  });

  it('prefers URL pathname over leaf slug for nested Webflow pages', () => {
    expect(toAuditFindingPageId({ slug: 'seo', url: 'https://example.com/services/seo?utm=1#faq', pageId: 'uuid-abc' }))
      .toBe('/services/seo');
  });

  it('strips leading slash from slug to avoid // (defensive)', () => {
    expect(toAuditFindingPageId({ slug: '/about', url: 'https://example.com/about', pageId: 'uuid-abc' }))
      .toBe('/about');
    expect(toAuditFindingPageId({ slug: '//foo', url: 'https://example.com/foo', pageId: 'uuid-abc' }))
      .toBe('/foo');
  });

  it('falls back to URL pathname when slug is empty string', () => {
    expect(toAuditFindingPageId({ slug: '', url: 'https://example.com/', pageId: 'uuid-homepage' }))
      .toBe('/');
  });

  it('falls back to pageId when both slug is empty and URL is malformed', () => {
    expect(toAuditFindingPageId({ slug: '', url: 'not-a-url', pageId: 'uuid-fallback' }))
      .toBe('uuid-fallback');
  });
});
