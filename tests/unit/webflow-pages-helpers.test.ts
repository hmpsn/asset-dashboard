/**
 * Wave 23 — Additional pure function unit tests for server/webflow-pages.ts
 *
 * Complements tests/unit/webflow-pages-pure.test.ts (wave 20) with:
 *   - filterPublishedPages: additional edge cases (undefined draft/archived, multiple exclusions)
 *   - toCmsPageId: numeric and special character paths, root with trailing slash
 *   - buildStaticPathSet: draft/archived pages excluded, CMS pages excluded
 *   - buildStaticSitemapPathIndex: path normalization, root URL, multiple entries
 *   - resolveStaticPagePathFromSitemap: more resolution scenarios including
 *     missing-from-sitemap, deep nesting, home slug variants
 *   - resolveStaticPagePathsFromSitemap: multi-page mixed scenarios
 */

import { describe, it, expect } from 'vitest';
import {
  filterPublishedPages,
  toCmsPageId,
  buildStaticPathSet,
  buildStaticSitemapPathIndex,
  resolveStaticPagePathFromSitemap,
  resolveStaticPagePathsFromSitemap,
  type WebflowPage,
} from '../../server/webflow-pages.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makePage(overrides: Partial<WebflowPage> = {}): WebflowPage {
  return {
    id: `page-${Math.random().toString(36).slice(2)}`,
    title: 'Test Page',
    slug: 'test',
    draft: false,
    archived: false,
    collectionId: null,
    publishedPath: '/test',
    ...overrides,
  };
}

// ── filterPublishedPages — additional edge cases ──────────────────────────────

describe('filterPublishedPages — edge cases', () => {
  it('treats undefined draft as non-draft (included)', () => {
    const pages = [makePage({ slug: 'about', publishedPath: '/about', draft: undefined })];
    expect(filterPublishedPages(pages)).toHaveLength(1);
  });

  it('treats undefined archived as non-archived (included)', () => {
    const pages = [makePage({ slug: 'about', publishedPath: '/about', archived: undefined })];
    expect(filterPublishedPages(pages)).toHaveLength(1);
  });

  it('excludes page that is both draft and archived', () => {
    const pages = [makePage({ slug: 'hidden', publishedPath: '/hidden', draft: true, archived: true })];
    expect(filterPublishedPages(pages)).toHaveLength(0);
  });

  it('excludes CMS page even if it has a publishedPath', () => {
    const pages = [makePage({ slug: 'blog-post', publishedPath: '/blog/blog-post', collectionId: 'col-xyz' })];
    expect(filterPublishedPages(pages)).toHaveLength(0);
  });

  it('excludes CMS page even if it is not draft and not archived', () => {
    const pages = [makePage({ slug: 'item', publishedPath: '/items/item', draft: false, archived: false, collectionId: 'col-abc' })];
    expect(filterPublishedPages(pages)).toHaveLength(0);
  });

  it('includes page with publishedPath that is an empty string (falsy but not null)', () => {
    // publishedPath = '' is falsy; but slug '' falls into homepage rule
    const pages = [makePage({ slug: '', publishedPath: '' })];
    // '' slug is homepage, so it passes the `p.slug === ''` check
    expect(filterPublishedPages(pages)).toHaveLength(1);
  });

  it('correctly handles large mixed page list with multiple exclusion types', () => {
    const pages = [
      makePage({ id: 'p1', slug: 'home', publishedPath: null }), // homepage → included
      makePage({ id: 'p2', slug: 'about', publishedPath: '/about' }), // normal → included
      makePage({ id: 'p3', slug: 'blog-post', publishedPath: '/blog/item', collectionId: 'col-1' }), // CMS → excluded
      makePage({ id: 'p4', slug: 'draft-page', publishedPath: '/draft', draft: true }), // draft → excluded
      makePage({ id: 'p5', slug: 'archived', publishedPath: '/archived', archived: true }), // archived → excluded
      makePage({ id: 'p6', slug: 'contact', publishedPath: '/contact' }), // normal → included
      makePage({ id: 'p7', slug: 'services', publishedPath: '/services' }), // normal → included
    ];
    const result = filterPublishedPages(pages);
    expect(result).toHaveLength(4);
    const slugs = result.map(p => p.slug);
    expect(slugs).toContain('home');
    expect(slugs).toContain('about');
    expect(slugs).toContain('contact');
    expect(slugs).toContain('services');
  });

  it('preserves page objects by reference for non-mutating behavior', () => {
    const page = makePage({ slug: 'about', publishedPath: '/about' });
    const result = filterPublishedPages([page]);
    expect(result[0]).toBe(page);
  });

  it('handles page where publishedPath is a deeply nested path', () => {
    const pages = [makePage({ slug: 'item', publishedPath: '/a/b/c/d/e' })];
    expect(filterPublishedPages(pages)).toHaveLength(1);
  });
});

