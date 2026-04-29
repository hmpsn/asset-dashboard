import { describe, it, expect } from 'vitest';
import { extractPageData } from '../../../server/schema/data-sources.js';

const baseUrl = 'https://example.com';

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
