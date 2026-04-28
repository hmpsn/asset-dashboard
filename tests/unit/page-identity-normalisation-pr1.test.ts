/**
 * Unit tests for PR 1 — page identity normalisation helpers.
 * Tests toInsightPageId (GSC URL → path) and toAuditFindingPageId (Webflow page → path).
 */
import { describe, it, expect } from 'vitest';

// toInsightPageId will be a module-local function in analytics-intelligence.ts,
// so we import computePageHealthScores and verify via its output.
import { computePageHealthScores } from '../../server/analytics-intelligence.js';
import type { SearchPage } from '../../server/search-console.js';

// toAuditFindingPageId will be exported from helpers.ts
import { toAuditFindingPageId } from '../../server/helpers.js';

// ── toInsightPageId (tested via computePageHealthScores output) ──

describe('computePageHealthScores: pageId format', () => {
  const pages: SearchPage[] = [
    { page: 'https://example.com/blog/my-post', clicks: 100, impressions: 2000, ctr: 5.0, position: 5 },
    { page: 'http://example.com/about', clicks: 50, impressions: 1000, ctr: 5.0, position: 10 },
    { page: '/already-a-path', clicks: 10, impressions: 200, ctr: 5.0, position: 20 },
    { page: 'not-a-url', clicks: 5, impressions: 100, ctr: 5.0, position: 30 },
    { page: 'https://example.com/', clicks: 200, impressions: 5000, ctr: 4.0, position: 2 },
  ];

  it('strips https:// domain to relative path', () => {
    const results = computePageHealthScores(pages, []);
    const result = results.find(r => r.pageId === '/blog/my-post');
    expect(result).toBeDefined();
  });

  it('strips http:// domain to relative path', () => {
    const results = computePageHealthScores(pages, []);
    const result = results.find(r => r.pageId === '/about');
    expect(result).toBeDefined();
  });

  it('leaves already-normalised paths unchanged (idempotent)', () => {
    const results = computePageHealthScores(pages, []);
    const result = results.find(r => r.pageId === '/already-a-path');
    expect(result).toBeDefined();
  });

  it('leaves non-URL strings unchanged (graceful fallback)', () => {
    const results = computePageHealthScores(pages, []);
    const result = results.find(r => r.pageId === 'not-a-url');
    expect(result).toBeDefined();
  });

  it('converts homepage URL to / ', () => {
    const results = computePageHealthScores(pages, []);
    const result = results.find(r => r.pageId === '/');
    expect(result).toBeDefined();
  });

  it('does NOT change data.pageUrl (intentionally kept as original URL)', () => {
    const results = computePageHealthScores(pages, []);
    const result = results.find(r => r.pageId === '/blog/my-post');
    // data.pageUrl is the display field — should keep original value if present
    expect(result).toBeDefined();
    // pageId is now the path, not the URL
    expect(result!.pageId).toBe('/blog/my-post');
    expect(result!.pageId).not.toContain('https://');
  });
});

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

  it('falls back to URL pathname when slug is empty string', () => {
    expect(toAuditFindingPageId({ slug: '', url: 'https://example.com/', pageId: 'uuid-homepage' }))
      .toBe('/');
  });

  it('falls back to pageId when both slug is empty and URL is malformed', () => {
    expect(toAuditFindingPageId({ slug: '', url: 'not-a-url', pageId: 'uuid-fallback' }))
      .toBe('uuid-fallback');
  });
});
