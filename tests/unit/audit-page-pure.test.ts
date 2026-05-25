/**
 * Unit tests for server/audit-page.ts — pure audit logic.
 *
 * auditPage() is a pure function (no I/O, no DB, no HTTP calls).
 * The only external imports are seo-audit-html (DOM parsing helpers)
 * and shared/scoring (score math) — both are tested separately;
 * here we focus on the rule logic, severity classification, and
 * issue detection that auditPage() itself implements.
 */
import { describe, it, expect } from 'vitest';
import { auditPage, isContentPage, isExcludedPage, CHECK_CATEGORY } from '../../server/audit-page.js';

// ── Minimal helpers ──────────────────────────────────────────────────────────

// 300+ word filler so the content-length check doesn't fire
const FILLER_TEXT = Array(40).fill('This is a sentence with several words in it.').join(' ');

function makeHtml({
  title = '<title>My Page Title That Is Long Enough</title>',
  meta = '<meta name="description" content="A nice description that is long enough to pass the length check.">',
  viewport = '<meta name="viewport" content="width=device-width, initial-scale=1">',
  canonical = '<link rel="canonical" href="https://example.com/page">',
  lang = '<html lang="en">',
  h1 = '<h1>Main Heading</h1>',
  ogTitle = '<meta property="og:title" content="OG Title">',
  ogDesc = '<meta property="og:description" content="OG Description">',
  ogImage = '<meta property="og:image" content="https://example.com/img.jpg">',
  internalLink = '<a href="/about">About us</a>',
  extra = '',
} = {}): string {
  return `<!DOCTYPE html>${lang}<head>${title}${meta}${viewport}${canonical}${ogTitle}${ogDesc}${ogImage}</head><body>${h1}${internalLink}<p>${FILLER_TEXT}</p>${extra}</body></html>`;
}

const defaultUrl = 'https://example.com/page';
const defaultMeta = {
  id: 'page-1',
  title: 'My Page Title That Is Long Enough',
  slug: 'page',
  seo: { title: 'My Page Title That Is Long Enough', description: 'A nice description that is long enough to pass the length check.' },
  openGraph: { title: 'OG Title', description: 'OG Description' },
};

// ── isContentPage ────────────────────────────────────────────────────────────

describe('isContentPage', () => {
  it('returns true for /blog/... slugs', () => {
    expect(isContentPage('/blog/my-post')).toBe(true);
  });

  it('returns true for /articles/... slugs', () => {
    expect(isContentPage('/articles/ten-tips')).toBe(true);
  });

  it('returns true for /resources/... slugs', () => {
    expect(isContentPage('/resources/guide')).toBe(true);
  });

  it('returns true for /guides/... slugs', () => {
    expect(isContentPage('/guides/seo-basics')).toBe(true);
  });

  it('returns true for /case-studies/... slugs', () => {
    expect(isContentPage('/case-studies/client-x')).toBe(true);
  });

  it('returns false for homepage slug', () => {
    expect(isContentPage('/')).toBe(false);
  });

  it('returns false for /services/... slug', () => {
    expect(isContentPage('/services/seo')).toBe(false);
  });

  it('returns false for /contact slug', () => {
    expect(isContentPage('/contact')).toBe(false);
  });

  it('returns false for /about slug', () => {
    expect(isContentPage('/about')).toBe(false);
  });
});

// ── isExcludedPage ───────────────────────────────────────────────────────────

describe('isExcludedPage', () => {
  it('excludes "404" slug', () => {
    expect(isExcludedPage('404')).toBe(true);
  });

  it('excludes "thank-you" slug', () => {
    expect(isExcludedPage('thank-you')).toBe(true);
  });

  it('excludes slug containing "privacy-policy"', () => {
    expect(isExcludedPage('privacy-policy')).toBe(true);
  });

  it('excludes slug containing "terms"', () => {
    expect(isExcludedPage('terms-of-service')).toBe(true);
  });

  it('excludes "login" slug', () => {
    expect(isExcludedPage('login')).toBe(true);
  });

  it('does NOT exclude a normal page slug', () => {
    expect(isExcludedPage('our-services')).toBe(false);
  });

  it('does NOT exclude a blog page slug', () => {
    expect(isExcludedPage('blog/my-post')).toBe(false);
  });

  it('strips leading slash before comparing', () => {
    expect(isExcludedPage('/404')).toBe(true);
  });

  it('matches excluded keyword in title when slug is clean', () => {
    expect(isExcludedPage('some-slug', 'Privacy Policy')).toBe(true);
  });
});

// ── CHECK_CATEGORY map ───────────────────────────────────────────────────────

describe('CHECK_CATEGORY', () => {
  it('classifies title check as content', () => {
    expect(CHECK_CATEGORY['title']).toBe('content');
  });

  it('classifies canonical check as technical', () => {
    expect(CHECK_CATEGORY['canonical']).toBe('technical');
  });

  it('classifies og-image check as social', () => {
    expect(CHECK_CATEGORY['og-image']).toBe('social');
  });

  it('classifies lazy-loading check as performance', () => {
    expect(CHECK_CATEGORY['lazy-loading']).toBe('performance');
  });

  it('classifies img-alt check as accessibility', () => {
    expect(CHECK_CATEGORY['img-alt']).toBe('accessibility');
  });
});

