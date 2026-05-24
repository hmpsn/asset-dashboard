/**
 * Unit tests for pure helper functions in server/keyword-strategy-ai-synthesis.ts.
 *
 * All AI callers (callKeywordStrategyAI, synthesizeKeywordStrategy) are excluded —
 * this file covers only the deterministic data-transformation helpers that were
 * extracted and exported for testability.
 */

import { describe, it, expect } from 'vitest';
import {
  buildKeywordPoolSection,
  detectKeywordConflicts,
  buildConflictNote,
  buildKeywordSummaryLine,
  buildFallbackKeywordFromPageIdentity,
  buildPeriodComparisonBlock,
  buildGscQueriesBlock,
  buildDeviceBreakdownBlock,
  buildCountryBreakdownBlock,
  findUnmappedLandingPages,
  findHighBounceLandingPages,
  filterDeclinedSiteKeywords,
  filterDeclinedContentGaps,
  buildTopConvertingPages,
  KeywordStrategySynthesisError,
} from '../../server/keyword-strategy-ai-synthesis.js';

// Simple normalizer that mirrors the real normalizeKeyword behaviour for tests.
function norm(kw: string): string {
  return String(kw ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── KeywordStrategySynthesisError ────────────────────────────────────────────

describe('KeywordStrategySynthesisError', () => {
  it('carries statusCode and payload', () => {
    const err = new KeywordStrategySynthesisError(500, { error: 'bad', raw: 'rawText' });
    expect(err.statusCode).toBe(500);
    expect(err.payload.error).toBe('bad');
    expect(err.payload.raw).toBe('rawText');
  });

  it('sets name to KeywordStrategySynthesisError', () => {
    const err = new KeywordStrategySynthesisError(422, { error: 'invalid' });
    expect(err.name).toBe('KeywordStrategySynthesisError');
  });

  it('message equals the error field', () => {
    const err = new KeywordStrategySynthesisError(400, { error: 'oops' });
    expect(err.message).toBe('oops');
  });

  it('is an instance of Error', () => {
    const err = new KeywordStrategySynthesisError(500, { error: 'x' });
    expect(err instanceof Error).toBe(true);
  });
});

// ── buildKeywordPoolSection ──────────────────────────────────────────────────

describe('buildKeywordPoolSection', () => {
  it('returns empty string for an empty pool', () => {
    const result = buildKeywordPoolSection(new Map());
    expect(result).toBe('');
  });

  it('includes keyword and volume in the output', () => {
    const pool = new Map([
      ['seo tools', { volume: 5000, difficulty: 40, source: 'semrush' }],
    ]);
    const result = buildKeywordPoolSection(pool);
    expect(result).toContain('"seo tools"');
    expect(result).toContain('5000/mo');
  });

  it('includes KD when difficulty is non-zero', () => {
    const pool = new Map([
      ['web analytics', { volume: 1200, difficulty: 35, source: 'semrush' }],
    ]);
    const result = buildKeywordPoolSection(pool);
    expect(result).toContain('KD:35%');
  });

  it('omits KD when difficulty is zero', () => {
    const pool = new Map([
      ['brand analytics', { volume: 100, difficulty: 0, source: 'gsc' }],
    ]);
    const result = buildKeywordPoolSection(pool);
    expect(result).not.toContain('KD:0%');
  });

  it('includes CLIENT-REQUESTED note when client keywords exist', () => {
    const pool = new Map([
      ['seo audit', { volume: 800, difficulty: 20, source: 'client' }],
    ]);
    const result = buildKeywordPoolSection(pool);
    expect(result).toContain('CLIENT-REQUESTED KEYWORDS');
    expect(result).toContain('"seo audit"');
  });

  it('omits CLIENT-REQUESTED note when no client keywords', () => {
    const pool = new Map([
      ['analytics platform', { volume: 3000, difficulty: 50, source: 'semrush' }],
    ]);
    const result = buildKeywordPoolSection(pool);
    expect(result).not.toContain('CLIENT-REQUESTED KEYWORDS');
  });

  it('respects maxKeywords limit and sorts by volume descending', () => {
    const pool = new Map<string, { volume: number; difficulty: number; source: string }>();
    for (let i = 1; i <= 10; i++) {
      pool.set(`keyword-${i}`, { volume: i * 100, difficulty: 0, source: 'semrush' });
    }
    // Only top 3 should appear
    const result = buildKeywordPoolSection(pool, 3);
    expect(result).toContain('"keyword-10"'); // highest volume
    expect(result).not.toContain('"keyword-1"'); // lowest volume, cut off
  });

  it('contains KEYWORD POOL header', () => {
    const pool = new Map([['test keyword', { volume: 100, difficulty: 0, source: 'gsc' }]]);
    const result = buildKeywordPoolSection(pool);
    expect(result).toContain('KEYWORD POOL');
  });
});

// ── detectKeywordConflicts ───────────────────────────────────────────────────

describe('detectKeywordConflicts', () => {
  it('returns empty array when no conflicts', () => {
    const mappings = [
      { pagePath: '/about', primaryKeyword: 'about us' },
      { pagePath: '/services', primaryKeyword: 'seo services' },
    ];
    expect(detectKeywordConflicts(mappings, norm)).toHaveLength(0);
  });

  it('detects a conflict when two pages share the same keyword', () => {
    const mappings = [
      { pagePath: '/blog', primaryKeyword: 'seo tips' },
      { pagePath: '/resources', primaryKeyword: 'seo tips' },
    ];
    const conflicts = detectKeywordConflicts(mappings, norm);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0][0]).toBe('seo tips');
    expect(conflicts[0][1]).toContain('/blog');
    expect(conflicts[0][1]).toContain('/resources');
  });

  it('normalizes keywords before comparing', () => {
    const mappings = [
      { pagePath: '/a', primaryKeyword: 'SEO Tools' },
      { pagePath: '/b', primaryKeyword: 'seo tools' },
    ];
    const conflicts = detectKeywordConflicts(mappings, norm);
    expect(conflicts).toHaveLength(1);
  });

  it('ignores pages with empty primary keyword', () => {
    const mappings = [
      { pagePath: '/a', primaryKeyword: '' },
      { pagePath: '/b', primaryKeyword: '' },
    ];
    expect(detectKeywordConflicts(mappings, norm)).toHaveLength(0);
  });

  it('returns empty array for an empty mappings list', () => {
    expect(detectKeywordConflicts([], norm)).toHaveLength(0);
  });

  it('detects multiple distinct conflicts', () => {
    const mappings = [
      { pagePath: '/a', primaryKeyword: 'keyword one' },
      { pagePath: '/b', primaryKeyword: 'keyword one' },
      { pagePath: '/c', primaryKeyword: 'keyword two' },
      { pagePath: '/d', primaryKeyword: 'keyword two' },
    ];
    const conflicts = detectKeywordConflicts(mappings, norm);
    expect(conflicts).toHaveLength(2);
  });
});

