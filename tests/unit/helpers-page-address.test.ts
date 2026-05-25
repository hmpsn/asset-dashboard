/**
 * Unit tests for pure page-address utility functions in server/helpers.ts.
 * No DB, no async, no mocks required — these are all pure/sync functions.
 */
import { describe, it, expect } from 'vitest';
import {
  normalizePath,
  matchPagePath,
  findPageMapEntry,
  findPageMapEntryForPage,
  resolvePageAddress,
  matchGscUrlToPath,
  applyBulkKeywordGuards,
  stripCodeFences,
  toInsightPageId,
  toAuditFindingPageId,
} from '../../server/helpers.js';

// ── normalizePath ──

describe('normalizePath', () => {
  it('adds leading slash when missing', () => {
    expect(normalizePath('blog/post')).toBe('/blog/post');
  });

  it('keeps existing leading slash', () => {
    expect(normalizePath('/blog/post')).toBe('/blog/post');
  });

  it('strips trailing slash from non-root paths', () => {
    expect(normalizePath('/blog/post/')).toBe('/blog/post');
  });

  it('preserves root path as-is', () => {
    expect(normalizePath('/')).toBe('/');
  });

  it('empty string becomes root slash', () => {
    expect(normalizePath('')).toBe('/');
  });

  it('strips trailing slash when no leading slash is present', () => {
    expect(normalizePath('about/')).toBe('/about');
  });

  it('does not strip double trailing slashes beyond the first (only one pass)', () => {
    // normalizePath adds leading slash then strips one trailing slash
    // '/services/seo/' → '/services/seo' (one trailing slash removed)
    expect(normalizePath('/services/seo/')).toBe('/services/seo');
  });

  it('handles a path with no trailing slash and no leading slash', () => {
    expect(normalizePath('services/seo')).toBe('/services/seo');
  });
});

// ── matchPagePath ──

describe('matchPagePath', () => {
  it('exact matching paths are equal', () => {
    expect(matchPagePath('/blog/post', '/blog/post')).toBe(true);
  });

  it('trailing slash difference is ignored', () => {
    expect(matchPagePath('/blog/post/', '/blog/post')).toBe(true);
    expect(matchPagePath('/blog/post', '/blog/post/')).toBe(true);
  });

  it('case differences are ignored', () => {
    expect(matchPagePath('/Blog/Post', '/blog/post')).toBe(true);
    expect(matchPagePath('/SERVICES/SEO', '/services/seo')).toBe(true);
  });

  it('different paths do not match', () => {
    expect(matchPagePath('/seo', '/services/seo')).toBe(false);
  });

  it('root paths match each other', () => {
    expect(matchPagePath('/', '/')).toBe(true);
  });

  it('leading-slash vs no-leading-slash normalizes correctly', () => {
    expect(matchPagePath('blog/post', '/blog/post')).toBe(true);
  });
});

// ── findPageMapEntry ──

describe('findPageMapEntry', () => {
  const pageMap = [
    { pagePath: '/about', title: 'About' },
    { pagePath: '/services/seo', title: 'SEO Service' },
    { pagePath: '/blog', title: 'Blog' },
  ];

  it('finds an entry by exact path', () => {
    expect(findPageMapEntry(pageMap, '/about')?.title).toBe('About');
  });

  it('returns undefined when path is not in map', () => {
    expect(findPageMapEntry(pageMap, '/contact')).toBeUndefined();
  });

  it('matches despite trailing slash on query', () => {
    expect(findPageMapEntry(pageMap, '/about/')?.title).toBe('About');
  });

  it('matches despite trailing slash on entry', () => {
    const mapWithTrailing = [{ pagePath: '/about/', title: 'About Trailing' }];
    expect(findPageMapEntry(mapWithTrailing, '/about')?.title).toBe('About Trailing');
  });

  it('is case-insensitive', () => {
    expect(findPageMapEntry(pageMap, '/ABOUT')?.title).toBe('About');
    expect(findPageMapEntry(pageMap, '/Services/SEO')?.title).toBe('SEO Service');
  });

  it('returns undefined for empty pageMap', () => {
    expect(findPageMapEntry([], '/about')).toBeUndefined();
  });

  it('returns first match when multiple entries normalize to same path', () => {
    const dupMap = [
      { pagePath: '/dup', title: 'First' },
      { pagePath: '/dup/', title: 'Second' },
    ];
    expect(findPageMapEntry(dupMap, '/dup')?.title).toBe('First');
  });
});

// ── findPageMapEntryForPage ──