// ── auditPage — title checks ─────────────────────────────────────────────────

describe('auditPage — title checks', () => {
  it('no title issue when title is 30-60 chars', () => {
    const html = makeHtml();
    const result = auditPage('p1', 'Page', 'page', defaultUrl, defaultMeta, html);
    expect(result.issues.find(i => i.check === 'title')).toBeUndefined();
  });

  it('error when title is missing', () => {
    const html = makeHtml({ title: '', meta: '' });
    const result = auditPage('p1', 'Page', 'page', defaultUrl,
      { id: 'p1', title: '', slug: 'page' }, html);
    const titleIssue = result.issues.find(i => i.check === 'title');
    expect(titleIssue?.severity).toBe('error');
  });

  it('warning when title is too short (< 30 chars)', () => {
    const shortTitle = 'Hi';
    const html = makeHtml({ title: `<title>${shortTitle}</title>` });
    const result = auditPage('p1', 'Page', 'page', defaultUrl,
      { id: 'p1', title: shortTitle, slug: 'page', seo: { title: shortTitle } },
      html);
    const titleIssue = result.issues.find(i => i.check === 'title');
    expect(titleIssue?.severity).toBe('warning');
    expect(titleIssue?.message).toContain('short');
  });

  it('warning when title is too long (> 60 chars)', () => {
    const longTitle = 'This is an extremely long page title that definitely exceeds sixty chars for testing';
    const html = makeHtml({ title: `<title>${longTitle}</title>` });
    const result = auditPage('p1', 'Page', 'page', defaultUrl,
      { id: 'p1', title: longTitle, slug: 'page', seo: { title: longTitle } },
      html);
    const titleIssue = result.issues.find(i => i.check === 'title');
    expect(titleIssue?.severity).toBe('warning');
    expect(titleIssue?.message).toContain('long');
  });
});

// ── auditPage — meta description checks ─────────────────────────────────────

describe('auditPage — meta description checks', () => {
  it('no meta-description issue for 50-160 char description', () => {
    const html = makeHtml();
    const result = auditPage('p1', 'Page', 'page', defaultUrl, defaultMeta, html);
    expect(result.issues.find(i => i.check === 'meta-description')).toBeUndefined();
  });

  it('error when meta description is missing', () => {
    const html = makeHtml({ meta: '' });
    const result = auditPage('p1', 'Page', 'page', defaultUrl,
      { id: 'p1', title: 'Title', slug: 'page', seo: { title: 'Title', description: '' } },
      html);
    expect(result.issues.find(i => i.check === 'meta-description')?.severity).toBe('error');
  });

  it('warning when meta description is too short', () => {
    const shortDesc = 'Short';
    const html = makeHtml({ meta: `<meta name="description" content="${shortDesc}">` });
    const result = auditPage('p1', 'Page', 'page', defaultUrl,
      { id: 'p1', title: 'Title', slug: 'page', seo: { description: shortDesc } },
      html);
    expect(result.issues.find(i => i.check === 'meta-description')?.severity).toBe('warning');
  });
});

// ── auditPage — canonical tag ────────────────────────────────────────────────

describe('auditPage — canonical tag', () => {
  it('no canonical issue when canonical tag is present', () => {
    const html = makeHtml();
    const result = auditPage('p1', 'Page', 'page', defaultUrl, defaultMeta, html);
    expect(result.issues.find(i => i.check === 'canonical')).toBeUndefined();
  });

  it('error when canonical tag is missing', () => {
    const html = makeHtml({ canonical: '' });
    const result = auditPage('p1', 'Page', 'page', defaultUrl, defaultMeta, html);
    expect(result.issues.find(i => i.check === 'canonical')?.severity).toBe('error');
  });

  it('error when canonical tag has empty href', () => {
    const html = makeHtml({ canonical: '<link rel="canonical" href="">' });
    const result = auditPage('p1', 'Page', 'page', defaultUrl, defaultMeta, html);
    const issue = result.issues.find(i => i.check === 'canonical');
    expect(issue?.severity).toBe('error');
  });
});

// ── auditPage — URL structure ────────────────────────────────────────────────

describe('auditPage — URL structure', () => {
  it('no url issue for a short lowercase slug', () => {
    const html = makeHtml();
    const result = auditPage('p1', 'Page', 'my-page', defaultUrl, defaultMeta, html);
    expect(result.issues.find(i => i.check === 'url')).toBeUndefined();
  });

  it('warning when slug exceeds 75 chars', () => {
    const longSlug = 'a'.repeat(80);
    const html = makeHtml();
    const result = auditPage('p1', 'Page', longSlug, defaultUrl, defaultMeta, html);
    expect(result.issues.find(i => i.check === 'url')?.severity).toBe('warning');
  });

  it('info when slug contains uppercase characters', () => {
    const html = makeHtml();
    const result = auditPage('p1', 'Page', 'MyPage', defaultUrl, defaultMeta, html);
    const urlIssue = result.issues.find(i => i.check === 'url');
    expect(urlIssue?.severity).toBe('info');
    expect(urlIssue?.message).toContain('uppercase');
  });
});

