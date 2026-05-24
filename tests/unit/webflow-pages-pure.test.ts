/**
 * Wave 20 — Pure function unit tests for server/webflow-pages.ts
 *
 * Covers exported pure functions (no DB, no HTTP, no filesystem):
 *   - filterPublishedPages: draft/archived/collectionId/homepage-slug filtering
 *   - toCmsPageId: path-to-CMS-id conversion
 *   - buildStaticPathSet: Set construction from WebflowPage array (via resolvePagePath)
 *   - buildStaticSitemapPathIndex: sitemap URL indexing, host filtering, leaf dedup
 *   - resolveStaticPagePathFromSitemap: per-page sitemap path resolution
 *   - resolveStaticPagePathsFromSitemap: batch page path resolution
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
    id: 'page-1',
    title: 'Test Page',
    slug: 'test',
    draft: false,
    archived: false,
    collectionId: null,
    publishedPath: '/test',
    ...overrides,
  };
}

// ── filterPublishedPages ──────────────────────────────────────────────────────

describe('filterPublishedPages', () => {
  it('includes a normal published page', () => {
    const pages = [makePage({ slug: 'about', publishedPath: '/about' })];
    expect(filterPublishedPages(pages)).toHaveLength(1);
  });

  it('excludes draft pages', () => {
    const pages = [makePage({ slug: 'about', publishedPath: '/about', draft: true })];
    expect(filterPublishedPages(pages)).toHaveLength(0);
  });

  it('excludes archived pages', () => {
    const pages = [makePage({ slug: 'about', publishedPath: '/about', archived: true })];
    expect(filterPublishedPages(pages)).toHaveLength(0);
  });

  it('excludes CMS collection pages (collectionId set)', () => {
    const pages = [makePage({ slug: 'post-1', publishedPath: '/blog/post-1', collectionId: 'col-abc' })];
    expect(filterPublishedPages(pages)).toHaveLength(0);
  });

  it('includes homepage with empty slug and no publishedPath', () => {
    // Webflow homepages may have publishedPath: null but slug: ''
    const pages = [makePage({ slug: '', publishedPath: null })];
    expect(filterPublishedPages(pages)).toHaveLength(1);
  });

  it('includes homepage with slug "index"', () => {
    const pages = [makePage({ slug: 'index', publishedPath: null })];
    expect(filterPublishedPages(pages)).toHaveLength(1);
  });

  it('includes homepage with slug "home"', () => {
    const pages = [makePage({ slug: 'home', publishedPath: null })];
    expect(filterPublishedPages(pages)).toHaveLength(1);
  });

  it('excludes page with no publishedPath and non-homepage slug', () => {
    const pages = [makePage({ slug: 'services', publishedPath: null })];
    expect(filterPublishedPages(pages)).toHaveLength(0);
  });

  it('filters mixed array correctly', () => {
    const pages = [
      makePage({ slug: 'about', publishedPath: '/about' }),
      makePage({ slug: 'draft-post', publishedPath: '/draft-post', draft: true }),
      makePage({ id: 'p3', slug: 'archived', publishedPath: '/archived', archived: true }),
      makePage({ id: 'p4', slug: 'cms-item', publishedPath: '/blog/item', collectionId: 'col-1' }),
      makePage({ id: 'p5', slug: '', publishedPath: null }), // homepage
    ];
    const result = filterPublishedPages(pages);
    expect(result).toHaveLength(2);
    expect(result.map(p => p.slug)).toEqual(['about', '']);
  });

  it('returns empty array for empty input', () => {
    expect(filterPublishedPages([])).toEqual([]);
  });
});

// ── toCmsPageId ───────────────────────────────────────────────────────────────

describe('toCmsPageId', () => {
  it('converts a simple path to a CMS page ID', () => {
    expect(toCmsPageId('/blog/my-post')).toBe('cms-blog-my-post');
  });

  it('strips the leading slash', () => {
    expect(toCmsPageId('/about')).toBe('cms-about');
  });

  it('handles a root path', () => {
    expect(toCmsPageId('/')).toBe('cms-');
  });

  it('handles a path without leading slash', () => {
    expect(toCmsPageId('blog/post')).toBe('cms-blog-post');
  });

  it('handles nested paths with multiple segments', () => {
    expect(toCmsPageId('/products/category/item')).toBe('cms-products-category-item');
  });

  it('handles a path that is already slug-like', () => {
    expect(toCmsPageId('/my-page')).toBe('cms-my-page');
  });

  it('preserves hyphens in slugs', () => {
    expect(toCmsPageId('/case-studies/client-name')).toBe('cms-case-studies-client-name');
  });
});

// ── buildStaticPathSet ────────────────────────────────────────────────────────

describe('buildStaticPathSet', () => {
  it('always includes root path', () => {
    const result = buildStaticPathSet([]);
    expect(result.has('')).toBe(true);
  });

  it('includes paths derived from publishedPath', () => {
    const pages = [makePage({ slug: 'about', publishedPath: '/about' })];
    const result = buildStaticPathSet(pages);
    expect(result.has('/about')).toBe(true);
  });

  it('includes lowercase versions of paths', () => {
    const pages = [makePage({ slug: 'about', publishedPath: '/About' })];
    const result = buildStaticPathSet(pages);
    expect(result.has('/about')).toBe(true);
  });

  it('builds set from multiple pages', () => {
    const pages = [
      makePage({ slug: 'about', publishedPath: '/about' }),
      makePage({ id: 'p2', slug: 'contact', publishedPath: '/contact' }),
      makePage({ id: 'p3', slug: 'services', publishedPath: '/services' }),
    ];
    const result = buildStaticPathSet(pages);
    expect(result.has('/about')).toBe(true);
    expect(result.has('/contact')).toBe(true);
    expect(result.has('/services')).toBe(true);
  });

  it('uses slug as fallback when publishedPath is null', () => {
    const pages = [makePage({ slug: 'blog', publishedPath: null })];
    const result = buildStaticPathSet(pages);
    expect(result.has('/blog')).toBe(true);
  });
});

// ── buildStaticSitemapPathIndex ───────────────────────────────────────────────

describe('buildStaticSitemapPathIndex', () => {
  const baseUrl = 'https://example.com';

  it('returns empty sets for empty input', () => {
    const result = buildStaticSitemapPathIndex([], baseUrl);
    expect(result.pathSet.size).toBe(0);
    expect(result.uniqueLeafPaths.size).toBe(0);
  });

  it('indexes a simple URL', () => {
    const result = buildStaticSitemapPathIndex(
      ['https://example.com/about'],
      baseUrl,
    );
    expect(result.pathSet.has('/about')).toBe(true);
  });

  it('normalizes paths to lowercase', () => {
    const result = buildStaticSitemapPathIndex(
      ['https://example.com/About'],
      baseUrl,
    );
    expect(result.pathSet.has('/about')).toBe(true);
  });

  it('strips trailing slashes from indexed paths', () => {
    const result = buildStaticSitemapPathIndex(
      ['https://example.com/about/'],
      baseUrl,
    );
    expect(result.pathSet.has('/about')).toBe(true);
    expect(result.pathSet.has('/about/')).toBe(false);
  });

  it('maps unique leaf to its path', () => {
    const result = buildStaticSitemapPathIndex(
      ['https://example.com/blog/my-post'],
      baseUrl,
    );
    expect(result.uniqueLeafPaths.get('my-post')).toBe('/blog/my-post');
  });

  it('sets null for a leaf that appears in multiple paths (ambiguous)', () => {
    const result = buildStaticSitemapPathIndex(
      [
        'https://example.com/blog/expero',
        'https://example.com/our-work/expero',
      ],
      baseUrl,
    );
    expect(result.uniqueLeafPaths.get('expero')).toBeNull();
  });

  it('filters out URLs from other hosts', () => {
    const result = buildStaticSitemapPathIndex(
      ['https://other.com/about'],
      baseUrl,
    );
    expect(result.pathSet.has('/about')).toBe(false);
  });

  it('handles www vs non-www as same host', () => {
    const result = buildStaticSitemapPathIndex(
      ['https://www.example.com/about'],
      baseUrl,
    );
    expect(result.pathSet.has('/about')).toBe(true);
  });

  it('skips malformed sitemap URLs gracefully', () => {
    const result = buildStaticSitemapPathIndex(
      ['not-a-url', 'https://example.com/valid'],
      baseUrl,
    );
    expect(result.pathSet.has('/valid')).toBe(true);
    // Malformed entry doesn't crash
  });

  it('indexes the root path correctly', () => {
    const result = buildStaticSitemapPathIndex(
      ['https://example.com/'],
      baseUrl,
    );
    expect(result.pathSet.has('/')).toBe(true);
  });
});

// ── resolveStaticPagePathFromSitemap ──────────────────────────────────────────

describe('resolveStaticPagePathFromSitemap', () => {
  it('returns current path when page has no slug leaf', () => {
    const index = buildStaticSitemapPathIndex(
      ['https://example.com/services'],
      'https://example.com',
    );
    // Homepage slug '' → no leaf
    const result = resolveStaticPagePathFromSitemap({ slug: '', publishedPath: null }, index);
    expect(result).toBe('/');
  });

  it('returns sitemap path when current path is a leaf fallback', () => {
    // Page has /seo as publishedPath but sitemap has /services/seo
    const index = buildStaticSitemapPathIndex(
      ['https://example.com/services/seo'],
      'https://example.com',
    );
    const result = resolveStaticPagePathFromSitemap(
      { slug: 'seo', publishedPath: '/seo' },
      index,
    );
    // /seo === /seo (leaf fallback), so should resolve to sitemap path
    expect(result).toBe('/services/seo');
  });

  it('returns current path when it already exists in sitemap', () => {
    const index = buildStaticSitemapPathIndex(
      ['https://example.com/services/seo'],
      'https://example.com',
    );
    // Page already has the full nested path
    const result = resolveStaticPagePathFromSitemap(
      { slug: 'seo', publishedPath: '/services/seo' },
      index,
    );
    expect(result).toBe('/services/seo');
  });

  it('returns current path when sitemap leaf is ambiguous (null)', () => {
    const index = buildStaticSitemapPathIndex(
      [
        'https://example.com/blog/expero',
        'https://example.com/our-work/expero',
      ],
      'https://example.com',
    );
    const result = resolveStaticPagePathFromSitemap(
      { slug: 'expero', publishedPath: '/expero' },
      index,
    );
    // Ambiguous leaf — stays on current path
    expect(result).toBe('/expero');
  });

  it('ignores index/home slugs and returns current path', () => {
    const index = buildStaticSitemapPathIndex(
      ['https://example.com/index'],
      'https://example.com',
    );
    const result = resolveStaticPagePathFromSitemap(
      { slug: 'index', publishedPath: '/index' },
      index,
    );
    // 'index' slug is explicitly skipped
    expect(result).toBe('/index');
  });
});

// ── resolveStaticPagePathsFromSitemap ─────────────────────────────────────────

describe('resolveStaticPagePathsFromSitemap', () => {
  it('returns pages unchanged when pages array is empty', () => {
    const result = resolveStaticPagePathsFromSitemap([], ['https://example.com/about'], 'https://example.com');
    expect(result).toEqual([]);
  });

  it('returns pages unchanged when sitemap URLs array is empty', () => {
    const pages = [{ slug: 'about', publishedPath: '/about' as string | null }];
    const result = resolveStaticPagePathsFromSitemap(pages, [], 'https://example.com');
    expect(result).toBe(pages); // same reference when no sitemap
  });

  it('resolves page paths based on sitemap for a leaf fallback scenario', () => {
    const pages = [{ slug: 'seo', publishedPath: '/seo' as string | null }];
    const sitemapUrls = ['https://example.com/services/seo'];
    const result = resolveStaticPagePathsFromSitemap(pages, sitemapUrls, 'https://example.com');
    expect(result[0].publishedPath).toBe('/services/seo');
  });

  it('leaves pages with correct publishedPath unchanged', () => {
    const pages = [{ slug: 'contact', publishedPath: '/contact' as string | null }];
    const sitemapUrls = ['https://example.com/contact'];
    const result = resolveStaticPagePathsFromSitemap(pages, sitemapUrls, 'https://example.com');
    expect(result[0].publishedPath).toBe('/contact');
    expect(result[0]).toBe(pages[0]); // exact same object reference (no change)
  });

  it('preserves extra properties on page objects', () => {
    const pages = [{ slug: 'seo', publishedPath: '/seo' as string | null, title: 'SEO Services', id: 'p-1' }];
    const sitemapUrls = ['https://example.com/services/seo'];
    const result = resolveStaticPagePathsFromSitemap(pages, sitemapUrls, 'https://example.com');
    expect(result[0].title).toBe('SEO Services');
    expect(result[0].id).toBe('p-1');
    expect(result[0].publishedPath).toBe('/services/seo');
  });
});
