/**
 * Unit tests for pure helper functions in server/sales-audit.ts.
 * Covers HTML parsing helpers, URL normalization, audit scoring, and page audit logic.
 */
import { describe, it, expect } from 'vitest';
import {
  extractTag,
  extractMetaContent,
  extractTitle,
  extractMetaDescription,
  countWords,
  extractLinks,
  extractImgTags,
  extractStyleBlocks,
  extractInlineScripts,
  countExternalResources,
  normalizeUrl,
  auditPageFromHtml,
} from '../../server/sales-audit.js';

// ── extractTag ──

describe('extractTag', () => {
  it('extracts a single tag content', () => {
    const html = '<html><body><h1>Hello World</h1></body></html>';
    expect(extractTag(html, 'h1')).toEqual(['Hello World']);
  });

  it('extracts multiple tags of the same type', () => {
    const html = '<p>First</p><p>Second</p><p>Third</p>';
    expect(extractTag(html, 'p')).toEqual(['First', 'Second', 'Third']);
  });

  it('returns empty array when tag not found', () => {
    expect(extractTag('<html></html>', 'h1')).toEqual([]);
  });

  it('handles tags with attributes', () => {
    const html = '<h1 class="title" id="main">My Title</h1>';
    expect(extractTag(html, 'h1')).toEqual(['My Title']);
  });

  it('trims whitespace from content', () => {
    const html = '<h1>  Trimmed  </h1>';
    expect(extractTag(html, 'h1')).toEqual(['Trimmed']);
  });
});

// ── extractMetaContent ──

describe('extractMetaContent', () => {
  it('extracts content from name attribute meta', () => {
    const html = '<meta name="description" content="My description">';
    expect(extractMetaContent(html, 'description')).toBe('My description');
  });

  it('extracts content from property attribute meta (OG)', () => {
    const html = '<meta property="og:title" content="OG Title">';
    expect(extractMetaContent(html, 'og:title')).toBe('OG Title');
  });

  it('extracts content when content comes before name', () => {
    const html = '<meta content="Reversed order" name="description">';
    expect(extractMetaContent(html, 'description')).toBe('Reversed order');
  });

  it('returns null when meta tag not found', () => {
    expect(extractMetaContent('<html></html>', 'description')).toBeNull();
  });

  it('extracts robots meta content', () => {
    const html = '<meta name="robots" content="noindex, nofollow">';
    expect(extractMetaContent(html, 'robots')).toBe('noindex, nofollow');
  });
});

// ── extractTitle ──

describe('extractTitle', () => {
  it('extracts title from title tag', () => {
    const html = '<html><head><title>My Page Title</title></head></html>';
    expect(extractTitle(html)).toBe('My Page Title');
  });

  it('returns empty string when no title tag', () => {
    expect(extractTitle('<html><head></head></html>')).toBe('');
  });

  it('trims whitespace', () => {
    const html = '<title>  Spaced Title  </title>';
    expect(extractTitle(html)).toBe('Spaced Title');
  });

  it('handles HTML entities in title', () => {
    const html = '<title>Ampersand &amp; Company</title>';
    const result = extractTitle(html);
    // decodeEntities should decode &amp; → &
    expect(result).toContain('Ampersand');
    expect(result).toContain('Company');
  });
});

// ── extractMetaDescription ──

describe('extractMetaDescription', () => {
  it('returns meta description content', () => {
    const html = '<meta name="description" content="A page about cats">';
    expect(extractMetaDescription(html)).toBe('A page about cats');
  });

  it('returns empty string when no description tag', () => {
    expect(extractMetaDescription('<html></html>')).toBe('');
  });
});

// ── countWords ──

describe('countWords', () => {
  it('counts words in plain text', () => {
    const html = '<p>Hello world this is a test</p>';
    expect(countWords(html)).toBe(6);
  });

  it('strips script tags before counting', () => {
    const html = '<p>Visible text</p><script>var x = "hidden words";</script>';
    expect(countWords(html)).toBe(2);
  });

  it('strips style tags before counting', () => {
    const html = '<p>Real content</p><style>.class { color: red; }</style>';
    expect(countWords(html)).toBe(2);
  });

  it('returns 0 for empty content', () => {
    expect(countWords('<html><head></head><body></body></html>')).toBe(0);
  });

  it('counts words from multiple elements', () => {
    const html = '<h1>Title Here</h1><p>Body with more words here</p>';
    // "Title Here" (2) + "Body with more words here" (5) = 7
    expect(countWords(html)).toBe(7);
  });
});

