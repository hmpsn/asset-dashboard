import { describe, it, expect } from 'vitest';
import {
  matchPagePath,
  normalizePageUrl,
  matchPageIdentity,
  findPageMapEntry,
  findPageMapEntryByIdentity,
  resolvePageAddress,
  resolvePagePath,
  findPageMapEntryForPage,
  findPageMapEntryBySlug,
  tryResolvePagePath,
} from '../../src/lib/pathUtils.js';
const normalizePath = normalizePageUrl;

// ── normalizePath ─────────────────────────────────────────────────────────────

describe('normalizePath', () => {
  it('adds leading slash when missing', () => {
    expect(normalizePath('about')).toBe('/about');
  });

  it('preserves leading slash', () => {
    expect(normalizePath('/about')).toBe('/about');
  });

  it('strips trailing slash', () => {
    expect(normalizePath('/about/')).toBe('/about');
  });

  it('keeps root "/" as-is', () => {
    expect(normalizePath('/')).toBe('/');
  });

  it('handles empty string → "/"', () => {
    expect(normalizePath('')).toBe('/');
  });

  it('handles double trailing slash', () => {
    expect(normalizePath('/services//')).toBe('/services/');
    // only the last char is stripped
  });

  it('handles nested path with trailing slash', () => {
    expect(normalizePath('/services/seo/')).toBe('/services/seo');
  });

  it('handles bare slug without slashes', () => {
    expect(normalizePath('seo')).toBe('/seo');
  });
});

// ── matchPagePath ─────────────────────────────────────────────────────────────

