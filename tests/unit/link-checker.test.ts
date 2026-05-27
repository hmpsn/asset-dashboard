/**
 * Unit tests for link-checker URL filtering utilities.
 *
 * Covers:
 * - isCheckableUrl: should reject Cloudflare cdn-cgi email-protection URLs
 * - normalizeUrl (sales-audit): should skip cdn-cgi paths during crawl discovery
 */
import { describe, it, expect } from 'vitest';
import { isCheckableUrl } from '../../server/link-checker.js';
import { normalizeUrl } from '../../server/sales-audit.js';
import { extractLinks as extractHtmlLinks } from '../../server/html-analysis-utils.js';

// ── isCheckableUrl ──

describe('isCheckableUrl', () => {
  it('returns false for Cloudflare email-protection href (relative)', () => {
    expect(isCheckableUrl('/cdn-cgi/l/email-protection#4c2d202d21')).toBe(false);
  });

  it('returns false for Cloudflare email-protection href (absolute)', () => {
    expect(isCheckableUrl('https://example.com/cdn-cgi/l/email-protection#abc')).toBe(false);
  });

  it('returns false for other cdn-cgi utility paths', () => {
    expect(isCheckableUrl('/cdn-cgi/trace')).toBe(false);
    expect(isCheckableUrl('/cdn-cgi/challenge-platform/h/g')).toBe(false);
  });

  it('returns false for mailto links', () => {
    expect(isCheckableUrl('mailto:info@example.com')).toBe(false);
  });

  it('returns false for tel links', () => {
    expect(isCheckableUrl('tel:+15551234567')).toBe(false);
  });

  it('returns false for javascript: links', () => {
    expect(isCheckableUrl('javascript:void(0)')).toBe(false);
  });

  it('returns false for anchor-only links', () => {
    expect(isCheckableUrl('#section-2')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isCheckableUrl('')).toBe(false);
  });

  it('returns true for normal relative paths', () => {
    expect(isCheckableUrl('/about')).toBe(true);
    expect(isCheckableUrl('/blog/post-title')).toBe(true);
  });

  it('returns true for normal absolute URLs', () => {
    expect(isCheckableUrl('https://example.com/page')).toBe(true);
    expect(isCheckableUrl('http://example.com')).toBe(true);
  });
});

// ── normalizeUrl (sales-audit normalizeUrl) ──

describe('normalizeUrl', () => {
  const base = 'https://swishsmiles.com';

  it('returns null for Cloudflare email-protection path', () => {
    expect(normalizeUrl(base, '/cdn-cgi/l/email-protection#4c2d202d21')).toBeNull();
  });

  it('returns null for other cdn-cgi paths', () => {
    expect(normalizeUrl(base, '/cdn-cgi/trace')).toBeNull();
  });

  it('returns null for cross-origin links', () => {
    expect(normalizeUrl(base, 'https://external.com/page')).toBeNull();
  });

  it('returns null for static asset paths', () => {
    expect(normalizeUrl(base, '/image.jpg')).toBeNull();
    expect(normalizeUrl(base, '/styles.css')).toBeNull();
  });

  it('returns absolute URL for same-origin relative path', () => {
    expect(normalizeUrl(base, '/about')).toBe('https://swishsmiles.com/about');
  });

  it('returns absolute URL for same-origin absolute link', () => {
    expect(normalizeUrl(base, 'https://swishsmiles.com/blog')).toBe('https://swishsmiles.com/blog');
  });
});

describe('link-checker extraction mode', () => {
  it('keeps rich onclick/form discovery with dedupe + checkable-url filtering', () => {
    const html = `
      <a href="/about">About</a>
      <a href="/about">About Duplicate</a>
      <button onclick="window.location.href='/contact'">Contact</button>
      <form action="/book-now"></form>
      <a href="mailto:test@example.com">Email</a>
      <a href="#footer">Footer</a>
    `;

    const links = extractHtmlLinks(html, {
      includeOnclickUrls: true,
      includeFormActions: true,
      dedupeByHref: true,
      excludeHashAnchors: true,
      requireNonEmptyHref: true,
      filterHref: isCheckableUrl,
      maxTextLength: 100,
      onclickFallbackText: '[button/onclick]',
      formActionText: '[form action]',
    });

    expect(links).toHaveLength(3);
    expect(links[0]).toEqual({ href: '/about', text: 'About' });
    expect(links[1].href).toBe('/contact');
    expect(links[1].text.length).toBeGreaterThan(0);
    expect(links[2]).toEqual({ href: '/book-now', text: '[form action]' });
  });
});