// ── extractLinks ──

describe('extractLinks', () => {
  it('extracts href and text from anchor tags', () => {
    const html = '<a href="/about">About Us</a>';
    const links = extractLinks(html);
    expect(links).toHaveLength(1);
    expect(links[0].href).toBe('/about');
    expect(links[0].text).toBe('About Us');
  });

  it('extracts multiple links', () => {
    const html = '<a href="/home">Home</a><a href="/contact">Contact</a>';
    const links = extractLinks(html);
    expect(links).toHaveLength(2);
  });

  it('strips HTML from link text', () => {
    const html = '<a href="/blog"><span>Blog</span></a>';
    const links = extractLinks(html);
    expect(links[0].text).toBe('Blog');
  });

  it('returns empty array when no links', () => {
    expect(extractLinks('<p>No links here</p>')).toEqual([]);
  });
});

// ── extractImgTags ──

describe('extractImgTags', () => {
  it('extracts src and alt from img tags', () => {
    const html = '<img src="/logo.png" alt="Company Logo">';
    const imgs = extractImgTags(html);
    expect(imgs).toHaveLength(1);
    expect(imgs[0].src).toBe('/logo.png');
    expect(imgs[0].alt).toBe('Company Logo');
  });

  it('detects lazy loading attribute', () => {
    const html = '<img src="/hero.jpg" alt="Hero" loading="lazy">';
    const imgs = extractImgTags(html);
    expect(imgs[0].loading).toBe('lazy');
  });

  it('detects width and height attributes', () => {
    const html = '<img src="/pic.jpg" alt="Pic" width="100" height="100">';
    const imgs = extractImgTags(html);
    expect(imgs[0].hasWidth).toBe(true);
    expect(imgs[0].hasHeight).toBe(true);
  });

  it('reports false for missing width/height', () => {
    const html = '<img src="/pic.jpg" alt="Pic">';
    const imgs = extractImgTags(html);
    expect(imgs[0].hasWidth).toBe(false);
    expect(imgs[0].hasHeight).toBe(false);
  });

  it('returns empty array when no images', () => {
    expect(extractImgTags('<p>No images</p>')).toEqual([]);
  });
});

// ── extractStyleBlocks ──

describe('extractStyleBlocks', () => {
  it('returns total byte count of inline style content', () => {
    const css = 'body { margin: 0; }';
    const html = `<style>${css}</style>`;
    expect(extractStyleBlocks(html)).toBe(css.length);
  });

  it('sums multiple style blocks', () => {
    const html = '<style>a{}</style><style>b{}</style>';
    expect(extractStyleBlocks(html)).toBe(3 + 3); // 'a{}' + 'b{}'
  });

  it('returns 0 when no style blocks', () => {
    expect(extractStyleBlocks('<html></html>')).toBe(0);
  });
});

// ── extractInlineScripts ──

describe('extractInlineScripts', () => {
  it('counts inline script content length', () => {
    const js = 'console.log("hello");';
    const html = `<script>${js}</script>`;
    expect(extractInlineScripts(html)).toBe(js.length);
  });

  it('skips external script tags (those with src)', () => {
    const html = '<script src="/app.js"></script>';
    expect(extractInlineScripts(html)).toBe(0);
  });

  it('skips JSON-LD script blocks', () => {
    const html = '<script type="application/ld+json">{"@context":"https://schema.org"}</script>';
    expect(extractInlineScripts(html)).toBe(0);
  });

  it('returns 0 when no inline scripts', () => {
    expect(extractInlineScripts('<html><head></head></html>')).toBe(0);
  });
});

// ── countExternalResources ──

describe('countExternalResources', () => {
  it('counts external stylesheets', () => {
    const html = '<link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/print.css">';
    const result = countExternalResources(html);
    expect(result.stylesheets).toBe(2);
    expect(result.scripts).toBe(0);
  });

  it('counts external scripts', () => {
    const html = '<script src="/app.js"></script><script src="/vendor.js"></script>';
    const result = countExternalResources(html);
    expect(result.stylesheets).toBe(0);
    expect(result.scripts).toBe(2);
  });

  it('counts both stylesheets and scripts together', () => {
    const html = '<link rel="stylesheet" href="/s.css"><script src="/a.js"></script>';
    const result = countExternalResources(html);
    expect(result.stylesheets).toBe(1);
    expect(result.scripts).toBe(1);
  });

  it('returns zeros for empty HTML', () => {
    const result = countExternalResources('<html></html>');
    expect(result.stylesheets).toBe(0);
    expect(result.scripts).toBe(0);
  });
});

