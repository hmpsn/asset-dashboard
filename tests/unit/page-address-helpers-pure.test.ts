/**
 * Pure unit tests for page-address utility functions.
 *
 * Targets src/lib/pathUtils.ts — the frontend mirror of server/helpers.ts path functions.
 * All functions here are pure/sync with no DB or external dependencies.
 *
 * Covers:
 *  - resolvePageAddress() with all field priorities and edge cases
 *  - resolvePagePath() convenience wrapper
 *  - tryResolvePagePath() with missing data (returns undefined when no info)
 *  - findPageMapEntry() matching/non-matching with normalization
 *  - findPageMapEntryForPage() with publishedPath vs legacy slug fallback
 *  - findPageMapEntryBySlug() exact and suffix matching
 *  - findPageMapEntryByIdentity() via URL or path identity
 *  - normalizePath() edge cases
 *  - matchPagePath() case-insensitive comparison
 *  - matchPageIdentity() for full URL vs path matching
 */

import { describe, it, expect } from 'vitest';
import {
  normalizePageUrl,
  matchPagePath,
  matchPageIdentity,
  findPageMapEntry,
  findPageMapEntryByIdentity,
  findPageMapEntryForPage,
  findPageMapEntryBySlug,
  resolvePageAddress,
  resolvePagePath,
  tryResolvePagePath,
} from '../../src/lib/pathUtils.js';
const normalizePath = normalizePageUrl;

// ── normalizePath ──────────────────────────────────────────────────────────

describe('normalizePath', () => {
  it('adds leading slash when missing', () => {
    expect(normalizePath('about')).toBe('/about');
  });

  it('keeps existing leading slash', () => {
    expect(normalizePath('/about')).toBe('/about');
  });

  it('strips trailing slash from non-root paths', () => {
    expect(normalizePath('/about/')).toBe('/about');
  });

  it('preserves root path "/" as-is', () => {
    expect(normalizePath('/')).toBe('/');
  });

  it('empty string normalizes to root slash', () => {
    expect(normalizePath('')).toBe('/');
  });

  it('handles deeply nested paths', () => {
    expect(normalizePath('services/seo/local')).toBe('/services/seo/local');
  });

  it('strips trailing slash from nested path with leading slash', () => {
    expect(normalizePath('/services/seo/')).toBe('/services/seo');
  });

  it('does not double-add leading slash', () => {
    expect(normalizePath('/already-has-slash')).toBe('/already-has-slash');
  });
});

// ── matchPagePath ──────────────────────────────────────────────────────────