// ── buildConflictNote ────────────────────────────────────────────────────────

describe('buildConflictNote', () => {
  it('returns empty string for no conflicts', () => {
    expect(buildConflictNote([])).toBe('');
  });

  it('mentions conflicting keyword and pages', () => {
    const conflicts: Array<[string, string[]]> = [
      ['seo tips', ['/blog', '/resources']],
    ];
    const note = buildConflictNote(conflicts);
    expect(note).toContain('seo tips');
    expect(note).toContain('/blog');
    expect(note).toContain('/resources');
  });

  it('instructs AI to add keywordFixes', () => {
    const conflicts: Array<[string, string[]]> = [['duplicate', ['/a', '/b']]];
    const note = buildConflictNote(conflicts);
    expect(note).toContain('keywordFixes');
  });

  it('includes KEYWORD CONFLICTS header', () => {
    const conflicts: Array<[string, string[]]> = [['keyword', ['/x', '/y']]];
    const note = buildConflictNote(conflicts);
    expect(note).toContain('KEYWORD CONFLICTS');
  });
});

// ── buildKeywordSummaryLine ──────────────────────────────────────────────────

describe('buildKeywordSummaryLine', () => {
  it('formats path and keyword', () => {
    const line = buildKeywordSummaryLine('/about', 'about us');
    expect(line).toBe('/about: "about us"');
  });

  it('handles empty keyword', () => {
    const line = buildKeywordSummaryLine('/home', '');
    expect(line).toBe('/home: ""');
  });

  it('handles root path', () => {
    const line = buildKeywordSummaryLine('/', 'homepage seo');
    expect(line).toBe('/: "homepage seo"');
  });
});

// ── buildFallbackKeywordFromPageIdentity ─────────────────────────────────────

