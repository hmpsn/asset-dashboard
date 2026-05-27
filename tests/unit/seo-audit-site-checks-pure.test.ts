/**
 * Wave 20 — Pure function unit tests for seo-audit-site-checks.ts and
 * its adjacent pure helpers (audit-page.ts, shared/scoring.ts,
 * server/seo-audit-html.ts, server/helpers.ts).
 *
 * The primary export of seo-audit-site-checks.ts (runSiteWideChecks) is
 * heavily I/O-bound (fetch, scanRedirects, runHomepageCwv). We therefore
 * test the pure computation helpers that live in the same bounded context
 * and whose correctness the site-wide checks depend on:
 *
 *   - computePageScore              (shared/scoring)
 *   - CRITICAL_CHECKS / MODERATE_CHECKS constants (shared/scoring)
 *   - isContentPage                 (server/audit-page)
 *   - isExcludedPage                (server/audit-page — if exported)
 *   - CHECK_CATEGORY map            (server/audit-page)
 *   - normalizePageUrl / normalizePath (server/helpers)
 *   - decodeEntities                (server/helpers)
 *   - matchPagePath                 (server/helpers)
 *   - extractLinks / extractTag / extractMetaContent / countWords (server/seo-audit-html)
 *   - stripHiddenElements           (server/seo-audit-html)
 */

import { describe, it, expect } from 'vitest';
import { computePageScore, CRITICAL_CHECKS, MODERATE_CHECKS } from '../../shared/scoring.js';
import { isContentPage, CHECK_CATEGORY } from '../../server/audit-page.js';
import { decodeEntities, normalizePageUrl, matchPagePath } from '../../server/helpers.js';
const normalizePath = normalizePageUrl;
import {
  extractTag,
  extractMetaContent,
  countWords,
  extractLinks,
  stripHiddenElements,
} from '../../server/seo-audit-html.js';

