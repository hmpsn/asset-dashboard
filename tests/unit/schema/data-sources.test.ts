import { describe, it, expect } from 'vitest';
import { extractPageData } from '../../../server/schema/data-sources.js';

const baseUrl = 'https://example.com';

const baseInput = {
  pageMeta: { title: 'Privacy Policy | Acme Co', slug: 'privacy', publishedPath: '/privacy' },
  html: '<html><head></head><body></body></html>',
  baseUrl: 'https://acme.com',
  workspace: { name: 'Acme Co', publisherLogoUrl: null, businessProfile: null, defaultLocale: 'en' },
};

describe('extractPageData — paid-grade fields', () => {
  it('strips brand suffix from title into cleanTitle', () => {
    const out = extractPageData(baseInput);
    expect(out.title).toBe('Privacy Policy | Acme Co');
    expect(out.cleanTitle).toBe('Privacy Policy');
  });

  it('uses cleanTitle for the breadcrumb leaf, not raw title', () => {
    const out = extractPageData(baseInput);
    const leaf = out.breadcrumbs[out.breadcrumbs.length - 1];
    expect(leaf.name).toBe('Privacy Policy');
  });

  it('falls back to workspace.defaultLocale for inLanguage', () => {
    const out = extractPageData(baseInput);
    expect(out.inLanguage).toBe('en');
  });

  it('uses pageMeta.locale when present', () => {
    const out = extractPageData({ ...baseInput, pageMeta: { ...baseInput.pageMeta, locale: 'fr-CA' } });
    expect(out.inLanguage).toBe('fr-CA');
  });

  it('derives articleSection from first URL segment', () => {
    const out = extractPageData({ ...baseInput, pageMeta: { ...baseInput.pageMeta, publishedPath: '/blog/foo' } });
    expect(out.articleSection).toBe('Blog');
  });

  it('omits articleSection for homepage', () => {
    const out = extractPageData({ ...baseInput, pageMeta: { ...baseInput.pageMeta, publishedPath: '/' } });
    expect(out.articleSection).toBeUndefined();
  });

  it('uses CMS fieldData["published-on"] as datePublished when present', () => {
    const out = extractPageData({
      ...baseInput,
      pageMeta: { ...baseInput.pageMeta, cmsFieldData: { 'published-on': '2026-01-15T00:00:00Z' } },
    });
    expect(out.datePublished).toBe('2026-01-15T00:00:00Z');
  });

  it('uses CMS fieldData["author-name"] as author when present', () => {
    const out = extractPageData({
      ...baseInput,
      pageMeta: { ...baseInput.pageMeta, cmsFieldData: { 'author-name': 'Jane Doe' } },
    });
    expect(out.author).toBe('Jane Doe');
  });
});

describe('extractPageData', () => {
  it('reads title from Webflow page meta first, then HTML <title>', () => {
    const html = '<html><head><title>HTML Title</title></head><body></body></html>';
    const data = extractPageData({
      pageMeta: { title: 'Meta Title', slug: 'x', publishedPath: '/x' },
      html,
      baseUrl,
      workspace: { name: 'Test', publisherLogoUrl: null, businessProfile: null },
    });
    expect(data.title).toBe('Meta Title');
  });

  it('falls back to HTML <title> when page meta has no title', () => {
    const html = '<html><head><title>HTML Title</title></head><body></body></html>';
    const data = extractPageData({
      pageMeta: { title: '', slug: 'x', publishedPath: '/x' },
      html,
      baseUrl,
      workspace: { name: 'Test', publisherLogoUrl: null, businessProfile: null },
    });
    expect(data.title).toBe('HTML Title');
  });

  it('reads description from meta name="description" or og:description', () => {
    const html = `<html><head>
      <meta name="description" content="Real description here">
      <meta property="og:description" content="OG description">
    </head></html>`;
    const data = extractPageData({
      pageMeta: { title: 'T', slug: 'x', publishedPath: '/x' },
      html,
      baseUrl,
      workspace: { name: 'Test', publisherLogoUrl: null, businessProfile: null },
    });
    expect(data.description).toBe('Real description here');
  });

  it('reads og:image as primary image', () => {
    const html = `<html><head>
      <meta property="og:image" content="https://cdn.example.com/og.jpg">
    </head></html>`;
    const data = extractPageData({
      pageMeta: { title: 'T', slug: 'x', publishedPath: '/x' },
      html,
      baseUrl,
      workspace: { name: 'Test', publisherLogoUrl: null, businessProfile: null },
    });
    expect(data.image).toBe('https://cdn.example.com/og.jpg');
  });

  it('returns undefined description when no meta tags', () => {
    const data = extractPageData({
      pageMeta: { title: 'T', slug: 'x', publishedPath: '/x' },
      html: '<html><head></head></html>',
      baseUrl,
      workspace: { name: 'Test', publisherLogoUrl: null, businessProfile: null },
    });
    expect(data.description).toBeUndefined();
  });

  it('builds breadcrumb items from URL hierarchy', () => {
    const data = extractPageData({
      pageMeta: { title: 'Final', slug: 'final', publishedPath: '/blog/cat/final' },
      html: '<html></html>',
      baseUrl,
      workspace: { name: 'Test', publisherLogoUrl: null, businessProfile: null },
    });
    expect(data.breadcrumbs).toEqual([
      { name: 'Home', url: 'https://example.com' },
      { name: 'Blog', url: 'https://example.com/blog' },
      { name: 'Cat', url: 'https://example.com/blog/cat' },
      { name: 'Final', url: 'https://example.com/blog/cat/final' },
    ]);
  });

  it('returns canonical URL from baseUrl + publishedPath', () => {
    const data = extractPageData({
      pageMeta: { title: 'T', slug: 'x', publishedPath: '/services/design' },
      html: '<html></html>',
      baseUrl,
      workspace: { name: 'Test', publisherLogoUrl: null, businessProfile: null },
    });
    expect(data.canonicalUrl).toBe('https://example.com/services/design');
  });

  it('extracts dates from <time> elements when present', () => {
    const html = `<html><body>
      <time datetime="2025-01-15T10:00:00Z" itemprop="datePublished">Jan 15</time>
      <time datetime="2026-04-01T12:00:00Z" itemprop="dateModified">Apr 1</time>
    </body></html>`;
    const data = extractPageData({
      pageMeta: { title: 'T', slug: 'x', publishedPath: '/blog/x' },
      html,
      baseUrl,
      workspace: { name: 'Test', publisherLogoUrl: null, businessProfile: null },
    });
    expect(data.datePublished).toBe('2025-01-15T10:00:00Z');
    expect(data.dateModified).toBe('2026-04-01T12:00:00Z');
  });

  it('exposes workspace name as default author/publisher', () => {
    const data = extractPageData({
      pageMeta: { title: 'T', slug: 'x', publishedPath: '/blog/x' },
      html: '<html></html>',
      baseUrl,
      workspace: { name: 'Acme Studio', publisherLogoUrl: null, businessProfile: null },
    });
    expect(data.publisher).toEqual({ name: 'Acme Studio', logoUrl: undefined });
  });
});