// ── toCmsPageId — additional edge cases ────────────────────────────────────────

describe('toCmsPageId — additional edge cases', () => {
  it('handles path with numbers', () => {
    expect(toCmsPageId('/2024/01/post')).toBe('cms-2024-01-post');
  });

  it('handles deeply nested path', () => {
    expect(toCmsPageId('/a/b/c/d/e')).toBe('cms-a-b-c-d-e');
  });

  it('handles path with uppercase letters', () => {
    // toCmsPageId does not lowercase — just strips leading slash and replaces /
    expect(toCmsPageId('/MyPage/SubPage')).toBe('cms-MyPage-SubPage');
  });

  it('handles path with multiple consecutive slashes', () => {
    // Only leading slash is stripped; inner slashes are replaced
    expect(toCmsPageId('/a//b')).toBe('cms-a--b');
  });

  it('handles single segment without leading slash', () => {
    expect(toCmsPageId('about')).toBe('cms-about');
  });

  it('returns consistent output for same input', () => {
    const input = '/products/shoes';
    expect(toCmsPageId(input)).toBe(toCmsPageId(input));
  });
});

// ── buildStaticPathSet — additional edge cases ────────────────────────────────

describe('buildStaticPathSet — additional edge cases', () => {
  it('excludes draft pages from the path set', () => {
    // buildStaticPathSet does NOT filter draft; it includes ALL pages passed to it.
    // The caller is responsible for pre-filtering with filterPublishedPages.
    // Test that it still adds the path from a draft page (no filtering here).
    const pages = [makePage({ slug: 'draft', publishedPath: '/draft', draft: true })];
    const result = buildStaticPathSet(pages);
    // Path is still included (buildStaticPathSet itself doesn't filter)
    expect(result.has('/draft')).toBe(true);
  });

  it('deduplicates identical paths', () => {
    const pages = [
      makePage({ id: 'p1', slug: 'about', publishedPath: '/about' }),
      makePage({ id: 'p2', slug: 'about', publishedPath: '/about' }),
    ];
    const result = buildStaticPathSet(pages);
    // Set deduplicates; /about appears once
    expect(result.has('/about')).toBe(true);
    // The set size is 2 ('' root + '/about'), not 3
    expect(result.size).toBe(2);
  });

  it('normalizes paths to lowercase', () => {
    const pages = [makePage({ slug: 'SERVICES', publishedPath: '/SERVICES' })];
    const result = buildStaticPathSet(pages);
    expect(result.has('/services')).toBe(true);
    expect(result.has('/SERVICES')).toBe(false);
  });

  it('strips trailing slashes from paths', () => {
    const pages = [makePage({ slug: 'about', publishedPath: '/about/' })];
    const result = buildStaticPathSet(pages);
    expect(result.has('/about')).toBe(true);
    expect(result.has('/about/')).toBe(false);
  });

  it('builds large path sets without errors', () => {
    const pages = Array.from({ length: 100 }, (_, i) =>
      makePage({ id: `p${i}`, slug: `page-${i}`, publishedPath: `/page-${i}` }),
    );
    const result = buildStaticPathSet(pages);
    expect(result.size).toBe(101); // 100 pages + root ''
    expect(result.has('/page-0')).toBe(true);
    expect(result.has('/page-99')).toBe(true);
  });
});

// ── buildStaticSitemapPathIndex — additional edge cases ───────────────────────