describe('buildFallbackKeywordFromPageIdentity', () => {
  it('prefers seoTitle over title', () => {
    const page = { seoTitle: 'SEO Services', title: 'Our Services' };
    const result = buildFallbackKeywordFromPageIdentity('/services', page, norm);
    expect(result).toBe('seo services');
  });

  it('falls back to title when seoTitle is absent', () => {
    const page = { seoTitle: null, title: 'About Us' };
    const result = buildFallbackKeywordFromPageIdentity('/about', page, norm);
    expect(result).toBe('about us');
  });

  it('falls back to slug when page has no title', () => {
    const page = { seoTitle: null, title: null };
    const result = buildFallbackKeywordFromPageIdentity('/keyword-research-tool', page, norm);
    // slugFallback = "keyword research tool"
    expect(result).toContain('keyword');
    expect(result).toContain('research');
  });

  it('handles undefined page (path is the only input)', () => {
    const result = buildFallbackKeywordFromPageIdentity('/seo-audit-checklist', undefined, norm);
    expect(result).toContain('seo');
    expect(result).toContain('audit');
  });

  it('returns null when pagePath is root and page is undefined', () => {
    // "/" splits to [] filter(Boolean) → "" → normalizer returns "" → null
    const result = buildFallbackKeywordFromPageIdentity('/', undefined, norm);
    expect(result).toBeNull();
  });

  it('normalizes the extracted keyword', () => {
    const page = { seoTitle: 'SEO & Analytics', title: null };
    const result = buildFallbackKeywordFromPageIdentity('/analytics', page, norm);
    // & should be stripped by normalizer
    expect(result).not.toContain('&');
  });
});

// ── buildPeriodComparisonBlock ───────────────────────────────────────────────

describe('buildPeriodComparisonBlock', () => {
  it('returns empty string for null', () => {
    expect(buildPeriodComparisonBlock(null)).toBe('');
  });

  it('returns empty string for undefined', () => {
    expect(buildPeriodComparisonBlock(undefined)).toBe('');
  });

  it('includes clicks change with + sign for positive', () => {
    const result = buildPeriodComparisonBlock({
      change: { clicks: 50, impressions: 200, position: -1 },
      changePercent: { clicks: 10, impressions: 5, position: -2 },
    });
    expect(result).toContain('+50');
    expect(result).toContain('+10%');
  });

  it('includes negative clicks without + sign', () => {
    const result = buildPeriodComparisonBlock({
      change: { clicks: -30, impressions: -100, position: 0.5 },
      changePercent: { clicks: -5, impressions: -3, position: 2 },
    });
    expect(result).toContain('-30');
    expect(result).not.toContain('+-30');
  });

  it('labels positive position change as declining', () => {
    const result = buildPeriodComparisonBlock({
      change: { clicks: 0, impressions: 0, position: 1 },
      changePercent: { clicks: 0, impressions: 0, position: 5 },
    });
    expect(result).toContain('declining');
  });

  it('labels negative position change as improving', () => {
    const result = buildPeriodComparisonBlock({
      change: { clicks: 0, impressions: 0, position: -1 },
      changePercent: { clicks: 0, impressions: 0, position: -5 },
    });
    expect(result).toContain('improving');
  });

  it('labels zero position change as stable', () => {
    const result = buildPeriodComparisonBlock({
      change: { clicks: 0, impressions: 0, position: 0 },
      changePercent: { clicks: 0, impressions: 0, position: 0 },
    });
    expect(result).toContain('stable');
  });

  it('contains PERIOD COMPARISON header', () => {
    const result = buildPeriodComparisonBlock({
      change: { clicks: 10, impressions: 50, position: -0.5 },
      changePercent: { clicks: 5, impressions: 3, position: -2 },
    });
    expect(result).toContain('PERIOD COMPARISON');
  });
});

// ── buildGscQueriesBlock ─────────────────────────────────────────────────────