// ── normalizeUrl ──

describe('normalizeUrl', () => {
  it('returns full URL for same-origin relative path', () => {
    expect(normalizeUrl('https://example.com', '/about')).toBe('https://example.com/about');
  });

  it('returns null for external URLs', () => {
    expect(normalizeUrl('https://example.com', 'https://other.com/page')).toBeNull();
  });

  it('returns null for asset file extensions', () => {
    expect(normalizeUrl('https://example.com', '/image.jpg')).toBeNull();
    expect(normalizeUrl('https://example.com', '/style.css')).toBeNull();
    expect(normalizeUrl('https://example.com', '/app.js')).toBeNull();
    expect(normalizeUrl('https://example.com', '/doc.pdf')).toBeNull();
  });

  it('strips hash fragments', () => {
    const result = normalizeUrl('https://example.com', '/page#section');
    expect(result).toBe('https://example.com/page');
  });

  it('returns null for Cloudflare CDN-CGI paths', () => {
    expect(normalizeUrl('https://example.com', '/cdn-cgi/image/test')).toBeNull();
  });

  it('returns null for malformed URLs', () => {
    // A truly invalid URL that the URL constructor throws on
    expect(normalizeUrl('not-a-base-url', 'relative-path')).toBeNull();
  });

  it('handles absolute same-origin URLs', () => {
    const result = normalizeUrl('https://example.com', 'https://example.com/blog');
    expect(result).toBe('https://example.com/blog');
  });
});

// ── auditPageFromHtml ──

