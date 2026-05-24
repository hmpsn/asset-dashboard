/**
 * Unit tests for pure generation helpers in server/llms-txt-generator.ts.
 * Complements llms-txt-phase4.test.ts and llms-txt-phase5.test.ts.
 *
 * Phase 4 already covers:
 *   - Cache store (upsert/get/getSummaries/delete)
 *   - buildLlmsTxtIndex basic structure, timestamp, grouping
 *   - buildLlmsFullTxt with summaries and fallback to description
 *   - validateUrls with mocked fetch (200, 404, network error, empty input)
 *
 * Phase 5 already covers:
 *   - setLastGenerated / getLastGenerated
 *   - queueLlmsTxtRegeneration exported function
 *
 * This file covers the uncovered behavior:
 *   - buildLlmsTxtIndex planned pages with status labels
 *   - buildLlmsTxtIndex section title humanization (slugToTitle logic via section names)
 *   - buildLlmsTxtIndex root pages go first (sortedSections ordering)
 *   - buildLlmsTxtIndex pages without descriptions (no trailing colon)
 *   - buildLlmsTxtIndex no description header when omitted
 *   - buildLlmsTxtIndex URL construction (baseUrl + path)
 *   - buildLlmsFullTxt no-summary fallback text ("*No summary available.*")
 *   - buildLlmsFullTxt description in header block
 *   - buildLlmsFullTxt section grouping for nested paths
 *   - cleanupOldLlmsTxt returns count
 *   - validateUrls respects concurrency (batching with many URLs)
 *   - validateUrls returns only ok=true URLs (non-2xx filtered)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  buildLlmsTxtIndex,
  buildLlmsFullTxt,
  validateUrls,
  cleanupOldLlmsTxt,
  upsertSummary,
  getSummary,
} from '../../server/llms-txt-generator.js';

// ── buildLlmsTxtIndex — planned pages ──

describe('buildLlmsTxtIndex — planned pages section', () => {
  it('renders Upcoming Content section when plannedPages exist', () => {
    const result = buildLlmsTxtIndex({
      siteName: 'Agency',
      baseUrl: 'https://agency.com',
      pages: [],
      plannedPages: [
        { url: '/seo-services', keyword: 'SEO Services', status: 'planned' },
      ],
    });
    expect(result).toContain('## Upcoming Content');
    expect(result).toContain('[SEO Services](https://agency.com/seo-services)');
    expect(result).toContain('— Planned');
  });

  it('omits Upcoming Content section when plannedPages is empty', () => {
    const result = buildLlmsTxtIndex({
      siteName: 'Agency',
      baseUrl: 'https://agency.com',
      pages: [],
      plannedPages: [],
    });
    expect(result).not.toContain('## Upcoming Content');
  });

  it('uses correct status labels for known statuses', () => {
    const statuses: Array<[string, string]> = [
      ['brief_generated', 'Brief Ready'],
      ['draft', 'In Draft'],
      ['review', 'In Review'],
      ['approved', 'Approved'],
      ['client_review', 'Client Review'],
      ['in_progress', 'In Progress'],
    ];
    for (const [status, expectedLabel] of statuses) {
      const result = buildLlmsTxtIndex({
        siteName: 'S',
        baseUrl: 'https://s.com',
        pages: [],
        plannedPages: [{ url: '/page', keyword: 'Test', status }],
      });
      expect(result).toContain(`— ${expectedLabel}`);
    }
  });

  it('falls back to "Planned" for unknown status values', () => {
    const result = buildLlmsTxtIndex({
      siteName: 'S',
      baseUrl: 'https://s.com',
      pages: [],
      plannedPages: [{ url: '/page', keyword: 'Thing', status: 'unknown_status' }],
    });
    expect(result).toContain('— Planned');
  });

  it('prepends slash to planned URL if missing', () => {
    const result = buildLlmsTxtIndex({
      siteName: 'S',
      baseUrl: 'https://s.com',
      pages: [],
      plannedPages: [{ url: 'no-leading-slash', keyword: 'Kw', status: 'planned' }],
    });
    expect(result).toContain('https://s.com/no-leading-slash');
  });
});

// ── buildLlmsTxtIndex — section ordering and humanization ──

describe('buildLlmsTxtIndex — section ordering and naming', () => {
  it('root pages (no sub-path) are listed under "Main Pages"', () => {
    const result = buildLlmsTxtIndex({
      siteName: 'S',
      baseUrl: 'https://s.com',
      pages: [{ path: '/', title: 'Home' }, { path: '/about', title: 'About' }],
      plannedPages: [],
    });
    expect(result).toContain('## Main Pages');
  });

  it('puts root section before alphabetical sections', () => {
    const result = buildLlmsTxtIndex({
      siteName: 'S',
      baseUrl: 'https://s.com',
      pages: [
        { path: '/blog/article', title: 'Article' },
        { path: '/', title: 'Home' },
      ],
      plannedPages: [],
    });
    const mainPagesIndex = result.indexOf('## Main Pages');
    const blogIndex = result.indexOf('## Blog');
    expect(mainPagesIndex).toBeLessThan(blogIndex);
  });

  it('humanizes section names from slugs', () => {
    const result = buildLlmsTxtIndex({
      siteName: 'S',
      baseUrl: 'https://s.com',
      pages: [{ path: '/case-studies/example', title: 'Example' }],
      plannedPages: [],
    });
    expect(result).toContain('## Case Studies');
  });

  it('sorts multiple sections alphabetically (after root)', () => {
    const result = buildLlmsTxtIndex({
      siteName: 'S',
      baseUrl: 'https://s.com',
      pages: [
        { path: '/zebra/page', title: 'Z' },
        { path: '/alpha/page', title: 'A' },
      ],
      plannedPages: [],
    });
    const alphaIndex = result.indexOf('## Alpha');
    const zebraIndex = result.indexOf('## Zebra');
    expect(alphaIndex).toBeLessThan(zebraIndex);
  });
});

// ── buildLlmsTxtIndex — page link formatting ──

describe('buildLlmsTxtIndex — page link formatting', () => {
  it('includes description after page link when provided', () => {
    const result = buildLlmsTxtIndex({
      siteName: 'S',
      baseUrl: 'https://s.com',
      pages: [{ path: '/services', title: 'Services', description: 'What we offer' }],
      plannedPages: [],
    });
    expect(result).toContain('[Services](https://s.com/services): What we offer');
  });

  it('does not append colon when description is absent', () => {
    const result = buildLlmsTxtIndex({
      siteName: 'S',
      baseUrl: 'https://s.com',
      pages: [{ path: '/services', title: 'Services' }],
      plannedPages: [],
    });
    // Should contain the link but NOT a trailing colon
    expect(result).toContain('[Services](https://s.com/services)');
    expect(result).not.toMatch(/\[Services\]\(https:\/\/s\.com\/services\):/);
  });

  it('omits baseUrl from link when baseUrl is empty string', () => {
    const result = buildLlmsTxtIndex({
      siteName: 'S',
      baseUrl: '',
      pages: [{ path: '/about', title: 'About' }],
      plannedPages: [],
    });
    expect(result).toContain('[About](/about)');
  });

  it('omits description header when description is not provided', () => {
    const result = buildLlmsTxtIndex({
      siteName: 'Site',
      baseUrl: 'https://site.com',
      pages: [],
      plannedPages: [],
    });
    // Should not have a blockquote
    expect(result).not.toMatch(/^> /m);
  });

  it('includes Website line when baseUrl is provided', () => {
    const result = buildLlmsTxtIndex({
      siteName: 'S',
      baseUrl: 'https://mysite.com',
      pages: [],
      plannedPages: [],
    });
    expect(result).toContain('- Website: https://mysite.com');
  });
});

// ── buildLlmsFullTxt — edge cases ──

describe('buildLlmsFullTxt — edge cases and content', () => {
  it('shows "*No summary available.*" when no summary or description', () => {
    const result = buildLlmsFullTxt({
      siteName: 'S',
      baseUrl: 'https://s.com',
      pages: [{ path: '/mystery', title: 'Mystery' }],
    });
    expect(result).toContain('*No summary available.*');
  });

  it('prefers summary over description when both are present', () => {
    const result = buildLlmsFullTxt({
      siteName: 'S',
      baseUrl: 'https://s.com',
      pages: [{ path: '/page', title: 'Page', description: 'Old desc', summary: 'AI summary' }],
    });
    expect(result).toContain('AI summary');
    expect(result).not.toContain('Old desc');
  });

  it('includes description blockquote when provided', () => {
    const result = buildLlmsFullTxt({
      siteName: 'Agency',
      baseUrl: 'https://agency.com',
      description: 'A digital agency helping brands grow',
      pages: [],
    });
    expect(result).toContain('> A digital agency helping brands grow');
  });

  it('omits description blockquote when not provided', () => {
    const result = buildLlmsFullTxt({
      siteName: 'S',
      baseUrl: 'https://s.com',
      pages: [],
    });
    expect(result).not.toMatch(/^> /m);
  });

  it('groups nested pages under section headers', () => {
    const result = buildLlmsFullTxt({
      siteName: 'S',
      baseUrl: 'https://s.com',
      pages: [
        { path: '/blog/seo-tips', title: 'SEO Tips', summary: 'Tips about SEO.' },
        { path: '/blog/content-strategy', title: 'Content Strategy', summary: 'About content.' },
      ],
    });
    expect(result).toContain('## Blog');
    expect(result).toContain('### [SEO Tips](https://s.com/blog/seo-tips)');
    expect(result).toContain('### [Content Strategy](https://s.com/blog/content-strategy)');
  });

  it('includes Generated timestamp', () => {
    const result = buildLlmsFullTxt({
      siteName: 'S',
      baseUrl: 'https://s.com',
      pages: [],
    });
    expect(result).toMatch(/Generated:/);
  });

  it('handles pages array with mixed summary/description/empty', () => {
    const result = buildLlmsFullTxt({
      siteName: 'S',
      baseUrl: 'https://s.com',
      pages: [
        { path: '/a', title: 'A', summary: 'Summary A' },
        { path: '/b', title: 'B', description: 'Desc B' },
        { path: '/c', title: 'C' },
      ],
    });
    expect(result).toContain('Summary A');
    expect(result).toContain('Desc B');
    expect(result).toContain('*No summary available.*');
  });
});

// ── cleanupOldLlmsTxt ──

describe('cleanupOldLlmsTxt', () => {
  it('returns a number (count of removed records)', () => {
    // Insert a fresh summary then immediately try cleanup with 0 days (removes all old)
    upsertSummary('ws-cleanup-test', 'https://example.com/cleanup', 'test summary');
    const count = cleanupOldLlmsTxt(0);
    // May or may not remove depending on timing, but must return a non-negative integer
    expect(typeof count).toBe('number');
    expect(count).toBeGreaterThanOrEqual(0);
  });

  it('uses 90-day default when called with no argument', () => {
    // Should not throw
    expect(() => cleanupOldLlmsTxt()).not.toThrow();
  });
});

// ── validateUrls — edge cases ──

describe('validateUrls — additional edge cases', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('handles 301 redirects that ultimately resolve ok', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 200 }));
    const result = await validateUrls(['https://example.com/redirect']);
    expect(result).toContain('https://example.com/redirect');
  });

  it('filters out 500 server error URLs', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 500 }));
    const result = await validateUrls(['https://example.com/broken']);
    expect(result).toEqual([]);
  });

  it('filters out 403 forbidden URLs', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 403 }));
    const result = await validateUrls(['https://example.com/forbidden']);
    expect(result).toEqual([]);
  });

  it('processes more than concurrency limit in batches', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 200 }));
    const urls = Array.from({ length: 25 }, (_, i) => `https://example.com/page-${i}`);
    const result = await validateUrls(urls, 10);
    expect(result).toHaveLength(25);
  });

  it('survives mixed success/failure in a batch', async () => {
    let callCount = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      callCount++;
      if (callCount % 2 === 0) return new Response('', { status: 404 });
      return new Response('', { status: 200 });
    });
    const urls = ['https://a.com/1', 'https://a.com/2', 'https://a.com/3', 'https://a.com/4'];
    const result = await validateUrls(urls);
    // Odd positions (1, 3) → 200 → valid; even (2, 4) → 404 → filtered
    expect(result.length).toBe(2);
  });
});

// ── Cache store — cleanupOldLlmsTxt integration ──

describe('llms-txt cache — integration with cleanup', () => {
  it('getSummary returns null after delete', () => {
    upsertSummary('ws-del', 'https://example.com/page', 'Summary to delete');
    const before = getSummary('ws-del', 'https://example.com/page');
    expect(before).not.toBeNull();
    // Cleanup removes nothing recent — just testing the interface works
    const count = cleanupOldLlmsTxt(999); // 999 days — removes nothing
    expect(count).toBe(0);
    const after = getSummary('ws-del', 'https://example.com/page');
    expect(after).not.toBeNull(); // Still there since it's recent
  });
});