describe('buildGscQueriesBlock', () => {
  it('returns empty string for empty array', () => {
    expect(buildGscQueriesBlock([])).toBe('');
  });

  it('includes the top query', () => {
    const rows = [
      { page: 'https://example.com/blog', query: 'seo guide', position: 3.5, clicks: 50, impressions: 800 },
    ];
    const result = buildGscQueriesBlock(rows);
    expect(result).toContain('"seo guide"');
    expect(result).toContain('/blog');
  });

  it('sorts by impressions descending and caps at 30', () => {
    const rows = Array.from({ length: 50 }, (_, i) => ({
      page: `https://example.com/page-${i}`,
      query: `query ${i}`,
      position: 5,
      clicks: i,
      impressions: i * 100,
    }));
    const result = buildGscQueriesBlock(rows);
    // highest impression = query 49 (49*100=4900)
    expect(result).toContain('"query 49"');
    // lowest impression = query 0 — should be cut off (only top 30)
    expect(result).not.toContain('"query 0"');
  });

  it('handles non-URL page values gracefully', () => {
    const rows = [
      { page: '/relative-path', query: 'test', position: 2.0, clicks: 5, impressions: 100 },
    ];
    // Should not throw
    const result = buildGscQueriesBlock(rows);
    expect(result).toContain('"test"');
    expect(result).toContain('/relative-path');
  });

  it('includes position, clicks, and impressions', () => {
    const rows = [
      { page: 'https://site.com/', query: 'example', position: 7.3, clicks: 12, impressions: 220 },
    ];
    const result = buildGscQueriesBlock(rows);
    expect(result).toContain('7.3');
    expect(result).toContain('12');
    expect(result).toContain('220');
  });
});

// ── buildDeviceBreakdownBlock ────────────────────────────────────────────────

describe('buildDeviceBreakdownBlock', () => {
  it('returns empty string for empty array', () => {
    expect(buildDeviceBreakdownBlock([])).toBe('');
  });

  it('includes all devices', () => {
    const result = buildDeviceBreakdownBlock([
      { device: 'MOBILE', clicks: 300, impressions: 5000, ctr: 6.0, position: 8.2 },
      { device: 'DESKTOP', clicks: 200, impressions: 2000, ctr: 10.0, position: 5.0 },
    ]);
    expect(result).toContain('MOBILE');
    expect(result).toContain('DESKTOP');
  });

  it('appends mobile gap warning when mobile dominates and position is worse', () => {
    const result = buildDeviceBreakdownBlock([
      { device: 'MOBILE', clicks: 400, impressions: 8000, ctr: 5.0, position: 12.0 },
      { device: 'DESKTOP', clicks: 300, impressions: 3000, ctr: 10.0, position: 4.0 },
    ]);
    expect(result).toContain('MOBILE GAP');
    expect(result).toContain('mobile optimization is critical');
  });

  it('does NOT append mobile gap warning when mobile position is similar to desktop', () => {
    const result = buildDeviceBreakdownBlock([
      { device: 'MOBILE', clicks: 400, impressions: 8000, ctr: 5.0, position: 5.5 },
      { device: 'DESKTOP', clicks: 300, impressions: 3000, ctr: 10.0, position: 4.5 },
    ]);
    // Mobile position is only 1 worse (not >2)
    expect(result).not.toContain('MOBILE GAP');
  });

  it('does NOT append mobile gap when desktop has more impressions', () => {
    const result = buildDeviceBreakdownBlock([
      { device: 'MOBILE', clicks: 100, impressions: 1000, ctr: 10.0, position: 15.0 },
      { device: 'DESKTOP', clicks: 500, impressions: 5000, ctr: 10.0, position: 5.0 },
    ]);
    expect(result).not.toContain('MOBILE GAP');
  });

  it('contains DEVICE BREAKDOWN header', () => {
    const result = buildDeviceBreakdownBlock([
      { device: 'TABLET', clicks: 50, impressions: 500, ctr: 10.0, position: 6.0 },
    ]);
    expect(result).toContain('DEVICE BREAKDOWN');
  });
});

// ── buildCountryBreakdownBlock ───────────────────────────────────────────────

describe('buildCountryBreakdownBlock', () => {
  it('returns empty string for empty array', () => {
    expect(buildCountryBreakdownBlock([])).toBe('');
  });

  it('includes country name, clicks, impressions, and position', () => {
    const result = buildCountryBreakdownBlock([
      { country: 'United States', clicks: 1000, impressions: 20000, position: 4.5 },
    ]);
    expect(result).toContain('United States');
    expect(result).toContain('1000 clicks');
    expect(result).toContain('20000 imp');
    expect(result).toContain('pos 4.5');
  });

  it('limits to top 5 countries', () => {
    const countries = Array.from({ length: 8 }, (_, i) => ({
      country: `Country ${i + 1}`,
      clicks: (8 - i) * 100,
      impressions: (8 - i) * 1000,
      position: 5.0,
    }));
    const result = buildCountryBreakdownBlock(countries);
    expect(result).toContain('Country 1');
    expect(result).not.toContain('Country 6');
    expect(result).not.toContain('Country 7');
    expect(result).not.toContain('Country 8');
  });

  it('contains TOP COUNTRIES header', () => {
    const result = buildCountryBreakdownBlock([
      { country: 'Canada', clicks: 500, impressions: 8000, position: 6.0 },
    ]);
    expect(result).toContain('TOP COUNTRIES');
  });
});