// ── auditPage — noindex ──────────────────────────────────────────────────────

describe('auditPage — noindex detection', () => {
  it('sets noindex=true and adds robots info issue when noindex is present', () => {
    const html = makeHtml({
      extra: '<meta name="robots" content="noindex, nofollow">',
    }).replace('<head>', '<head><meta name="robots" content="noindex, nofollow">');
    const result = auditPage('p1', 'Page', 'page', defaultUrl, defaultMeta, html);
    expect(result.noindex).toBe(true);
    expect(result.issues.find(i => i.check === 'robots')).toBeDefined();
  });

  it('noindex is not set for a normal page', () => {
    const html = makeHtml();
    const result = auditPage('p1', 'Page', 'page', defaultUrl, defaultMeta, html);
    expect(result.noindex).toBeUndefined();
  });
});

// ── auditPage — H1 checks ────────────────────────────────────────────────────

describe('auditPage — H1 checks', () => {
  it('no h1 issue when exactly one H1 present', () => {
    const html = makeHtml();
    const result = auditPage('p1', 'Page', 'page', defaultUrl, defaultMeta, html);
    expect(result.issues.find(i => i.check === 'h1')).toBeUndefined();
  });

  it('error when H1 is missing', () => {
    const html = makeHtml({ h1: '' });
    const result = auditPage('p1', 'Page', 'page', defaultUrl, defaultMeta, html);
    expect(result.issues.find(i => i.check === 'h1')?.severity).toBe('error');
  });

  it('warning when multiple H1 tags present', () => {
    const html = makeHtml({ h1: '<h1>First</h1><h1>Second</h1>' });
    const result = auditPage('p1', 'Page', 'page', defaultUrl, defaultMeta, html);
    const h1Issue = result.issues.find(i => i.check === 'h1');
    expect(h1Issue?.severity).toBe('warning');
    expect(h1Issue?.message).toContain('Multiple');
  });
});

// ── auditPage — score computation ───────────────────────────────────────────

describe('auditPage — score computation', () => {
  it('returns score of 100 for a well-structured page (no errors or warnings)', () => {
    const html = makeHtml();
    const result = auditPage('p1', 'Page', 'page', defaultUrl, defaultMeta, html);
    // Only info-level notices allowed (structured-data, internal-links etc. are info; no score impact)
    const scoringIssues = result.issues.filter(i => i.severity === 'error' || i.severity === 'warning');
    expect(scoringIssues).toHaveLength(0);
    expect(result.score).toBe(100);
  });

  it('returns lower score when critical errors are present', () => {
    const html = makeHtml({ title: '', canonical: '' });
    const result = auditPage('p1', 'Page', 'page', defaultUrl,
      { id: 'p1', title: '', slug: 'page' }, html);
    expect(result.score).toBeLessThan(80);
  });

  it('score is always between 0 and 100', () => {
    const badHtml = '<html><body><p>nothing</p></body></html>';
    const result = auditPage('p1', 'Bad', 'bad', 'https://example.com/bad', null, badHtml);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });
});

// ── auditPage — null html path ───────────────────────────────────────────────

describe('auditPage — null html', () => {
  it('still returns a result with meta-derived issues when html is null', () => {
    const result = auditPage('p1', 'Page', 'page', defaultUrl, defaultMeta, null);
    expect(result.pageId).toBe('p1');
    expect(Array.isArray(result.issues)).toBe(true);
  });

  it('adds og-image warning when html is null (no og:image in HTML to check)', () => {
    const result = auditPage('p1', 'Page', 'page', defaultUrl,
      { id: 'p1', title: 'Title', slug: 'page' }, null);
    expect(result.issues.find(i => i.check === 'og-image')).toBeDefined();
  });
});

// ── auditPage — categories assigned ─────────────────────────────────────────

describe('auditPage — issue categories auto-assigned', () => {
  it('every issue has a category property', () => {
    const html = makeHtml({ title: '', canonical: '' });
    const result = auditPage('p1', 'Page', 'page', defaultUrl, null, html);
    for (const issue of result.issues) {
      expect(issue.category).toBeDefined();
    }
  });

  it('title issue gets category "content"', () => {
    const html = makeHtml({ title: '' });
    const result = auditPage('p1', 'Page', 'page', defaultUrl,
      { id: 'p1', title: '', slug: 'page' }, html);
    const titleIssue = result.issues.find(i => i.check === 'title');
    expect(titleIssue?.category).toBe('content');
  });

  it('canonical issue gets category "technical"', () => {
    const html = makeHtml({ canonical: '' });
    const result = auditPage('p1', 'Page', 'page', defaultUrl, defaultMeta, html);
    const canonicalIssue = result.issues.find(i => i.check === 'canonical');
    expect(canonicalIssue?.category).toBe('technical');
  });
});