describe('findPageMapEntryForPage', () => {
  it('finds entry via publishedPath (primary path)', () => {
    const pageMap = [{ pagePath: '/services/seo', data: 'seo-page' }];
    const page = { publishedPath: '/services/seo', slug: 'seo' };
    expect(findPageMapEntryForPage(pageMap, page)?.data).toBe('seo-page');
  });

  it('uses legacy fallback /${slug} when primary does not match', () => {
    // pageMap has legacy entry under '/seo', but publishedPath is '/services/seo'
    const pageMap = [{ pagePath: '/seo', data: 'legacy-entry' }];
    const page = { publishedPath: '/services/seo', slug: 'seo' };
    expect(findPageMapEntryForPage(pageMap, page)?.data).toBe('legacy-entry');
  });

  it('returns undefined when neither primary nor fallback match', () => {
    const pageMap = [{ pagePath: '/other', data: 'other' }];
    const page = { publishedPath: '/services/seo', slug: 'seo' };
    expect(findPageMapEntryForPage(pageMap, page)).toBeUndefined();
  });

  it('does not generate a legacyFallbackPath when publishedPath equals /${slug}', () => {
    // When /seo is already the publishedPath, legacyFallbackPath should not be generated
    const pageMap = [{ pagePath: '/seo', data: 'seo' }];
    const page = { publishedPath: '/seo', slug: 'seo' };
    // Should still find it via primary path (not fallback)
    expect(findPageMapEntryForPage(pageMap, page)?.data).toBe('seo');
  });

  it('works when no slug is present (only publishedPath)', () => {
    const pageMap = [{ pagePath: '/about', data: 'about' }];
    const page = { publishedPath: '/about' };
    expect(findPageMapEntryForPage(pageMap, page)?.data).toBe('about');
  });

  it('returns undefined for empty pageMap', () => {
    const page = { publishedPath: '/about', slug: 'about' };
    expect(findPageMapEntryForPage([], page)).toBeUndefined();
  });
});

// ── resolvePageAddress ──