// ── findUnmappedLandingPages ─────────────────────────────────────────────────

describe('findUnmappedLandingPages', () => {
  it('returns all pages when none are mapped', () => {
    const pages = [
      { landingPage: '/a', sessions: 10, users: 8, bounceRate: 50 },
      { landingPage: '/b', sessions: 5, users: 4, bounceRate: 60 },
    ];
    const mapped = new Set<string>();
    expect(findUnmappedLandingPages(pages, mapped)).toHaveLength(2);
  });

  it('excludes pages that are already in the mapped set', () => {
    const pages = [
      { landingPage: '/a', sessions: 10, users: 8, bounceRate: 50 },
      { landingPage: '/b', sessions: 5, users: 4, bounceRate: 60 },
    ];
    const mapped = new Set(['/a']);
    const result = findUnmappedLandingPages(pages, mapped);
    expect(result).toHaveLength(1);
    expect(result[0].landingPage).toBe('/b');
  });

  it('returns empty array when all pages are mapped', () => {
    const pages = [{ landingPage: '/x', sessions: 1, users: 1, bounceRate: 30 }];
    const mapped = new Set(['/x']);
    expect(findUnmappedLandingPages(pages, mapped)).toHaveLength(0);
  });

  it('returns empty array when input is empty', () => {
    expect(findUnmappedLandingPages([], new Set())).toHaveLength(0);
  });
});

// ── findHighBounceLandingPages ───────────────────────────────────────────────

describe('findHighBounceLandingPages', () => {
  it('returns pages with bounceRate > 70 AND sessions > 5', () => {
    const pages = [
      { landingPage: '/high', sessions: 10, users: 8, bounceRate: 85 },
      { landingPage: '/low-bounce', sessions: 20, users: 18, bounceRate: 30 },
      { landingPage: '/high-but-low-sessions', sessions: 3, users: 3, bounceRate: 90 },
    ];
    const result = findHighBounceLandingPages(pages);
    expect(result).toHaveLength(1);
    expect(result[0].landingPage).toBe('/high');
  });

  it('returns empty array when no pages qualify', () => {
    const pages = [
      { landingPage: '/a', sessions: 2, users: 2, bounceRate: 80 },  // sessions ≤ 5
      { landingPage: '/b', sessions: 20, users: 18, bounceRate: 65 }, // bounce ≤ 70
    ];
    expect(findHighBounceLandingPages(pages)).toHaveLength(0);
  });

  it('includes a page exactly at boundary values (strictly >70, >5)', () => {
    const pages = [
      { landingPage: '/boundary', sessions: 6, users: 5, bounceRate: 71 },
      { landingPage: '/exact70', sessions: 10, users: 9, bounceRate: 70 }, // not > 70
    ];
    const result = findHighBounceLandingPages(pages);
    expect(result).toHaveLength(1);
    expect(result[0].landingPage).toBe('/boundary');
  });

  it('returns empty array for empty input', () => {
    expect(findHighBounceLandingPages([])).toHaveLength(0);
  });
});

// ── filterDeclinedSiteKeywords ───────────────────────────────────────────────

describe('filterDeclinedSiteKeywords', () => {
  it('removes keywords in the declined set', () => {
    const declined = new Set(['seo spam', 'black hat seo']);
    const siteKws = ['seo tips', 'seo spam', 'content marketing'];
    const result = filterDeclinedSiteKeywords(siteKws, declined, norm);
    expect(result).not.toContain('seo spam');
    expect(result).toContain('seo tips');
    expect(result).toContain('content marketing');
  });

  it('returns the full list when declined set is empty', () => {
    const siteKws = ['keyword a', 'keyword b'];
    const result = filterDeclinedSiteKeywords(siteKws, new Set(), norm);
    expect(result).toHaveLength(2);
  });

  it('returns empty array when all keywords are declined', () => {
    const declined = new Set(['kw1', 'kw2']);
    const result = filterDeclinedSiteKeywords(['kw1', 'kw2'], declined, norm);
    expect(result).toHaveLength(0);
  });

  it('does not mutate the input array', () => {
    const siteKws = ['bad keyword', 'good keyword'];
    const declined = new Set(['bad keyword']);
    const result = filterDeclinedSiteKeywords(siteKws, declined, norm);
    expect(siteKws).toHaveLength(2); // unchanged
    expect(result).toHaveLength(1);
  });

  it('uses the normalizer for case-insensitive matching', () => {
    const declined = new Set(['seo spam']); // already normalized
    const siteKws = ['SEO Spam', 'Good Keyword'];
    const result = filterDeclinedSiteKeywords(siteKws, declined, norm);
    expect(result).not.toContain('SEO Spam');
    expect(result).toContain('Good Keyword');
  });
});