describe('matchPagePath', () => {
  it('matches identical paths', () => {
    expect(matchPagePath('/blog', '/blog')).toBe(true);
  });

  it('trailing slash difference is ignored', () => {
    expect(matchPagePath('/blog/', '/blog')).toBe(true);
    expect(matchPagePath('/blog', '/blog/')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(matchPagePath('/BLOG', '/blog')).toBe(true);
    expect(matchPagePath('/Services/SEO', '/services/seo')).toBe(true);
  });

  it('does not match different paths', () => {
    expect(matchPagePath('/blog', '/contact')).toBe(false);
  });

  it('root paths match each other', () => {
    expect(matchPagePath('/', '/')).toBe(true);
  });

  it('normalizes missing leading slash', () => {
    expect(matchPagePath('blog', '/blog')).toBe(true);
  });

  it('does not match partial paths', () => {
    expect(matchPagePath('/seo', '/services/seo')).toBe(false);
  });
});

// ── normalizePageUrl ───────────────────────────────────────────────────────

describe('normalizePageUrl', () => {
  it('extracts pathname from full URL', () => {
    expect(normalizePageUrl('https://example.com/services/seo')).toBe('/services/seo');
  });

  it('passes through a path that is not a URL', () => {
    expect(normalizePageUrl('/about')).toBe('/about');
  });

  it('handles URL with query and hash (pathname only)', () => {
    expect(normalizePageUrl('https://example.com/blog?q=seo#section')).toBe('/blog');
  });

  it('handles root URL', () => {
    expect(normalizePageUrl('https://example.com/')).toBe('/');
  });

  it('handles bare slug as path', () => {
    expect(normalizePageUrl('about')).toBe('/about');
  });
});

// ── matchPageIdentity ──────────────────────────────────────────────────────

describe('matchPageIdentity', () => {
  it('matches a full URL against a path', () => {
    expect(matchPageIdentity('https://example.com/about', '/about')).toBe(true);
  });

  it('matches two paths directly', () => {
    expect(matchPageIdentity('/services/seo', '/services/seo')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(matchPageIdentity('https://example.com/ABOUT', '/about')).toBe(true);
  });

  it('does not match different paths', () => {
    expect(matchPageIdentity('/blog', '/services')).toBe(false);
  });
});

// ── findPageMapEntry ───────────────────────────────────────────────────────

describe('findPageMapEntry', () => {
  const pageMap = [
    { pagePath: '/about', title: 'About' },
    { pagePath: '/services/seo', title: 'SEO' },
    { pagePath: '/', title: 'Home' },
  ];

  it('finds entry by exact path', () => {
    expect(findPageMapEntry(pageMap, '/about')?.title).toBe('About');
  });

  it('returns undefined when not found', () => {
    expect(findPageMapEntry(pageMap, '/contact')).toBeUndefined();
  });

  it('is case-insensitive', () => {
    expect(findPageMapEntry(pageMap, '/ABOUT')?.title).toBe('About');
  });

  it('normalizes trailing slash on query', () => {
    expect(findPageMapEntry(pageMap, '/about/')?.title).toBe('About');
  });

  it('normalizes trailing slash on entry', () => {
    const mapWithTrailing = [{ pagePath: '/about/', title: 'About Trailing' }];
    expect(findPageMapEntry(mapWithTrailing, '/about')?.title).toBe('About Trailing');
  });

  it('returns undefined for empty pageMap', () => {
    expect(findPageMapEntry([], '/about')).toBeUndefined();
  });

  it('finds root path entry', () => {
    expect(findPageMapEntry(pageMap, '/')?.title).toBe('Home');
  });

  it('handles nested paths correctly', () => {
    expect(findPageMapEntry(pageMap, '/services/seo')?.title).toBe('SEO');
  });

  it('does not match partial paths (seo vs services/seo)', () => {
    expect(findPageMapEntry(pageMap, '/seo')).toBeUndefined();
  });

  it('finds first match when multiple entries normalize to same path', () => {
    const dupMap = [
      { pagePath: '/dup', title: 'First' },
      { pagePath: '/dup/', title: 'Second' },
    ];
    expect(findPageMapEntry(dupMap, '/dup')?.title).toBe('First');
  });
});

// ── findPageMapEntryByIdentity ─────────────────────────────────────────────

describe('findPageMapEntryByIdentity', () => {
  const pageMap = [
    { pagePath: '/services/seo', data: 'seo' },
    { pagePath: '/about', data: 'about' },
  ];

  it('finds entry by full URL (extracts pathname)', () => {
    expect(findPageMapEntryByIdentity(pageMap, 'https://example.com/services/seo')?.data).toBe('seo');
  });

  it('finds entry by bare path', () => {
    expect(findPageMapEntryByIdentity(pageMap, '/about')?.data).toBe('about');
  });

  it('returns undefined for no match', () => {
    expect(findPageMapEntryByIdentity(pageMap, '/contact')).toBeUndefined();
  });

  it('is case-insensitive on URL pathname', () => {
    expect(findPageMapEntryByIdentity(pageMap, 'https://example.com/ABOUT')?.data).toBe('about');
  });
});

// ── findPageMapEntryForPage ────────────────────────────────────────────────

describe('findPageMapEntryForPage', () => {
  it('finds entry via publishedPath (primary match)', () => {
    const pageMap = [{ pagePath: '/services/seo', data: 'seo-page' }];
    const page = { publishedPath: '/services/seo', slug: 'seo' };
    expect(findPageMapEntryForPage(pageMap, page)?.data).toBe('seo-page');
  });

  it('falls back to /${slug} when publishedPath does not match', () => {
    const pageMap = [{ pagePath: '/seo', data: 'legacy' }];
    const page = { publishedPath: '/services/seo', slug: 'seo' };
    expect(findPageMapEntryForPage(pageMap, page)?.data).toBe('legacy');
  });

  it('returns undefined when neither primary nor fallback match', () => {
    const pageMap = [{ pagePath: '/other', data: 'other' }];
    const page = { publishedPath: '/services/seo', slug: 'seo' };
    expect(findPageMapEntryForPage(pageMap, page)).toBeUndefined();
  });

  it('works with only publishedPath (no slug)', () => {
    const pageMap = [{ pagePath: '/about', data: 'about' }];
    const page = { publishedPath: '/about' };
    expect(findPageMapEntryForPage(pageMap, page)?.data).toBe('about');
  });

  it('returns undefined for empty pageMap', () => {
    const page = { publishedPath: '/about', slug: 'about' };
    expect(findPageMapEntryForPage([], page)).toBeUndefined();
  });

  it('does NOT generate legacyFallbackPath when publishedPath equals /${slug}', () => {
    const pageMap = [{ pagePath: '/seo', data: 'seo' }];
    const page = { publishedPath: '/seo', slug: 'seo' };
    // Should still find via primary path — no legacy fallback generated
    expect(findPageMapEntryForPage(pageMap, page)?.data).toBe('seo');
  });
});

// ── findPageMapEntryBySlug ─────────────────────────────────────────────────

describe('findPageMapEntryBySlug', () => {
  const pageMap = [
    { pagePath: '/seo', data: 'top-level-seo' },
    { pagePath: '/services/seo', data: 'nested-seo' },
    { pagePath: '/about', data: 'about' },
  ];

  it('finds exact match for top-level slug', () => {
    expect(findPageMapEntryBySlug(pageMap, 'about')?.data).toBe('about');
  });

  it('finds top-level slug via exact match first (not suffix)', () => {
    // '/seo' exact match should win over '/services/seo' suffix match
    expect(findPageMapEntryBySlug(pageMap, 'seo')?.data).toBe('top-level-seo');
  });

  it('falls back to suffix match when no exact match', () => {
    // 'services/seo' has no exact match but '/services/seo' ends with '/services/seo'
    const narrowMap = [{ pagePath: '/services/seo', data: 'nested' }];
    expect(findPageMapEntryBySlug(narrowMap, 'seo')?.data).toBe('nested');
  });

  it('returns undefined when no match found', () => {
    expect(findPageMapEntryBySlug(pageMap, 'contact')).toBeUndefined();
  });

  it('is case-insensitive for suffix match', () => {
    const narrowMap = [{ pagePath: '/services/SEO', data: 'nested-seo' }];
    expect(findPageMapEntryBySlug(narrowMap, 'seo')?.data).toBe('nested-seo');
  });
});

// ── resolvePageAddress ─────────────────────────────────────────────────────

describe('resolvePageAddress', () => {
  it('returns fallback "/" when all fields are absent', () => {
    const addr = resolvePageAddress({});
    expect(addr.canonicalPath).toBe('/');
    expect(addr.source).toBe('fallback');
  });

  it('returns fallback "/" when all fields are null', () => {
    const addr = resolvePageAddress({ publishedPath: null, path: null, url: null, slug: null });
    expect(addr.canonicalPath).toBe('/');
    expect(addr.source).toBe('fallback');
  });

  it('uses publishedPath first (highest priority)', () => {
    const addr = resolvePageAddress({
      publishedPath: '/published',
      path: '/path',
      url: 'https://example.com/url',
      slug: 'slug',
    });
    expect(addr.canonicalPath).toBe('/published');
    expect(addr.source).toBe('publishedPath');
  });

  it('uses path when publishedPath is absent', () => {
    const addr = resolvePageAddress({ path: '/path-value', slug: 'slug' });
    expect(addr.canonicalPath).toBe('/path-value');
    expect(addr.source).toBe('path');
  });

  it('uses url when publishedPath and path are absent', () => {
    const addr = resolvePageAddress({ url: 'https://example.com/url-page', slug: 'slug' });
    expect(addr.canonicalPath).toBe('/url-page');
    expect(addr.source).toBe('url');
  });

  it('uses slug as last resort', () => {
    const addr = resolvePageAddress({ slug: 'about' });
    expect(addr.canonicalPath).toBe('/about');
    expect(addr.source).toBe('slug');
  });

  it('handles homepage slug (empty string) correctly', () => {
    const addr = resolvePageAddress({ slug: '' });
    expect(addr.canonicalPath).toBe('/');
    expect(addr.source).toBe('slug');
  });

  it('extracts pathname from full URL in publishedPath', () => {
    const addr = resolvePageAddress({ publishedPath: 'https://example.com/services/seo' });
    expect(addr.canonicalPath).toBe('/services/seo');
  });

  it('extracts pathname from full URL in url field', () => {
    const addr = resolvePageAddress({ url: 'https://example.com/blog?q=1#top' });
    expect(addr.canonicalPath).toBe('/blog');
    expect(addr.source).toBe('url');
  });

  it('sets canonicalUrl when baseUrl is provided', () => {
    const addr = resolvePageAddress({ slug: 'about' }, { baseUrl: 'https://example.com' });
    expect(addr.canonicalUrl).toBe('https://example.com/about');
  });

  it('sets canonicalUrl for root path without double slash', () => {
    const addr = resolvePageAddress({ slug: '' }, { baseUrl: 'https://example.com' });
    expect(addr.canonicalUrl).toBe('https://example.com');
  });

  it('does not set canonicalUrl when baseUrl is absent', () => {
    const addr = resolvePageAddress({ slug: 'about' });
    expect(addr.canonicalUrl).toBeUndefined();
  });

  it('sets legacyFallbackPath when publishedPath differs from /${slug}', () => {
    const addr = resolvePageAddress({ publishedPath: '/services/seo', slug: 'seo' });
    expect(addr.legacyFallbackPath).toBe('/seo');
  });

  it('does NOT set legacyFallbackPath when publishedPath equals /${slug}', () => {
    const addr = resolvePageAddress({ publishedPath: '/seo', slug: 'seo' });
    expect(addr.legacyFallbackPath).toBeUndefined();
  });

  it('does NOT set legacyFallbackPath when includeLegacyFallback is false', () => {
    const addr = resolvePageAddress(
      { publishedPath: '/services/seo', slug: 'seo' },
      { includeLegacyFallback: false },
    );
    expect(addr.legacyFallbackPath).toBeUndefined();
  });

  it('does NOT set legacyFallbackPath when slug is null', () => {
    const addr = resolvePageAddress({ publishedPath: '/services/seo', slug: null });
    expect(addr.legacyFallbackPath).toBeUndefined();
  });

  it('rawSlug reflects the original slug field', () => {
    const addr = resolvePageAddress({ publishedPath: '/services/seo', slug: 'seo' });
    expect(addr.rawSlug).toBe('seo');
  });

  it('rawSlug is null when slug is not provided', () => {
    const addr = resolvePageAddress({ publishedPath: '/about' });
    expect(addr.rawSlug).toBeNull();
  });

  it('normalizes trailing slash in publishedPath', () => {
    const addr = resolvePageAddress({ publishedPath: '/about/' });
    expect(addr.canonicalPath).toBe('/about');
  });

  it('adds leading slash to slug that is missing it', () => {
    const addr = resolvePageAddress({ slug: 'services/seo' });
    expect(addr.canonicalPath).toBe('/services/seo');
  });
});

// ── resolvePagePath ────────────────────────────────────────────────────────

describe('resolvePagePath', () => {
  it('returns the canonical path string', () => {
    expect(resolvePagePath({ slug: 'about' })).toBe('/about');
  });

  it('returns "/" for a page with no info', () => {
    expect(resolvePagePath({})).toBe('/');
  });

  it('uses publishedPath over slug', () => {
    expect(resolvePagePath({ publishedPath: '/services/seo', slug: 'seo' })).toBe('/services/seo');
  });

  it('handles homepage empty slug', () => {
    expect(resolvePagePath({ slug: '' })).toBe('/');
  });
});

// ── tryResolvePagePath ─────────────────────────────────────────────────────

describe('tryResolvePagePath', () => {
  it('returns undefined when all fields are null/undefined', () => {
    expect(tryResolvePagePath({})).toBeUndefined();
    expect(tryResolvePagePath({ slug: null, publishedPath: null, path: null, url: null })).toBeUndefined();
  });

  it('returns "/" for a homepage with empty-string slug', () => {
    // slug: '' is different from slug: undefined — empty string means homepage
    expect(tryResolvePagePath({ slug: '' })).toBe('/');
  });

  it('returns path when slug is present', () => {
    expect(tryResolvePagePath({ slug: 'about' })).toBe('/about');
  });

  it('returns path when only publishedPath is set', () => {
    expect(tryResolvePagePath({ publishedPath: '/services/seo' })).toBe('/services/seo');
  });

  it('returns path when only url is set', () => {
    expect(tryResolvePagePath({ url: 'https://example.com/blog' })).toBe('/blog');
  });

  it('returns path when only path field is set', () => {
    expect(tryResolvePagePath({ path: '/contact' })).toBe('/contact');
  });

  it('distinguishes undefined from null for slug', () => {
    // null slug → no meaningful path info
    expect(tryResolvePagePath({ slug: null })).toBeUndefined();
    // empty string slug → homepage
    expect(tryResolvePagePath({ slug: '' })).toBe('/');
  });

  it('prioritizes publishedPath even when slug is also present', () => {
    expect(tryResolvePagePath({ publishedPath: '/services/seo', slug: 'seo' })).toBe('/services/seo');
  });
});