describe('resolvePageAddress', () => {
  it('returns fallback root when all fields are absent', () => {
    const addr = resolvePageAddress({});
    expect(addr.canonicalPath).toBe('/');
    expect(addr.source).toBe('fallback');
  });

  it('returns fallback root when all fields are null', () => {
    const addr = resolvePageAddress({ publishedPath: null, path: null, url: null, slug: null });
    expect(addr.canonicalPath).toBe('/');
    expect(addr.source).toBe('fallback');
  });

  it('uses slug when it is the only field', () => {
    const addr = resolvePageAddress({ slug: 'about' });
    expect(addr.canonicalPath).toBe('/about');
    expect(addr.source).toBe('slug');
  });

  it('handles slug with path segments', () => {
    const addr = resolvePageAddress({ slug: 'services/seo' });
    expect(addr.canonicalPath).toBe('/services/seo');
    expect(addr.source).toBe('slug');
  });

  it('prefers path over slug', () => {
    const addr = resolvePageAddress({ path: '/path-value', slug: 'slug-value' });
    expect(addr.canonicalPath).toBe('/path-value');
    expect(addr.source).toBe('path');
  });

  it('prefers path over url and slug', () => {
    // Priority order: publishedPath > path > url > slug
    const addr = resolvePageAddress({ url: 'https://example.com/url-page', path: '/path-page', slug: 'slug-page' });
    expect(addr.canonicalPath).toBe('/path-page');
    expect(addr.source).toBe('path');
  });

  it('falls back to url when path is absent', () => {
    const addr = resolvePageAddress({ url: 'https://example.com/url-page', slug: 'slug-page' });
    expect(addr.canonicalPath).toBe('/url-page');
    expect(addr.source).toBe('url');
  });

  it('prefers publishedPath over everything', () => {
    const addr = resolvePageAddress({
      publishedPath: '/published-path',
      url: 'https://example.com/url-page',
      path: '/path-page',
      slug: 'slug-page',
    });
    expect(addr.canonicalPath).toBe('/published-path');
    expect(addr.source).toBe('publishedPath');
  });

  it('sets canonicalUrl when baseUrl option is provided', () => {
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

  it('does NOT set legacyFallbackPath when slug is absent', () => {
    const addr = resolvePageAddress({ publishedPath: '/services/seo' });
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

  it('extracts pathname from a full URL in the url field', () => {
    const addr = resolvePageAddress({ url: 'https://example.com/services/seo?utm=1#top' });
    expect(addr.canonicalPath).toBe('/services/seo');
    expect(addr.source).toBe('url');
  });

  it('normalizes trailing slash in publishedPath', () => {
    const addr = resolvePageAddress({ publishedPath: '/about/' });
    expect(addr.canonicalPath).toBe('/about');
  });

  it('handles empty-string slug as homepage', () => {
    const addr = resolvePageAddress({ slug: '' });
    expect(addr.canonicalPath).toBe('/');
    expect(addr.source).toBe('slug');
  });
});

// ── matchGscUrlToPath ──

describe('matchGscUrlToPath', () => {
  it('matches a full URL to a resolved path', () => {
    expect(matchGscUrlToPath('https://example.com/blog', '/blog')).toBe(true);
  });

  it('strips trailing slash from full URL before comparison', () => {
    expect(matchGscUrlToPath('https://example.com/blog/', '/blog')).toBe(true);
  });

  it('root resolvedPath matches gscUrl with root pathname', () => {
    expect(matchGscUrlToPath('https://example.com/', '/')).toBe(true);
  });

  it('root resolvedPath matches gscUrl with empty pathname edge case', () => {
    // normalizePath('') = '/' but rPath after normalizePath could be '/'
    expect(matchGscUrlToPath('https://example.com', '/')).toBe(true);
  });

  it('matches bare path when gscUrl has no scheme', () => {
    expect(matchGscUrlToPath('/services/seo', '/services/seo')).toBe(true);
  });

  it('returns false for a path mismatch', () => {
    expect(matchGscUrlToPath('https://example.com/seo', '/services/seo')).toBe(false);
  });

  it('strips query string from full URL (uses pathname only)', () => {
    expect(matchGscUrlToPath('https://example.com/blog?q=seo', '/blog')).toBe(true);
  });

  it('strips hash fragment from full URL (uses pathname only)', () => {
    expect(matchGscUrlToPath('https://example.com/blog#section', '/blog')).toBe(true);
  });

  it('non-root resolvedPath does not match root gscUrl', () => {
    expect(matchGscUrlToPath('https://example.com/', '/blog')).toBe(false);
  });
});

// ── applyBulkKeywordGuards ──

describe('applyBulkKeywordGuards', () => {
  it('zeros out keywordDifficulty and monthlyVolume when semrushBlock is empty', () => {
    const analysis: Record<string, unknown> = { keywordDifficulty: 42, monthlyVolume: 1000 };
    applyBulkKeywordGuards(analysis, '');
    expect(analysis.keywordDifficulty).toBe(0);
    expect(analysis.monthlyVolume).toBe(0);
  });

  it('leaves values untouched when semrushBlock is non-empty', () => {
    const analysis: Record<string, unknown> = { keywordDifficulty: 42, monthlyVolume: 1000 };
    applyBulkKeywordGuards(analysis, 'some-semrush-data');
    expect(analysis.keywordDifficulty).toBe(42);
    expect(analysis.monthlyVolume).toBe(1000);
  });

  it('is a no-op when analysis is null', () => {
    // Should not throw
    expect(() => applyBulkKeywordGuards(null as unknown as Record<string, unknown>, '')).not.toThrow();
  });

  it('is a no-op when analysis is an array', () => {
    const arr: unknown[] = [1, 2, 3];
    applyBulkKeywordGuards(arr as unknown as Record<string, unknown>, '');
    // Array should be unchanged
    expect(arr).toEqual([1, 2, 3]);
  });

  it('is a no-op when analysis is a primitive', () => {
    expect(() => applyBulkKeywordGuards('string' as unknown as Record<string, unknown>, '')).not.toThrow();
    expect(() => applyBulkKeywordGuards(42 as unknown as Record<string, unknown>, '')).not.toThrow();
  });

  it('sets fields even when they did not exist on the object', () => {
    const analysis: Record<string, unknown> = {};
    applyBulkKeywordGuards(analysis, '');
    expect(analysis.keywordDifficulty).toBe(0);
    expect(analysis.monthlyVolume).toBe(0);
  });
});

// ── stripCodeFences ──

describe('stripCodeFences', () => {
  it('strips ```json fences', () => {
    expect(stripCodeFences('```json\n{"key":"value"}\n```')).toBe('{"key":"value"}');
  });

  it('strips ```html fences', () => {
    expect(stripCodeFences('```html\n<p>hello</p>\n```')).toBe('<p>hello</p>');
  });

  it('strips ```xml fences', () => {
    expect(stripCodeFences('```xml\n<root/>\n```')).toBe('<root/>');
  });

  it('strips plain ``` fences (no language specifier)', () => {
    expect(stripCodeFences('```\nsome text\n```')).toBe('some text');
  });

  it('returns text unchanged (trimmed) when no fence is present', () => {
    expect(stripCodeFences('  plain text  ')).toBe('plain text');
    expect(stripCodeFences('{"key":"value"}')).toBe('{"key":"value"}');
  });

  it('BUG: strips any ``` fence regardless of language (python not in documented allowed list)', () => {
    // The docstring says only json/html/xml are handled, but the regex
    // `^```(?:json|html|xml)?\s*` has an optional language group. When the
    // language is "python", the optional group matches nothing (consuming 0 chars),
    // then \s* also matches 0 chars (because 'p' is not whitespace), so the
    // leading fence still matches as just ``` — leaving "python\n..." as content.
    // This is a latent bug: AI responses fenced with ```python ARE stripped,
    // contrary to the documented contract.
    const input = '```python\nprint("hello")\n```';
    // Actual (buggy) behavior: 'python\nprint("hello")' — fence stripped, 'python' left as garbage
    expect(stripCodeFences(input)).toBe('python\nprint("hello")');
  });

  it('is case-insensitive for the language specifier', () => {
    expect(stripCodeFences('```JSON\n{}\n```')).toBe('{}');
    expect(stripCodeFences('```HTML\n<div/>\n```')).toBe('<div/>');
  });

  it('strips leading/trailing whitespace around fences', () => {
    expect(stripCodeFences('  ```json\n{}\n```  ')).toBe('{}');
  });

  it('strips trailing fence with surrounding whitespace', () => {
    expect(stripCodeFences('```json\n{"a":1}\n```\n')).toBe('{"a":1}');
  });

  it('handles multi-line JSON content', () => {
    const json = '{\n  "key": "value",\n  "num": 42\n}';
    expect(stripCodeFences(`\`\`\`json\n${json}\n\`\`\``)).toBe(json);
  });
});

// ── toInsightPageId ──

describe('toInsightPageId', () => {
  it('extracts pathname from a full URL', () => {
    expect(toInsightPageId('https://example.com/blog/post')).toBe('/blog/post');
  });

  it('extracts root pathname from a domain-only URL', () => {
    expect(toInsightPageId('https://example.com')).toBe('/');
  });

  it('returns a relative path unchanged', () => {
    expect(toInsightPageId('/blog/post')).toBe('/blog/post');
  });

  it('returns a bare slug unchanged when not a valid URL', () => {
    expect(toInsightPageId('some-slug')).toBe('some-slug');
  });

  it('preserves trailing slash in URL pathname', () => {
    // URL.pathname includes the trailing slash
    expect(toInsightPageId('https://example.com/blog/')).toBe('/blog/');
  });

  it('excludes query string and hash (URL.pathname only)', () => {
    expect(toInsightPageId('https://example.com/page?q=seo#section')).toBe('/page');
  });
});

// ── toAuditFindingPageId ──

describe('toAuditFindingPageId', () => {
  it('returns URL pathname when url is a valid full URL', () => {
    const page = { url: 'https://example.com/services/seo', slug: 'seo', pageId: 'uuid-1' };
    expect(toAuditFindingPageId(page)).toBe('/services/seo');
  });

  it('falls back to slug when url is empty string', () => {
    const page = { url: '', slug: 'about', pageId: 'uuid-2' };
    expect(toAuditFindingPageId(page)).toBe('/about');
  });

  it('falls back to slug when url is invalid/non-parseable', () => {
    const page = { url: 'not-a-url', slug: 'about', pageId: 'uuid-3' };
    expect(toAuditFindingPageId(page)).toBe('/about');
  });

  it('strips leading slash from slug to avoid double-slash', () => {
    const page = { url: '', slug: '/about', pageId: 'uuid-4' };
    expect(toAuditFindingPageId(page)).toBe('/about');
  });

  it('adds leading slash to slug that has none', () => {
    const page = { url: '', slug: 'contact', pageId: 'uuid-5' };
    expect(toAuditFindingPageId(page)).toBe('/contact');
  });

  it('falls back to pageId when url and slug are both empty', () => {
    const page = { url: '', slug: '', pageId: 'uuid-fallback' };
    expect(toAuditFindingPageId(page)).toBe('uuid-fallback');
  });

  it('url wins over slug when both are present', () => {
    const page = { url: 'https://example.com/nested/path', slug: 'path', pageId: 'uuid-6' };
    expect(toAuditFindingPageId(page)).toBe('/nested/path');
  });

  it('strips multiple leading slashes from slug', () => {
    const page = { url: '', slug: '//double-slash', pageId: 'uuid-7' };
    expect(toAuditFindingPageId(page)).toBe('/double-slash');
  });
});