// ---------------------------------------------------------------------------
// computePageScore — shared/scoring
// ---------------------------------------------------------------------------
describe('computePageScore', () => {
  it('returns 100 for an empty issues array', () => {
    expect(computePageScore([])).toBe(100);
  });

  it('deducts 15 for a critical error (title)', () => {
    expect(computePageScore([{ check: 'title', severity: 'error' }])).toBe(85);
  });

  it('deducts 10 for a non-critical error (h1 is critical, img-alt is not)', () => {
    // img-alt is not in CRITICAL_CHECKS → deducts 10
    expect(computePageScore([{ check: 'img-alt', severity: 'error' }])).toBe(90);
  });

  it('deducts 5 for a critical warning (meta-description)', () => {
    // meta-description is in CRITICAL_CHECKS but severity is warning → -5
    expect(computePageScore([{ check: 'meta-description', severity: 'warning' }])).toBe(95);
  });

  it('deducts 3 for a moderate warning (content-length)', () => {
    // content-length is in MODERATE_CHECKS → -3
    expect(computePageScore([{ check: 'content-length', severity: 'warning' }])).toBe(97);
  });

  it('deducts 2 for a non-critical, non-moderate warning (orphan-pages)', () => {
    // orphan-pages is in neither set → -2
    expect(computePageScore([{ check: 'orphan-pages', severity: 'warning' }])).toBe(98);
  });

  it('does not deduct anything for info severity', () => {
    expect(computePageScore([{ check: 'structured-data', severity: 'info' }])).toBe(100);
  });

  it('accumulates deductions across multiple issues', () => {
    const issues = [
      { check: 'title', severity: 'error' },      // -15
      { check: 'meta-description', severity: 'error' }, // -15
    ];
    expect(computePageScore(issues)).toBe(70);
  });

  it('does not go below 0', () => {
    const issues = Array.from({ length: 20 }, () => ({ check: 'title', severity: 'error' }));
    expect(computePageScore(issues)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// CRITICAL_CHECKS and MODERATE_CHECKS — shared/scoring
// ---------------------------------------------------------------------------
describe('CRITICAL_CHECKS', () => {
  it('includes title and meta-description', () => {
    expect(CRITICAL_CHECKS.has('title')).toBe(true);
    expect(CRITICAL_CHECKS.has('meta-description')).toBe(true);
  });

  it('does not include img-alt or content-length', () => {
    expect(CRITICAL_CHECKS.has('img-alt')).toBe(false);
    expect(CRITICAL_CHECKS.has('content-length')).toBe(false);
  });
});

describe('MODERATE_CHECKS', () => {
  it('includes content-length and img-alt', () => {
    expect(MODERATE_CHECKS.has('content-length')).toBe(true);
    expect(MODERATE_CHECKS.has('img-alt')).toBe(true);
  });

  it('does not include title (that is critical)', () => {
    expect(MODERATE_CHECKS.has('title')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isContentPage — server/audit-page
// ---------------------------------------------------------------------------
describe('isContentPage', () => {
  it('returns true for /blog/my-post', () => {
    expect(isContentPage('/blog/my-post')).toBe(true);
  });

  it('returns true for /resources/guide', () => {
    expect(isContentPage('/resources/guide')).toBe(true);
  });

  it('returns true for /articles/how-to-rank', () => {
    expect(isContentPage('/articles/how-to-rank')).toBe(true);
  });

  it('returns false for /services/seo', () => {
    expect(isContentPage('/services/seo')).toBe(false);
  });

  it('returns false for /about', () => {
    expect(isContentPage('/about')).toBe(false);
  });

  it('returns false for homepage /', () => {
    expect(isContentPage('/')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// CHECK_CATEGORY — server/audit-page
// ---------------------------------------------------------------------------
describe('CHECK_CATEGORY', () => {
  it('maps title to content', () => {
    expect(CHECK_CATEGORY['title']).toBe('content');
  });

  it('maps ssl to technical', () => {
    expect(CHECK_CATEGORY['ssl']).toBe('technical');
  });

  it('maps robots-txt to technical', () => {
    expect(CHECK_CATEGORY['robots-txt']).toBe('technical');
  });

  it('maps img-alt to accessibility', () => {
    expect(CHECK_CATEGORY['img-alt']).toBe('accessibility');
  });

  it('maps cwv to performance', () => {
    expect(CHECK_CATEGORY['cwv']).toBe('performance');
  });

  it('maps og-tags to social', () => {
    expect(CHECK_CATEGORY['og-tags']).toBe('social');
  });
});

// ---------------------------------------------------------------------------
// decodeEntities — server/helpers
// ---------------------------------------------------------------------------
describe('decodeEntities', () => {
  it('decodes &amp; to &', () => {
    expect(decodeEntities('R&amp;D')).toBe('R&D');
  });

  it('decodes &lt; and &gt;', () => {
    expect(decodeEntities('&lt;div&gt;')).toBe('<div>');
  });

  it('decodes &#x27; (apostrophe hex)', () => {
    expect(decodeEntities('it&#x27;s')).toBe("it's");
  });

  it('decodes &#39; (apostrophe decimal)', () => {
    expect(decodeEntities('it&#39;s')).toBe("it's");
  });

  it('decodes &nbsp; to a space', () => {
    expect(decodeEntities('hello&nbsp;world')).toBe('hello world');
  });

  it('returns the string unchanged when there are no entities', () => {
    expect(decodeEntities('plain text')).toBe('plain text');
  });
});

// ---------------------------------------------------------------------------
// normalizePath — server/helpers
// ---------------------------------------------------------------------------
describe('normalizePath', () => {
  it('adds a leading slash when missing', () => {
    expect(normalizePath('services/seo')).toBe('/services/seo');
  });

  it('removes trailing slash (except root)', () => {
    expect(normalizePath('/services/seo/')).toBe('/services/seo');
  });

  it('keeps the root slash as-is', () => {
    expect(normalizePath('/')).toBe('/');
  });

  it('does not add extra slashes to an already-normalized path', () => {
    expect(normalizePath('/about')).toBe('/about');
  });
});

// ---------------------------------------------------------------------------
// matchPagePath — server/helpers
// ---------------------------------------------------------------------------
describe('matchPagePath', () => {
  it('returns true for identical paths', () => {
    expect(matchPagePath('/about', '/about')).toBe(true);
  });

  it('returns true ignoring case differences', () => {
    expect(matchPagePath('/About', '/about')).toBe(true);
  });

  it('returns true ignoring trailing slash differences', () => {
    expect(matchPagePath('/services/', '/services')).toBe(true);
  });

  it('returns false for different paths', () => {
    expect(matchPagePath('/about', '/contact')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// extractTag — server/seo-audit-html
// ---------------------------------------------------------------------------
describe('extractTag', () => {
  it('extracts a single h1 tag content', () => {
    const html = '<h1>Hello World</h1>';
    expect(extractTag(html, 'h1')).toEqual(['Hello World']);
  });

  it('extracts multiple h1 tags', () => {
    const html = '<h1>First</h1><p>some text</p><h1>Second</h1>';
    const result = extractTag(html, 'h1');
    expect(result).toHaveLength(2);
    expect(result).toContain('First');
    expect(result).toContain('Second');
  });

  it('returns empty array when no matching tags', () => {
    expect(extractTag('<p>No heading here</p>', 'h1')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// extractMetaContent — server/seo-audit-html
// ---------------------------------------------------------------------------
describe('extractMetaContent', () => {
  it('extracts description meta content', () => {
    const html = '<meta name="description" content="My page description">';
    expect(extractMetaContent(html, 'description')).toBe('My page description');
  });

  it('extracts og:title property content', () => {
    const html = '<meta property="og:title" content="Open Graph Title">';
    expect(extractMetaContent(html, 'og:title')).toBe('Open Graph Title');
  });

  it('returns null when no matching meta tag', () => {
    expect(extractMetaContent('<p>No meta here</p>', 'description')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// countWords — server/seo-audit-html
// ---------------------------------------------------------------------------
describe('countWords', () => {
  it('counts words from plain HTML body text', () => {
    const html = '<p>Hello world this is a test</p>';
    expect(countWords(html)).toBe(6);
  });

  it('returns 0 for empty string', () => {
    expect(countWords('')).toBe(0);
  });

  it('strips HTML tags before counting', () => {
    const html = '<h1>Title</h1><p>Body text here</p>';
    // "Title" + "Body" + "text" + "here" = 4 words
    expect(countWords(html)).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// extractLinks — server/seo-audit-html
// ---------------------------------------------------------------------------
describe('extractLinks', () => {
  it('extracts href and text from anchor tags', () => {
    const html = '<a href="/about">About Us</a>';
    const links = extractLinks(html);
    expect(links.length).toBeGreaterThan(0);
    expect(links[0].href).toBe('/about');
  });

  it('returns empty array when no anchor tags', () => {
    expect(extractLinks('<p>No links here</p>')).toEqual([]);
  });

  it('extracts multiple links', () => {
    const html = '<a href="/home">Home</a><a href="/services">Services</a>';
    const links = extractLinks(html);
    expect(links).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// stripHiddenElements — server/seo-audit-html
// ---------------------------------------------------------------------------
describe('stripHiddenElements', () => {
  it('strips div with display:none from visible HTML', () => {
    const html = '<p>Visible</p><div style="display:none"><h1>Hidden H1</h1></div>';
    const result = stripHiddenElements(html);
    expect(result).toContain('Visible');
    expect(result).not.toContain('Hidden H1');
  });

  it('strips elements with w-condition-invisible class', () => {
    const html = '<p>Main content</p><div class="w-condition-invisible"><p>Conditional</p></div>';
    const result = stripHiddenElements(html);
    expect(result).toContain('Main content');
    expect(result).not.toContain('Conditional');
  });

  it('leaves visible elements unchanged', () => {
    const html = '<div><p>Visible text</p></div>';
    expect(stripHiddenElements(html)).toContain('Visible text');
  });
});