describe('matchPagePath', () => {
  it('matches identical paths', () => {
    expect(matchPagePath('/about', '/about')).toBe(true);
  });

  it('matches with/without trailing slash', () => {
    expect(matchPagePath('/about/', '/about')).toBe(true);
    expect(matchPagePath('/about', '/about/')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(matchPagePath('/About', '/about')).toBe(true);
    expect(matchPagePath('/SERVICES/SEO', '/services/seo')).toBe(true);
  });

  it('returns false for different paths', () => {
    expect(matchPagePath('/about', '/contact')).toBe(false);
  });

  it('matches root paths', () => {
    expect(matchPagePath('/', '/')).toBe(true);
  });
});

// ── normalizePageUrl ──────────────────────────────────────────────────────────

describe('normalizePageUrl', () => {
  it('strips origin from full URL', () => {
    expect(normalizePageUrl('https://example.com/about')).toBe('/about');
  });

  it('strips origin and trailing slash from full URL', () => {
    expect(normalizePageUrl('https://example.com/about/')).toBe('/about');
  });

  it('handles root URL', () => {
    expect(normalizePageUrl('https://example.com/')).toBe('/');
  });

  it('strips query string from full URL', () => {
    expect(normalizePageUrl('https://example.com/about?ref=nav')).toBe('/about');
  });

  it('strips fragment from full URL', () => {
    expect(normalizePageUrl('https://example.com/about#section')).toBe('/about');
  });

  it('passes through bare path unchanged', () => {
    expect(normalizePageUrl('/services/seo')).toBe('/services/seo');
  });

  it('adds leading slash to bare slug', () => {
    expect(normalizePageUrl('seo')).toBe('/seo');
  });

  it('handles malformed URL gracefully (falls back to path normalization)', () => {
    expect(normalizePageUrl('not-a-url')).toBe('/not-a-url');
  });
});

// ── matchPageIdentity ─────────────────────────────────────────────────────────

describe('matchPageIdentity', () => {
  it('matches full URL against path', () => {
    expect(matchPageIdentity('https://example.com/about', '/about')).toBe(true);
  });

  it('matches two full URLs', () => {
    expect(matchPageIdentity('https://example.com/about', 'https://other.com/about')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(matchPageIdentity('https://example.com/About', '/about')).toBe(true);
  });

  it('returns false for different paths', () => {
    expect(matchPageIdentity('https://example.com/about', '/contact')).toBe(false);
  });
});

// ── findPageMapEntry ──────────────────────────────────────────────────────────

describe('findPageMapEntry', () => {
  const pageMap = [
    { pagePath: '/about', title: 'About' },
    { pagePath: '/services/seo', title: 'SEO' },
    { pagePath: '/', title: 'Home' },
  ];

  it('finds exact match', () => {
    expect(findPageMapEntry(pageMap, '/about')).toEqual({ pagePath: '/about', title: 'About' });
  });

  it('finds with trailing slash normalization', () => {
    expect(findPageMapEntry(pageMap, '/about/')).toEqual({ pagePath: '/about', title: 'About' });
  });

  it('finds case-insensitively', () => {
    expect(findPageMapEntry(pageMap, '/ABOUT')).toEqual({ pagePath: '/about', title: 'About' });
  });

  it('returns undefined for missing path', () => {
    expect(findPageMapEntry(pageMap, '/missing')).toBeUndefined();
  });

  it('finds root entry', () => {
    expect(findPageMapEntry(pageMap, '/')).toEqual({ pagePath: '/', title: 'Home' });
  });

  it('returns undefined for empty pageMap', () => {
    expect(findPageMapEntry([], '/about')).toBeUndefined();
  });
});

// ── findPageMapEntryByIdentity ────────────────────────────────────────────────

describe('findPageMapEntryByIdentity', () => {
  const pageMap = [{ pagePath: '/about' }, { pagePath: '/services/seo' }];

  it('finds by full URL', () => {
    expect(findPageMapEntryByIdentity(pageMap, 'https://example.com/about')).toEqual({ pagePath: '/about' });
  });

  it('finds by bare slug', () => {
    expect(findPageMapEntryByIdentity(pageMap, 'about')).toEqual({ pagePath: '/about' });
  });

  it('returns undefined when not found', () => {
    expect(findPageMapEntryByIdentity(pageMap, '/contact')).toBeUndefined();
  });
});

// ── resolvePageAddress ────────────────────────────────────────────────────────

describe('resolvePageAddress', () => {
  it('uses publishedPath as highest priority', () => {
    const result = resolvePageAddress({ publishedPath: '/pub', path: '/path', slug: 'slug' });
    expect(result.canonicalPath).toBe('/pub');
    expect(result.source).toBe('publishedPath');
  });

  it('falls back to path when publishedPath is null', () => {
    const result = resolvePageAddress({ publishedPath: null, path: '/path', slug: 'slug' });
    expect(result.canonicalPath).toBe('/path');
    expect(result.source).toBe('path');
  });

  it('falls back to url when path is null', () => {
    const result = resolvePageAddress({ publishedPath: null, path: null, url: 'https://example.com/page', slug: 'slug' });
    expect(result.canonicalPath).toBe('/page');
    expect(result.source).toBe('url');
  });

  it('falls back to slug when others are null', () => {
    const result = resolvePageAddress({ publishedPath: null, path: null, url: null, slug: 'mypage' });
    expect(result.canonicalPath).toBe('/mypage');
    expect(result.source).toBe('slug');
  });

  it('returns "/" with fallback source when all fields are null/undefined', () => {
    const result = resolvePageAddress({});
    expect(result.canonicalPath).toBe('/');
    expect(result.source).toBe('fallback');
  });

  it('sets canonicalUrl when baseUrl is provided', () => {
    const result = resolvePageAddress({ publishedPath: '/about' }, { baseUrl: 'https://example.com' });
    expect(result.canonicalUrl).toBe('https://example.com/about');
  });

  it('sets canonicalUrl to bare domain for root path', () => {
    const result = resolvePageAddress({ publishedPath: '/' }, { baseUrl: 'https://example.com' });
    expect(result.canonicalUrl).toBe('https://example.com');
  });

  it('handles baseUrl without protocol', () => {
    const result = resolvePageAddress({ publishedPath: '/about' }, { baseUrl: 'example.com' });
    expect(result.canonicalUrl).toBe('https://example.com/about');
  });

  it('strips trailing slash from baseUrl', () => {
    const result = resolvePageAddress({ publishedPath: '/about' }, { baseUrl: 'https://example.com/' });
    expect(result.canonicalUrl).toBe('https://example.com/about');
  });

  it('does not set legacyFallbackPath when publishedPath equals slug path', () => {
    const result = resolvePageAddress({ publishedPath: '/seo', slug: 'seo' });
    expect(result.legacyFallbackPath).toBeUndefined();
  });

  it('sets legacyFallbackPath when publishedPath differs from slug path', () => {
    const result = resolvePageAddress({ publishedPath: '/services/seo', slug: 'seo' });
    expect(result.legacyFallbackPath).toBe('/seo');
  });

  it('preserves rawSlug', () => {
    const result = resolvePageAddress({ slug: 'mypage' });
    expect(result.rawSlug).toBe('mypage');
  });

  it('rawSlug is null when no slug provided', () => {
    const result = resolvePageAddress({ publishedPath: '/about' });
    expect(result.rawSlug).toBeNull();
  });
});

// ── resolvePagePath ───────────────────────────────────────────────────────────

describe('resolvePagePath', () => {
  it('returns the canonical path', () => {
    expect(resolvePagePath({ publishedPath: '/about' })).toBe('/about');
  });

  it('returns "/" for empty input', () => {
    expect(resolvePagePath({})).toBe('/');
  });
});

// ── findPageMapEntryForPage ───────────────────────────────────────────────────

describe('findPageMapEntryForPage', () => {
  const pageMap = [
    { pagePath: '/services/seo' },
    { pagePath: '/seo' },
    { pagePath: '/' },
  ];

  it('finds by publishedPath', () => {
    expect(findPageMapEntryForPage(pageMap, { publishedPath: '/services/seo', slug: 'seo' }))
      .toEqual({ pagePath: '/services/seo' });
  });

  it('falls back to /{slug} as legacy path', () => {
    const map = [{ pagePath: '/seo' }];
    expect(findPageMapEntryForPage(map, { publishedPath: '/services/seo', slug: 'seo' }))
      .toEqual({ pagePath: '/seo' });
  });

  it('returns undefined when no match found', () => {
    expect(findPageMapEntryForPage(pageMap, { publishedPath: '/unknown', slug: 'unknown' }))
      .toBeUndefined();
  });
});

// ── findPageMapEntryBySlug ────────────────────────────────────────────────────

describe('findPageMapEntryBySlug', () => {
  const pageMap = [
    { pagePath: '/services/seo' },
    { pagePath: '/about' },
    { pagePath: '/' },
  ];

  it('finds top-level slug via exact /{slug} match', () => {
    expect(findPageMapEntryBySlug(pageMap, 'about')).toEqual({ pagePath: '/about' });
  });

  it('finds nested slug via suffix match', () => {
    expect(findPageMapEntryBySlug(pageMap, 'seo')).toEqual({ pagePath: '/services/seo' });
  });

  it('is case-insensitive on slug', () => {
    expect(findPageMapEntryBySlug(pageMap, 'SEO')).toEqual({ pagePath: '/services/seo' });
  });

  it('returns undefined when slug not found', () => {
    expect(findPageMapEntryBySlug(pageMap, 'contact')).toBeUndefined();
  });
});

// ── tryResolvePagePath ────────────────────────────────────────────────────────

describe('tryResolvePagePath', () => {
  it('returns undefined when all fields are undefined/null', () => {
    expect(tryResolvePagePath({})).toBeUndefined();
    expect(tryResolvePagePath({ publishedPath: null, path: null, url: null, slug: null })).toBeUndefined();
  });

  it('returns "/" for empty-string slug (homepage)', () => {
    expect(tryResolvePagePath({ slug: '' })).toBe('/');
  });

  it('returns path for publishedPath', () => {
    expect(tryResolvePagePath({ publishedPath: '/about' })).toBe('/about');
  });

  it('returns path for slug', () => {
    expect(tryResolvePagePath({ slug: 'contact' })).toBe('/contact');
  });

  it('returns path for url', () => {
    expect(tryResolvePagePath({ url: 'https://example.com/about' })).toBe('/about');
  });

  it('returns path for path field', () => {
    expect(tryResolvePagePath({ path: '/services' })).toBe('/services');
  });
});