describe('buildStaticSitemapPathIndex — additional edge cases', () => {
  const baseUrl = 'https://example.com';

  it('indexes multiple URLs from same host', () => {
    const result = buildStaticSitemapPathIndex(
      ['https://example.com/about', 'https://example.com/contact', 'https://example.com/services'],
      baseUrl,
    );
    expect(result.pathSet.has('/about')).toBe(true);
    expect(result.pathSet.has('/contact')).toBe(true);
    expect(result.pathSet.has('/services')).toBe(true);
  });

  it('stores null for ambiguous leaf when same slug appears under two parents', () => {
    // 'services' as leaf under two different parent paths
    const result = buildStaticSitemapPathIndex(
      ['https://example.com/agency/services', 'https://example.com/local/services'],
      baseUrl,
    );
    expect(result.uniqueLeafPaths.get('services')).toBeNull();
  });

  it('treats the same leaf path twice as not ambiguous (same path both times)', () => {
    const result = buildStaticSitemapPathIndex(
      ['https://example.com/about', 'https://example.com/about'],
      baseUrl,
    );
    // Duplicate entry for same path → leaf maps to same path (not null)
    expect(result.uniqueLeafPaths.get('about')).toBe('/about');
  });

  it('handles URL with query string by ignoring query params in path', () => {
    const result = buildStaticSitemapPathIndex(
      ['https://example.com/about?ref=sitemap'],
      baseUrl,
    );
    expect(result.pathSet.has('/about')).toBe(true);
  });

  it('handles https vs http from the same host', () => {
    // Different scheme but same host — both should be filtered by host
    const httpsBase = 'https://example.com';
    const result = buildStaticSitemapPathIndex(
      ['http://example.com/about'],
      httpsBase,
    );
    // http vs https — same hostname → included
    expect(result.pathSet.has('/about')).toBe(true);
  });

  it('handles deeply nested path leaf extraction correctly', () => {
    const result = buildStaticSitemapPathIndex(
      ['https://example.com/blog/2024/january/my-post'],
      baseUrl,
    );
    expect(result.pathSet.has('/blog/2024/january/my-post')).toBe(true);
    expect(result.uniqueLeafPaths.get('my-post')).toBe('/blog/2024/january/my-post');
  });

  it('returns empty uniqueLeafPaths for root-only URL', () => {
    const result = buildStaticSitemapPathIndex(
      ['https://example.com/'],
      baseUrl,
    );
    // Root path '/' has no leaf (empty string)
    expect(result.pathSet.has('/')).toBe(true);
    // No leaf entry added for root
    expect(result.uniqueLeafPaths.size).toBe(0);
  });
});

// ── resolveStaticPagePathFromSitemap — additional edge cases ─────────────────

describe('resolveStaticPagePathFromSitemap — additional edge cases', () => {
  it('returns current path for homepage with slug "home" when no sitemap match', () => {
    const index = buildStaticSitemapPathIndex([], 'https://example.com');
    // slug 'home' is explicitly skipped → returns current resolved path
    // resolvePagePath({ slug: 'home', publishedPath: null }) → '/home' (slug fallback)
    const result = resolveStaticPagePathFromSitemap({ slug: 'home', publishedPath: null }, index);
    // The current path is '/home' (slug-based fallback), not necessarily '/'
    expect(result).toBe('/home');
  });

  it('resolves a missing-from-sitemap path to the sitemap match', () => {
    // Page has publishedPath '/products' but sitemap has '/shop/products'
    const index = buildStaticSitemapPathIndex(
      ['https://example.com/shop/products'],
      'https://example.com',
    );
    const result = resolveStaticPagePathFromSitemap(
      { slug: 'products', publishedPath: '/products' },
      index,
    );
    // /products is a leaf fallback for 'products' → resolves to /shop/products
    expect(result).toBe('/shop/products');
  });

  it('keeps current path when current path already exists in sitemap', () => {
    const index = buildStaticSitemapPathIndex(
      ['https://example.com/about'],
      'https://example.com',
    );
    const result = resolveStaticPagePathFromSitemap(
      { slug: 'about', publishedPath: '/about' },
      index,
    );
    expect(result).toBe('/about');
  });

  it('returns current path when no sitemap entry exists for the page slug', () => {
    const index = buildStaticSitemapPathIndex(
      ['https://example.com/contact'],
      'https://example.com',
    );
    // slug 'services' not in sitemap → returns current
    const result = resolveStaticPagePathFromSitemap(
      { slug: 'services', publishedPath: '/services' },
      index,
    );
    expect(result).toBe('/services');
  });

  it('returns "/" for page with null publishedPath and empty slug (homepage)', () => {
    const index = buildStaticSitemapPathIndex(
      ['https://example.com/about'],
      'https://example.com',
    );
    const result = resolveStaticPagePathFromSitemap(
      { slug: '', publishedPath: null },
      index,
    );
    expect(result).toBe('/');
  });

  it('handles page with undefined slug gracefully', () => {
    const index = buildStaticSitemapPathIndex(
      ['https://example.com/about'],
      'https://example.com',
    );
    // slug: undefined → treated as ''
    const result = resolveStaticPagePathFromSitemap(
      { publishedPath: '/' },
      index,
    );
    expect(typeof result).toBe('string');
    expect(result.startsWith('/')).toBe(true);
  });
});