describe('auditPageFromHtml — scoring', () => {
  it('returns perfect score for a well-formed page', () => {
    const html = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <title>Perfect SEO Page - My Great Company</title>
        <meta name="description" content="This is a detailed meta description that is between fifty and one hundred sixty characters long.">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <link rel="canonical" href="https://example.com/perfect">
        <meta property="og:title" content="Perfect SEO Page">
        <meta property="og:description" content="OG description for sharing">
        <meta property="og:image" content="https://example.com/image.jpg">
        <meta name="twitter:card" content="summary_large_image">
        <script type="application/ld+json">{"@context":"https://schema.org","@type":"WebPage"}</script>
        <link rel="icon" href="/favicon.ico">
      </head>
      <body>
        <h1>Perfect SEO Page</h1>
        <h2>Section One</h2>
        <p>This page has enough content to pass the word count threshold. We need at least three hundred words to avoid the thin content warning that gets triggered for pages that do not have enough text. Let me keep writing until I have enough words to satisfy the checker. The content needs to be comprehensive and valuable to the readers who visit this page. Search engines favor pages with more content because they tend to provide more value. This is why content length is an important SEO factor that we must consider.</p>
        <a href="/other-page">Internal Link</a>
        <img src="/photo.jpg" alt="A descriptive alt text" width="800" height="600">
      </body>
      </html>
    `;
    const result = auditPageFromHtml('https://example.com/perfect', html);
    expect(result.score).toBeGreaterThanOrEqual(70);
  });

  it('gives lower score for pages missing key elements', () => {
    const html = '<html><body><p>Short.</p></body></html>';
    const result = auditPageFromHtml('https://example.com/', html);
    expect(result.score).toBeLessThan(60);
  });

  it('detects missing title as error severity', () => {
    const html = '<html><head></head><body><h1>Test</h1></body></html>';
    const result = auditPageFromHtml('https://example.com/', html);
    const titleIssue = result.issues.find(i => i.check === 'title');
    expect(titleIssue).toBeDefined();
    expect(titleIssue!.severity).toBe('error');
  });

  it('detects title too short as warning', () => {
    const html = '<html><head><title>Hi</title></head></html>';
    const result = auditPageFromHtml('https://example.com/', html);
    const issue = result.issues.find(i => i.check === 'title');
    expect(issue).toBeDefined();
    expect(issue!.severity).toBe('warning');
  });

  it('detects title too long as warning', () => {
    const longTitle = 'A'.repeat(65);
    const html = `<html><head><title>${longTitle}</title></head></html>`;
    const result = auditPageFromHtml('https://example.com/', html);
    const issue = result.issues.find(i => i.check === 'title');
    expect(issue!.severity).toBe('warning');
    expect(issue!.message).toContain('65 chars');
  });

  it('detects missing meta description as error', () => {
    const html = '<html><head><title>Valid Title Here</title></head></html>';
    const result = auditPageFromHtml('https://example.com/', html);
    const issue = result.issues.find(i => i.check === 'meta-description');
    expect(issue!.severity).toBe('error');
  });

  it('detects multiple H1 tags as warning', () => {
    const html = '<html><body><h1>First</h1><h1>Second</h1></body></html>';
    const result = auditPageFromHtml('https://example.com/', html);
    const issue = result.issues.find(i => i.check === 'h1');
    expect(issue).toBeDefined();
    expect(issue!.severity).toBe('warning');
    expect(issue!.message).toContain('Multiple H1');
  });

  it('detects missing viewport as error', () => {
    const html = '<html><head></head><body></body></html>';
    const result = auditPageFromHtml('https://example.com/', html);
    const issue = result.issues.find(i => i.check === 'viewport');
    expect(issue!.severity).toBe('error');
  });

  it('detects mixed content on HTTPS pages', () => {
    const html = `
      <html><head></head><body>
        <img src="http://insecure.com/image.jpg" alt="test">
      </body></html>
    `;
    const result = auditPageFromHtml('https://example.com/', html);
    const issue = result.issues.find(i => i.check === 'mixed-content');
    expect(issue).toBeDefined();
    expect(issue!.severity).toBe('error');
  });

  it('skips mixed content check for HTTP pages', () => {
    const html = '<html><body><img src="http://example.com/img.jpg" alt="x"></body></html>';
    const result = auditPageFromHtml('http://example.com/', html);
    const issue = result.issues.find(i => i.check === 'mixed-content');
    expect(issue).toBeUndefined();
  });

  it('detects noindex robots meta as warning', () => {
    const html = '<html><head><meta name="robots" content="noindex"></head></html>';
    const result = auditPageFromHtml('https://example.com/', html);
    const issue = result.issues.find(i => i.check === 'robots');
    expect(issue).toBeDefined();
    expect(issue!.severity).toBe('warning');
  });

  it('assigns category to each issue', () => {
    const html = '<html><body><p>short</p></body></html>';
    const result = auditPageFromHtml('https://example.com/', html);
    for (const issue of result.issues) {
      expect(issue.category).toBeDefined();
    }
  });

  it('detects heading hierarchy skip', () => {
    const html = '<html><body><h1>Title</h1><h3>Skipped H2</h3></body></html>';
    const result = auditPageFromHtml('https://example.com/', html);
    const issue = result.issues.find(i => i.check === 'heading-hierarchy');
    expect(issue).toBeDefined();
    expect(issue!.severity).toBe('warning');
  });

  it('caps score at 0 minimum', () => {
    // Worst case page — completely empty
    const result = auditPageFromHtml('https://example.com/', '<html></html>');
    expect(result.score).toBeGreaterThanOrEqual(0);
  });

  it('generates correct page name from URL', () => {
    const result = auditPageFromHtml('https://example.com/about-us', '<html></html>');
    expect(result.page).toBe('About Us');
  });

  it('uses "Home" for root path', () => {
    const result = auditPageFromHtml('https://example.com/', '<html></html>');
    expect(result.page).toBe('Home');
  });

  it('detects images missing alt text', () => {
    const html = '<html><body><img src="/a.jpg"><img src="/b.jpg" alt=""></body></html>';
    const result = auditPageFromHtml('https://example.com/', html);
    const issue = result.issues.find(i => i.check === 'img-alt');
    expect(issue).toBeDefined();
    expect(issue!.severity).toBe('warning');
  });

  it('detects h1-title-match when they are identical', () => {
    const html = `
      <html><head><title>Exact Same Text</title></head>
      <body><h1>Exact Same Text</h1></body></html>
    `;
    const result = auditPageFromHtml('https://example.com/', html);
    const issue = result.issues.find(i => i.check === 'h1-title-match');
    expect(issue).toBeDefined();
    expect(issue!.severity).toBe('info');
  });
});
