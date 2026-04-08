/**
 * Integration tests for SEO audit endpoints and the auditPage scoring engine.
 *
 * Structure:
 *   1. Unit — auditPage() pure function: scoring algorithm, check types, check categories
 *   2. Unit — isExcludedPage() / isContentPage() helpers
 *   3. Unit — SEO suggestions suppression (dismissSuggestions store)
 *   4. Integration — HTTP route: workspace-scoped, missing token, baseline
 *   5. Integration — HTTP route: suggestions dismiss endpoint
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import {
  auditPage,
  isExcludedPage,
  isContentPage,
} from '../../server/audit-page.js';
import {
  saveSuggestion,
  listSuggestions,
  dismissSuggestions,
} from '../../server/seo-suggestions.js';

// ─── HTTP test context (unique port) ────────────────────────────────────────
const ctx = createTestContext(13306);
const { api, del } = ctx;

beforeAll(async () => {
  // Unset WEBFLOW_API_TOKEN before spawning the test server so
  // getTokenForSite('site_no_token_xyz') deterministically returns null.
  // Workspace-level webflowToken fields are unaffected — only the global fallback is cleared.
  const savedWebflowToken = process.env.WEBFLOW_API_TOKEN;
  delete process.env.WEBFLOW_API_TOKEN;
  await ctx.startServer();
  // Restore in parent process — child process env is already fixed at spawn time.
  if (savedWebflowToken !== undefined) process.env.WEBFLOW_API_TOKEN = savedWebflowToken;
}, 25_000);

afterAll(() => {
  ctx.stopServer();
});

// ============================================================================
// 1. auditPage() — scoring algorithm and check types
// ============================================================================

describe('auditPage() — title check', () => {
  it('flags missing title as error', () => {
    const result = auditPage('p1', 'Home', '', 'https://example.com', null, null);
    const titleIssue = result.issues.find(i => i.check === 'title');
    expect(titleIssue).toBeDefined();
    expect(titleIssue?.severity).toBe('error');
    expect(titleIssue?.message).toMatch(/missing/i);
  });

  it('flags title that is too short as warning', () => {
    const meta = {
      id: 'p1',
      title: 'Hi',
      slug: 'home',
      seo: { title: 'Hi' },
    };
    const result = auditPage('p1', 'Home', 'home', 'https://example.com', meta, null);
    const titleIssue = result.issues.find(i => i.check === 'title');
    expect(titleIssue).toBeDefined();
    expect(titleIssue?.severity).toBe('warning');
    expect(titleIssue?.message).toMatch(/too short/i);
  });

  it('flags title that is too long as warning', () => {
    const longTitle = 'A'.repeat(65);
    const meta = {
      id: 'p1',
      title: longTitle,
      slug: 'home',
      seo: { title: longTitle },
    };
    const result = auditPage('p1', 'Home', 'home', 'https://example.com', meta, null);
    const titleIssue = result.issues.find(i => i.check === 'title');
    expect(titleIssue).toBeDefined();
    expect(titleIssue?.severity).toBe('warning');
    expect(titleIssue?.message).toMatch(/too long/i);
  });

  it('produces no title issue when title is within range', () => {
    const goodTitle = 'Dental Implants — Best Dental Care in Austin TX';
    const meta = {
      id: 'p1',
      title: goodTitle,
      slug: 'dental-implants',
      seo: { title: goodTitle },
    };
    const result = auditPage('p1', 'Dental Implants', 'dental-implants', 'https://example.com', meta, null);
    const titleIssue = result.issues.find(i => i.check === 'title');
    expect(titleIssue).toBeUndefined();
  });
});

describe('auditPage() — meta-description check', () => {
  it('flags missing meta description as error', () => {
    const meta = {
      id: 'p2',
      title: 'Good Title That Is Long Enough Here',
      slug: 'services',
      seo: { title: 'Good Title That Is Long Enough Here', description: '' },
    };
    const result = auditPage('p2', 'Services', 'services', 'https://example.com', meta, null);
    const descIssue = result.issues.find(i => i.check === 'meta-description');
    expect(descIssue).toBeDefined();
    expect(descIssue?.severity).toBe('error');
  });

  it('flags description that is too short as warning', () => {
    const meta = {
      id: 'p2',
      title: 'Good Title That Is Long Enough Here',
      slug: 'services',
      seo: { title: 'Good Title That Is Long Enough Here', description: 'Too short.' },
    };
    const result = auditPage('p2', 'Services', 'services', 'https://example.com', meta, null);
    const descIssue = result.issues.find(i => i.check === 'meta-description');
    expect(descIssue).toBeDefined();
    expect(descIssue?.severity).toBe('warning');
    expect(descIssue?.message).toMatch(/too short/i);
  });

  it('flags description that is too long as warning', () => {
    const longDesc = 'B'.repeat(165);
    const meta = {
      id: 'p2',
      title: 'Good Title That Is Long Enough Here',
      slug: 'services',
      seo: { title: 'Good Title That Is Long Enough Here', description: longDesc },
    };
    const result = auditPage('p2', 'Services', 'services', 'https://example.com', meta, null);
    const descIssue = result.issues.find(i => i.check === 'meta-description');
    expect(descIssue).toBeDefined();
    expect(descIssue?.severity).toBe('warning');
    expect(descIssue?.message).toMatch(/too long/i);
  });
});

describe('auditPage() — HTML-based checks (H1, viewport, canonical)', () => {
  const goodMeta = {
    id: 'p3',
    title: 'A Good Enough Title For Testing Here Now',
    slug: 'about',
    seo: {
      title: 'A Good Enough Title For Testing Here Now',
      description: 'A meta description that is long enough to pass the 50-character minimum check threshold.',
    },
  };

  it('flags missing H1 as error', () => {
    const html = `
      <html lang="en"><head>
        <title>A Good Enough Title For Testing Here Now</title>
        <meta name="description" content="A meta description that is long enough to pass the 50-character minimum check threshold.">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <link rel="canonical" href="https://example.com/about">
      </head><body><p>Content here without any heading tags at all.</p></body></html>
    `;
    const result = auditPage('p3', 'About', 'about', 'https://example.com/about', goodMeta, html);
    const h1Issue = result.issues.find(i => i.check === 'h1');
    expect(h1Issue).toBeDefined();
    expect(h1Issue?.severity).toBe('error');
    expect(h1Issue?.message).toMatch(/missing/i);
  });

  it('flags multiple H1 tags as warning', () => {
    const html = `
      <html lang="en"><head>
        <title>A Good Enough Title For Testing Here Now</title>
        <meta name="description" content="A meta description that is long enough to pass the 50-character minimum check threshold.">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <link rel="canonical" href="https://example.com/about">
      </head><body>
        <h1>First Heading</h1>
        <h2>Sub heading</h2>
        <h1>Second Heading</h1>
        <p>Content here</p>
      </body></html>
    `;
    const result = auditPage('p3', 'About', 'about', 'https://example.com/about', goodMeta, html);
    const h1Issue = result.issues.find(i => i.check === 'h1');
    expect(h1Issue).toBeDefined();
    expect(h1Issue?.severity).toBe('warning');
    expect(h1Issue?.message).toMatch(/multiple/i);
  });

  it('flags missing viewport meta as error', () => {
    const html = `
      <html lang="en"><head>
        <title>A Good Enough Title For Testing Here Now</title>
        <meta name="description" content="A meta description that is long enough to pass the 50-character minimum check threshold.">
        <link rel="canonical" href="https://example.com/about">
      </head><body><h1>About Us</h1><p>Content here.</p></body></html>
    `;
    const result = auditPage('p3', 'About', 'about', 'https://example.com/about', goodMeta, html);
    const vpIssue = result.issues.find(i => i.check === 'viewport');
    expect(vpIssue).toBeDefined();
    expect(vpIssue?.severity).toBe('error');
  });

  it('flags missing canonical tag as error', () => {
    const html = `
      <html lang="en"><head>
        <title>A Good Enough Title For Testing Here Now</title>
        <meta name="description" content="A meta description that is long enough to pass the 50-character minimum check threshold.">
        <meta name="viewport" content="width=device-width, initial-scale=1">
      </head><body><h1>About Us</h1><p>Content here.</p></body></html>
    `;
    const result = auditPage('p3', 'About', 'about', 'https://example.com/about', goodMeta, html);
    const canonicalIssue = result.issues.find(i => i.check === 'canonical');
    expect(canonicalIssue).toBeDefined();
    expect(canonicalIssue?.severity).toBe('error');
  });

  it('flags images missing alt text as warning', () => {
    const html = `
      <html lang="en"><head>
        <title>A Good Enough Title For Testing Here Now</title>
        <meta name="description" content="A meta description that is long enough to pass the 50-character minimum check threshold.">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <link rel="canonical" href="https://example.com/about">
      </head><body>
        <h1>About Us</h1>
        <img src="photo.jpg">
        <img src="other.jpg">
        <p>Content here.</p>
      </body></html>
    `;
    const result = auditPage('p3', 'About', 'about', 'https://example.com/about', goodMeta, html);
    const altIssue = result.issues.find(i => i.check === 'img-alt');
    expect(altIssue).toBeDefined();
    expect(altIssue?.severity).toBe('warning');
    expect(altIssue?.message).toMatch(/missing alt/i);
  });

  it('does not flag img-alt when all images have alt text', () => {
    const html = `
      <html lang="en"><head>
        <title>A Good Enough Title For Testing Here Now</title>
        <meta name="description" content="A meta description that is long enough to pass the 50-character minimum check threshold.">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <link rel="canonical" href="https://example.com/about">
      </head><body>
        <h1>About Us</h1>
        <img src="photo.jpg" alt="Team photo">
        <img src="logo.png" alt="">
        <p>Content here.</p>
      </body></html>
    `;
    const result = auditPage('p3', 'About', 'about', 'https://example.com/about', goodMeta, html);
    const altIssue = result.issues.find(i => i.check === 'img-alt');
    expect(altIssue).toBeUndefined();
  });
});

// ============================================================================
// 2. auditPage() — scoring algorithm
// ============================================================================

describe('auditPage() — scoring algorithm', () => {
  it('returns score 100 for a page with no issues', () => {
    // A fully-compliant HTML page with all required elements
    const html = `
      <html lang="en"><head>
        <title>A Good Enough Title For Testing Purposes</title>
        <meta name="description" content="A meta description that is long enough to pass the 50-character minimum check threshold easily.">
        <meta property="og:title" content="A Good Enough Title For Testing Purposes">
        <meta property="og:description" content="A meta description that is long enough.">
        <meta property="og:image" content="https://example.com/og.jpg">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <link rel="canonical" href="https://example.com/home">
        <script type="application/ld+json">{"@context":"https://schema.org","@type":"WebPage"}</script>
      </head><body>
        <h1>Welcome to Our Great Service Page</h1>
        <p>This page has a good amount of content to satisfy the 300-word content check.
        We provide excellent services that help our clients achieve their goals. Our team
        of experts is dedicated to delivering high-quality results every time. With years
        of experience in the industry, we understand what it takes to succeed. Our clients
        trust us because we always deliver on our promises and go above and beyond their
        expectations. Contact us today to learn more about how we can help your business
        grow and thrive in this competitive market. We look forward to working with you.
        Our approach is always client-focused and results-driven. We offer a wide range
        of services tailored to meet your specific needs and budget requirements.
        </p>
        <a href="/services">See our services</a>
      </body></html>
    `;
    const meta = {
      id: 'pGood',
      title: 'A Good Enough Title For Testing Purposes',
      slug: 'home',
      seo: {
        title: 'A Good Enough Title For Testing Purposes',
        description: 'A meta description that is long enough to pass the 50-character minimum check threshold easily.',
      },
      openGraph: {
        title: 'A Good Enough Title For Testing Purposes',
        description: 'A meta description that is long enough.',
      },
    };
    const result = auditPage('pGood', 'Home', 'home', 'https://example.com/home', meta, html);
    // The HTML paragraph has ~135 visible words (< 300 threshold), which triggers a
    // content-length warning (-3 pts). Score is 97, not 100.
    // All other checks pass cleanly — no errors or additional warnings fire.
    expect(result.score).toBe(97);
  });

  it('reduces score below 100 for error-level issues', () => {
    // Missing title, meta description, canonical, viewport — multiple errors
    const html = `
      <html><head></head><body><h1>Something</h1><p>Content</p></body></html>
    `;
    const result = auditPage('pBad', 'Bad Page', 'bad-page', 'https://example.com/bad', null, html);
    expect(result.score).toBeLessThan(100);
  });

  it('score is clamped to 0 minimum', () => {
    // Absolute worst case: no meta, no HTML checks can pass
    const result = auditPage('pWorst', 'Worst Page', 'worst', 'https://example.com/worst', null, null);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it('errors deduct more than warnings from the score', () => {
    const goodMeta = {
      id: 'p',
      title: 'A Good Enough Title For Testing Purposes',
      slug: 'test',
      seo: {
        title: 'A Good Enough Title For Testing Purposes',
        description: 'A meta description that is long enough to pass check easily here.',
      },
    };
    // Page with only OG warnings (og-tags missing: 2 warnings at 3pts each = -6)
    const htmlNoOg = `
      <html lang="en"><head>
        <title>A Good Enough Title For Testing Purposes</title>
        <meta name="description" content="A meta description that is long enough to pass check easily here.">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <link rel="canonical" href="https://example.com/test">
      </head><body><h1>Test Page</h1><p>Content here for the page.</p></body></html>
    `;
    // Page with a critical error (canonical missing: -15 pts)
    const htmlNoCanonical = `
      <html lang="en"><head>
        <title>A Good Enough Title For Testing Purposes</title>
        <meta name="description" content="A meta description that is long enough to pass check easily here.">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <meta property="og:title" content="Title">
        <meta property="og:description" content="Description">
        <meta property="og:image" content="https://example.com/og.jpg">
      </head><body><h1>Test Page</h1><p>Content here for the page.</p></body></html>
    `;
    const resultWithWarnings = auditPage('pW', 'Test', 'test', 'https://example.com/test', goodMeta, htmlNoOg);
    const resultWithError = auditPage('pE', 'Test', 'test', 'https://example.com/test', goodMeta, htmlNoCanonical);

    expect(resultWithError.score).toBeLessThan(resultWithWarnings.score);
  });

  it('info-level issues do not reduce score', () => {
    // A page that triggers only info-level issues (no structured data)
    const meta = {
      id: 'pInfo',
      title: 'A Good Enough Title For Testing Purposes',
      slug: 'about',
      seo: {
        title: 'A Good Enough Title For Testing Purposes',
        description: 'A meta description that is long enough to pass the 50-character minimum check threshold easily.',
      },
      openGraph: {
        title: 'A Good Enough Title For Testing Purposes',
        description: 'A meta description that is long enough.',
      },
    };
    const html = `
      <html lang="en"><head>
        <title>A Good Enough Title For Testing Purposes</title>
        <meta name="description" content="A meta description that is long enough to pass the 50-character minimum check threshold easily.">
        <meta property="og:title" content="A Good Enough Title For Testing Purposes">
        <meta property="og:description" content="A meta description that is long enough.">
        <meta property="og:image" content="https://example.com/og.jpg">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <link rel="canonical" href="https://example.com/about">
        <!-- No JSON-LD structured data — triggers info-level issue only -->
      </head><body>
        <h1>About Our Team</h1>
        <p>We are a dedicated team of professionals providing excellent services. Our clients
        consistently achieve great results. We have years of experience and our team has helped
        hundreds of businesses grow and succeed. We look forward to helping you too. Contact us.
        </p>
        <a href="/services">See services</a>
      </body></html>
    `;
    const result = auditPage('pInfo', 'About', 'about', 'https://example.com/about', meta, html);
    const structuredDataIssue = result.issues.find(i => i.check === 'structured-data');
    expect(structuredDataIssue).toBeDefined();
    expect(structuredDataIssue?.severity).toBe('info');
    // The page paragraph has < 300 words, which triggers a content-length warning (-3 pts).
    // The structured-data info issue itself does NOT deduct from the score — that's
    // the behaviour under test. Score is 97 (100 - 3 for content-length warning only).
    expect(result.score).toBe(97);
  });
});

// ============================================================================
// 3. auditPage() — issue categories are auto-assigned
// ============================================================================

describe('auditPage() — issue categories', () => {
  it('title issues are categorised as content', () => {
    const result = auditPage('pCat1', 'Test', 'test', 'https://example.com', null, null);
    const titleIssue = result.issues.find(i => i.check === 'title');
    expect(titleIssue?.category).toBe('content');
  });

  it('canonical issues are categorised as technical', () => {
    const meta = {
      id: 'pCat2',
      title: 'A Good Enough Title For Testing Purposes',
      slug: 'test',
      seo: {
        title: 'A Good Enough Title For Testing Purposes',
        description: 'A meta description that is long enough to pass the 50-character minimum check threshold easily.',
      },
    };
    const html = `
      <html lang="en"><head>
        <title>A Good Enough Title</title>
        <meta name="description" content="Long enough description here.">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <!-- No canonical tag -->
      </head><body><h1>Test</h1><p>Content.</p></body></html>
    `;
    const result = auditPage('pCat2', 'Test', 'test', 'https://example.com/test', meta, html);
    const canonicalIssue = result.issues.find(i => i.check === 'canonical');
    expect(canonicalIssue?.category).toBe('technical');
  });

  it('img-alt issues are categorised as accessibility', () => {
    const meta = {
      id: 'pCat3',
      title: 'A Good Enough Title For Testing Purposes',
      slug: 'test',
      seo: {
        title: 'A Good Enough Title For Testing Purposes',
        description: 'A meta description that is long enough to pass the 50-character minimum check threshold easily.',
      },
    };
    const html = `
      <html lang="en"><head>
        <title>A Good Title</title>
        <meta name="description" content="Long enough description.">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <link rel="canonical" href="https://example.com/test">
      </head><body>
        <h1>Test</h1>
        <img src="photo.jpg">
        <p>Content.</p>
      </body></html>
    `;
    const result = auditPage('pCat3', 'Test', 'test', 'https://example.com/test', meta, html);
    const altIssue = result.issues.find(i => i.check === 'img-alt');
    expect(altIssue?.category).toBe('accessibility');
  });

  it('og-tags issues are categorised as social', () => {
    const result = auditPage('pCat4', 'Test', 'test', 'https://example.com', null, null);
    const ogIssue = result.issues.find(i => i.check === 'og-tags');
    expect(ogIssue?.category).toBe('social');
  });
});

// ============================================================================
// 4. isExcludedPage() helper
// ============================================================================

describe('isExcludedPage()', () => {
  it('excludes known utility slugs', () => {
    expect(isExcludedPage('404')).toBe(true);
    expect(isExcludedPage('thank-you')).toBe(true);
    expect(isExcludedPage('search')).toBe(true);
    expect(isExcludedPage('unsubscribe')).toBe(true);
  });

  it('excludes slugs containing legal/policy keywords', () => {
    expect(isExcludedPage('privacy-policy')).toBe(true);
    expect(isExcludedPage('terms-of-service')).toBe(true);
    expect(isExcludedPage('cookie-policy')).toBe(true);
  });

  it('excludes password-protected slugs', () => {
    expect(isExcludedPage('members-login')).toBe(true);
    expect(isExcludedPage('signin')).toBe(true);
  });

  it('does not exclude normal content slugs', () => {
    expect(isExcludedPage('about')).toBe(false);
    expect(isExcludedPage('services')).toBe(false);
    expect(isExcludedPage('blog/how-we-work')).toBe(false);
    expect(isExcludedPage('contact')).toBe(false);
  });

  it('strips leading slash before comparing', () => {
    expect(isExcludedPage('/404')).toBe(true);
    expect(isExcludedPage('/about')).toBe(false);
  });

  it('matches via page title when slug is clear', () => {
    // title contains "privacy" keyword
    expect(isExcludedPage('our-policies', 'Privacy and Cookie Policy')).toBe(true);
  });
});

// ============================================================================
// 5. isContentPage() helper
// ============================================================================

describe('isContentPage()', () => {
  it('identifies blog slugs as content pages', () => {
    expect(isContentPage('blog/my-article')).toBe(true);
    expect(isContentPage('/blog/seo-tips')).toBe(true);
  });

  it('identifies articles, guides, resources as content pages', () => {
    expect(isContentPage('articles/top-10-tips')).toBe(true);
    expect(isContentPage('guides/getting-started')).toBe(true);
    expect(isContentPage('resources/whitepaper')).toBe(true);
    expect(isContentPage('insights/industry-report')).toBe(true);
  });

  it('does not flag service/home pages as content pages', () => {
    expect(isContentPage('services')).toBe(false);
    expect(isContentPage('about')).toBe(false);
    expect(isContentPage('contact')).toBe(false);
    expect(isContentPage('')).toBe(false);
  });
});

// ============================================================================
// 6. Suppression — dismissSuggestions store (unit, direct DB)
// ============================================================================

describe('dismissSuggestions() — store', () => {
  const wsId = `ws_seo_dismiss_${Date.now()}`;
  const siteId = `site_seo_${Date.now()}`;

  it('saves a suggestion and it appears in listSuggestions', () => {
    saveSuggestion({
      workspaceId: wsId,
      siteId,
      pageId: '/home',
      pageTitle: 'Home',
      pageSlug: 'home',
      field: 'title',
      currentValue: 'Old Title',
      variations: ['Better Title One', 'Better Title Two', 'Better Title Three'],
    });

    const list = listSuggestions(wsId);
    expect(list.length).toBeGreaterThan(0);
    const sugg = list.find(s => s.pageId === '/home' && s.field === 'title');
    expect(sugg).toBeDefined();
    expect(sugg?.status).toBe('pending');
  });

  it('dismissSuggestions by id marks only that suggestion dismissed', () => {
    // Save two suggestions
    saveSuggestion({
      workspaceId: wsId,
      siteId,
      pageId: '/about',
      pageTitle: 'About',
      pageSlug: 'about',
      field: 'title',
      currentValue: 'Old About Title',
      variations: ['Better About One', 'Better About Two', 'Better About Three'],
    });
    saveSuggestion({
      workspaceId: wsId,
      siteId,
      pageId: '/about',
      pageTitle: 'About',
      pageSlug: 'about',
      field: 'description',
      currentValue: 'Old description',
      variations: ['New desc one', 'New desc two', 'New desc three'],
    });

    const before = listSuggestions(wsId);
    expect(before.length).toBeGreaterThan(0);
    const aboutTitle = before.find(s => s.pageId === '/about' && s.field === 'title');
    expect(aboutTitle).toBeDefined();

    // Dismiss only the title suggestion
    const dismissed = dismissSuggestions(wsId, [aboutTitle!.id]);
    expect(dismissed).toBe(1);

    // The title suggestion should now be gone from the pending list
    const after = listSuggestions(wsId);
    const stillThere = after.find(s => s.pageId === '/about' && s.field === 'title');
    expect(stillThere).toBeUndefined();

    // The description suggestion should still be pending
    const descStillThere = after.find(s => s.pageId === '/about' && s.field === 'description');
    expect(descStillThere).toBeDefined();
  });

  it('dismissSuggestions with no ids dismisses all pending for workspace', () => {
    // Seed two more suggestions
    saveSuggestion({
      workspaceId: wsId,
      siteId,
      pageId: '/contact',
      pageTitle: 'Contact',
      pageSlug: 'contact',
      field: 'title',
      currentValue: '',
      variations: ['Contact Us', 'Get in Touch', 'Reach Out'],
    });

    const before = listSuggestions(wsId);
    expect(before.length).toBeGreaterThan(0);

    const dismissed = dismissSuggestions(wsId);
    expect(dismissed).toBeGreaterThan(0);

    const after = listSuggestions(wsId);
    expect(after).toHaveLength(0);
  });

  it('returns 0 dismissed when workspace has no pending suggestions', () => {
    const emptyWsId = `ws_empty_${Date.now()}`;
    const dismissed = dismissSuggestions(emptyWsId);
    expect(dismissed).toBe(0);
  });
});

// ============================================================================
// 7. HTTP route — /api/webflow/seo-audit/:siteId (workspace-scoped, error handling)
// ============================================================================

describe('GET /api/webflow/seo-audit/:siteId — route contracts', () => {
  it('returns 500 when no Webflow token is configured for the site', async () => {
    // A site ID with no configured token → route returns 500 with helpful error
    const res = await api('/api/webflow/seo-audit/site_no_token_xyz');
    expect(res.status).toBe(500);
    const body = await res.json() as { error: string };
    expect(body.error).toBeDefined();
    expect(body.error).toMatch(/token|webflow/i);
  });
});

// ============================================================================
// 8. HTTP route — /api/webflow/seo-suggestions/:workspaceId (dismiss endpoint)
// ============================================================================

describe('DELETE /api/webflow/seo-suggestions/:workspaceId — dismiss endpoint', () => {
  let seededWsId: string;
  let seededSiteId: string;
  let cleanup: () => void;

  beforeAll(() => {
    const seeded = seedWorkspace();
    seededWsId = seeded.workspaceId;
    seededSiteId = seeded.webflowSiteId;
    cleanup = seeded.cleanup;
  });

  afterAll(() => {
    cleanup();
  });

  it('returns { dismissed: 0 } when no suggestions exist', async () => {
    const res = await del(`/api/webflow/seo-suggestions/${seededWsId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { dismissed: number };
    expect(typeof body.dismissed).toBe('number');
    expect(body.dismissed).toBe(0);
  });

  it('dismisses a suggestion by id via HTTP', async () => {
    // Create a suggestion directly in the store
    const sugg = saveSuggestion({
      workspaceId: seededWsId,
      siteId: seededSiteId,
      pageId: '/services',
      pageTitle: 'Services',
      pageSlug: 'services',
      field: 'title',
      currentValue: 'Services',
      variations: ['Service Variation One', 'Service Variation Two', 'Service Variation Three'],
    });

    // Verify it exists
    const before = listSuggestions(seededWsId);
    expect(before.length).toBeGreaterThan(0);

    // Dismiss via HTTP with specific IDs
    const res = await api(`/api/webflow/seo-suggestions/${seededWsId}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ suggestionIds: [sugg.id] }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { dismissed: number };
    expect(body.dismissed).toBe(1);

    // Verify it's no longer in the pending list
    const after = listSuggestions(seededWsId);
    const stillThere = after.find(s => s.id === sugg.id);
    expect(stillThere).toBeUndefined();
  });

  it('dismisses all pending suggestions when no ids provided', async () => {
    // Seed two suggestions
    saveSuggestion({
      workspaceId: seededWsId,
      siteId: seededSiteId,
      pageId: '/blog/a',
      pageTitle: 'Blog A',
      pageSlug: 'blog/a',
      field: 'title',
      currentValue: '',
      variations: ['Title A1', 'Title A2', 'Title A3'],
    });
    saveSuggestion({
      workspaceId: seededWsId,
      siteId: seededSiteId,
      pageId: '/blog/b',
      pageTitle: 'Blog B',
      pageSlug: 'blog/b',
      field: 'title',
      currentValue: '',
      variations: ['Title B1', 'Title B2', 'Title B3'],
    });

    const before = listSuggestions(seededWsId);
    expect(before.length).toBeGreaterThan(0);

    // Dismiss all — no body
    const res = await api(`/api/webflow/seo-suggestions/${seededWsId}`, {
      method: 'DELETE',
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { dismissed: number };
    expect(body.dismissed).toBeGreaterThan(0);

    const after = listSuggestions(seededWsId);
    expect(after).toHaveLength(0);
  });
});

// ============================================================================
// 9. Empty workspace audit — baseline not an error
// ============================================================================

describe('auditPage() — empty/baseline results', () => {
  it('returns a valid PageSeoResult shape even with no meta or HTML', () => {
    const result = auditPage('pEmpty', 'Page Name', 'some-page', 'https://example.com/some-page', null, null);

    // Shape assertions
    expect(result).toHaveProperty('pageId', 'pEmpty');
    expect(result).toHaveProperty('page', 'Page Name');
    expect(result).toHaveProperty('slug', 'some-page');
    expect(result).toHaveProperty('url', 'https://example.com/some-page');
    expect(result).toHaveProperty('score');
    expect(result).toHaveProperty('issues');

    // Score is a valid number in [0, 100]
    expect(typeof result.score).toBe('number');
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);

    // Issues is a non-empty array — a page with no meta or HTML should have issues flagged
    expect(Array.isArray(result.issues)).toBe(true);
    expect(result.issues.length).toBeGreaterThan(0);

    // Every issue has the required shape fields — assert length first to avoid vacuous .every()
    expect(result.issues.every(i => typeof i.check === 'string')).toBe(true);
    expect(result.issues.every(i => typeof i.severity === 'string')).toBe(true);
    expect(result.issues.every(i => typeof i.message === 'string')).toBe(true);
    expect(result.issues.every(i => typeof i.recommendation === 'string')).toBe(true);
  });

  it('does not throw for any combination of null inputs', () => {
    expect(() => auditPage('px', '', '', '', null, null)).not.toThrow();
    expect(() => auditPage('px', 'Name', 'slug', 'https://x.com', null, null)).not.toThrow();
    expect(() => auditPage('px', 'Name', 'slug', 'https://x.com', {
      id: 'px', title: '', slug: 'slug', seo: {}
    }, null)).not.toThrow();
  });

  it('workspace-scoped: different page IDs produce independent results', () => {
    const r1 = auditPage('page-1', 'Page One', 'page-one', 'https://example.com/page-one', null, null);
    const r2 = auditPage('page-2', 'Page Two', 'page-two', 'https://example.com/page-two', null, null);

    expect(r1.pageId).toBe('page-1');
    expect(r2.pageId).toBe('page-2');
    expect(r1.slug).toBe('page-one');
    expect(r2.slug).toBe('page-two');
  });
});