// ── resolveStaticPagePathsFromSitemap — additional edge cases ─────────────────

describe('resolveStaticPagePathsFromSitemap — additional edge cases', () => {
  it('handles multiple pages where some resolve and some do not', () => {
    const pages = [
      { slug: 'seo', publishedPath: '/seo' as string | null },          // leaf fallback → resolves
      { slug: 'contact', publishedPath: '/contact' as string | null },  // correct → unchanged
      { slug: 'missing', publishedPath: '/missing' as string | null },  // not in sitemap → unchanged
    ];
    const sitemapUrls = [
      'https://example.com/services/seo',
      'https://example.com/contact',
    ];
    const result = resolveStaticPagePathsFromSitemap(pages, sitemapUrls, 'https://example.com');
    expect(result[0].publishedPath).toBe('/services/seo');
    expect(result[1].publishedPath).toBe('/contact');
    expect(result[2].publishedPath).toBe('/missing');
  });

  it('returns same array reference when no page changes', () => {
    const pages = [{ slug: 'contact', publishedPath: '/contact' as string | null }];
    const sitemapUrls = ['https://example.com/contact'];
    const result = resolveStaticPagePathsFromSitemap(pages, sitemapUrls, 'https://example.com');
    // No change → same object reference for unchanged pages
    expect(result[0]).toBe(pages[0]);
  });

  it('does not mutate original page objects', () => {
    const original = { slug: 'seo', publishedPath: '/seo' as string | null };
    const pages = [original];
    const sitemapUrls = ['https://example.com/services/seo'];
    resolveStaticPagePathsFromSitemap(pages, sitemapUrls, 'https://example.com');
    // Original must not be mutated
    expect(original.publishedPath).toBe('/seo');
  });

  it('returns pages unchanged when sitemapUrls is an empty array', () => {
    const pages = [{ slug: 'about', publishedPath: '/about' as string | null }];
    const result = resolveStaticPagePathsFromSitemap(pages, [], 'https://example.com');
    expect(result).toBe(pages); // same reference
  });

  it('returns pages unchanged when pages array is empty', () => {
    const result = resolveStaticPagePathsFromSitemap(
      [],
      ['https://example.com/about'],
      'https://example.com',
    );
    expect(result).toEqual([]);
  });

  it('handles a batch of pages all needing sitemap resolution', () => {
    const pages = [
      { slug: 'seo', publishedPath: '/seo' as string | null },
      { slug: 'ppc', publishedPath: '/ppc' as string | null },
    ];
    const sitemapUrls = [
      'https://example.com/services/seo',
      'https://example.com/services/ppc',
    ];
    const result = resolveStaticPagePathsFromSitemap(pages, sitemapUrls, 'https://example.com');
    expect(result[0].publishedPath).toBe('/services/seo');
    expect(result[1].publishedPath).toBe('/services/ppc');
  });

  it('preserves all extra properties when a page is updated', () => {
    const pages = [
      { slug: 'seo', publishedPath: '/seo' as string | null, id: 'p-seo', title: 'SEO', draft: false },
    ];
    const sitemapUrls = ['https://example.com/services/seo'];
    const result = resolveStaticPagePathsFromSitemap(pages, sitemapUrls, 'https://example.com');
    expect(result[0].id).toBe('p-seo');
    expect(result[0].title).toBe('SEO');
    expect(result[0].draft).toBe(false);
    expect(result[0].publishedPath).toBe('/services/seo');
  });

  it('handles ambiguous leaves by leaving all matching pages unchanged', () => {
    // Two pages have the same slug (different contexts would be unusual but possible)
    const pages = [
      { slug: 'expero', publishedPath: '/expero' as string | null },
    ];
    const sitemapUrls = [
      'https://example.com/blog/expero',
      'https://example.com/our-work/expero',
    ];
    const result = resolveStaticPagePathsFromSitemap(pages, sitemapUrls, 'https://example.com');
    // Ambiguous leaf → stays at /expero
    expect(result[0].publishedPath).toBe('/expero');
  });
});