// ── filterDeclinedContentGaps ────────────────────────────────────────────────

describe('filterDeclinedContentGaps', () => {
  it('removes content gaps whose targetKeyword is declined', () => {
    const declined = new Set(['bad topic']);
    const gaps = [
      { targetKeyword: 'good topic', topic: 'Good' },
      { targetKeyword: 'bad topic', topic: 'Bad' },
    ];
    const result = filterDeclinedContentGaps(gaps, declined, norm);
    expect(result).toHaveLength(1);
    expect(result[0].targetKeyword).toBe('good topic');
  });

  it('keeps gaps with no targetKeyword', () => {
    const declined = new Set(['anything']);
    const gaps = [{ topic: 'No keyword' }];
    const result = filterDeclinedContentGaps(gaps, declined, norm);
    expect(result).toHaveLength(1);
  });

  it('returns all gaps when declined set is empty', () => {
    const gaps = [
      { targetKeyword: 'a', topic: 'A' },
      { targetKeyword: 'b', topic: 'B' },
    ];
    const result = filterDeclinedContentGaps(gaps, new Set(), norm);
    expect(result).toHaveLength(2);
  });

  it('does not mutate the input array', () => {
    const gaps = [{ targetKeyword: 'declined kw', topic: 'Topic' }];
    const declined = new Set(['declined kw']);
    const result = filterDeclinedContentGaps(gaps, declined, norm);
    expect(gaps).toHaveLength(1); // original unchanged
    expect(result).toHaveLength(0);
  });

  it('handles empty gap array', () => {
    expect(filterDeclinedContentGaps([], new Set(['any']), norm)).toHaveLength(0);
  });
});

// ── buildTopConvertingPages ──────────────────────────────────────────────────

describe('buildTopConvertingPages', () => {
  it('returns empty array for empty input', () => {
    expect(buildTopConvertingPages([])).toHaveLength(0);
  });

  it('groups multiple events by page and keeps the max event count', () => {
    const events = [
      { pagePath: '/contact', eventName: 'form_start', eventCount: 30 },
      { pagePath: '/contact', eventName: 'form_submit', eventCount: 15 },
    ];
    const result = buildTopConvertingPages(events);
    expect(result).toHaveLength(1);
    expect(result[0][1].events).toBe(30);
    expect(result[0][1].topEvent).toBe('form_start');
  });

  it('sorts pages by event count descending', () => {
    const events = [
      { pagePath: '/blog', eventName: 'scroll', eventCount: 100 },
      { pagePath: '/pricing', eventName: 'click_cta', eventCount: 500 },
      { pagePath: '/about', eventName: 'view', eventCount: 50 },
    ];
    const result = buildTopConvertingPages(events);
    expect(result[0][0]).toBe('/pricing');
    expect(result[result.length - 1][0]).toBe('/about');
  });

  it('respects the limit parameter', () => {
    const events = Array.from({ length: 20 }, (_, i) => ({
      pagePath: `/page-${i}`,
      eventName: 'click',
      eventCount: 100 - i,
    }));
    const result = buildTopConvertingPages(events, 5);
    expect(result).toHaveLength(5);
  });

  it('defaults to limit of 8', () => {
    const events = Array.from({ length: 15 }, (_, i) => ({
      pagePath: `/page-${i}`,
      eventName: 'click',
      eventCount: 100 - i,
    }));
    const result = buildTopConvertingPages(events);
    expect(result).toHaveLength(8);
  });

  it('handles a single page with a single event', () => {
    const events = [{ pagePath: '/home', eventName: 'signup', eventCount: 42 }];
    const result = buildTopConvertingPages(events);
    expect(result).toHaveLength(1);
    expect(result[0][0]).toBe('/home');
    expect(result[0][1].topEvent).toBe('signup');
    expect(result[0][1].events).toBe(42);
  });
});
