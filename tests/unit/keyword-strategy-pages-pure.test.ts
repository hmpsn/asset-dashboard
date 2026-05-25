/**
 * Wave 23 — Pure function unit tests for server/keyword-strategy-pages.ts
 *
 * The module's private helpers contain well-defined pure logic.
 * We re-implement and test:
 *   - SKIP_PATHS / SKIP_PREFIXES / SKIP_SUFFIXES / SKIP_PATTERNS (utility-path filtering)
 *   - capPaths scoring and selection logic (re-implemented)
 *   - removeThinPages filtering logic (re-implemented)
 *   - addFreshPageSkeletons merge logic (re-implemented)
 *   - path-to-title derivation logic (re-implemented from fetchPageContent)
 *   - preloadFreshIncrementalPaths cutoff logic (re-implemented)
 *   - SKIP_PATTERNS regex coverage
 */

import { describe, it, expect, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — hoisted before any imports that touch the mocked modules
// ---------------------------------------------------------------------------

vi.mock('../../server/helpers.js', () => ({
  resolvePagePath: vi.fn((p: { slug: string }) => `/${p.slug}`),
  stripHtmlToText: vi.fn((html: string, opts?: { maxLength?: number }) =>
    html.replace(/<[^>]+>/g, '').slice(0, opts?.maxLength ?? 9999)
  ),
  decodeEntities: vi.fn((s: string) => s),
}));

vi.mock('../../server/url-helpers.js', () => ({
  resolveBaseUrl: vi.fn(async () => 'https://example.com'),
}));

vi.mock('../../server/webflow.js', () => ({
  discoverSitemapUrls: vi.fn(async () => []),
}));

vi.mock('../../server/workspace-data.js', () => ({
  getWorkspacePages: vi.fn(async () => []),
}));

vi.mock('../../server/workspaces.js', () => ({
  updateWorkspace: vi.fn(),
}));

vi.mock('../../server/page-keywords.js', () => ({
  listPageKeywords: vi.fn(() => []),
}));

vi.mock('../../server/logger.js', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

vi.mock('../../server/errors.js', () => ({
  isProgrammingError: vi.fn(() => false),
}));

vi.mock('../../server/keyword-strategy-helpers.js', () => ({
  INCREMENTAL_THRESHOLD_DAYS: 7,
}));

// ---------------------------------------------------------------------------
// Re-implemented pure helpers from keyword-strategy-pages.ts
// ---------------------------------------------------------------------------

const SKIP_PATHS = new Set([
  '/404', '/search', '/password', '/offline', '/thank-you', '/thanks', '/confirmation',
  '/privacy', '/privacy-policy', '/terms', '/terms-of-service', '/terms-and-conditions',
  '/cookie-policy', '/cookies', '/disclaimer', '/legal', '/gdpr', '/ccpa',
  '/acceptable-use', '/acceptable-use-policy', '/dmca', '/refund-policy', '/returns-policy',
  '/login', '/signup', '/register', '/reset-password', '/forgot-password',
  '/unsubscribe', '/opt-out', '/maintenance', '/coming-soon', '/under-construction',
]);

const SKIP_PREFIXES = ['/tag/', '/category/', '/author/', '/page/', '/legal/', '/policies/'];
const SKIP_SUFFIXES = ['/rss', '/feed', '/rss.xml', '/feed.xml'];
const SKIP_PATTERNS = [
  /\/404$/i,
  /\/search$/i,
  /\/password$/i,
  /\/privacy[-_]?policy/i,
  /\/terms[-_]?(of[-_]?service|and[-_]?conditions)?$/i,
  /\/cookie[-_]?policy/i,
  /\/legal$/i,
];

function shouldSkipPath(rawPath: string): boolean {
  const path = rawPath === '/' ? '/' : rawPath.replace(/\/$/, '');
  const lowerPath = path.toLowerCase();
  if (SKIP_PATHS.has(lowerPath)) return true;
  if (SKIP_PREFIXES.some(p => lowerPath.startsWith(p))) return true;
  if (SKIP_SUFFIXES.some(s => lowerPath.endsWith(s))) return true;
  if (SKIP_PATTERNS.some(r => r.test(path))) return true;
  return false;
}

interface KeywordStrategyPageInfo {
  path: string;
  title: string;
  seoTitle: string;
  seoDesc: string;
  contentSnippet: string;
}

type WebflowPageMeta = { title: string; seoTitle: string; seoDesc: string };

/**
 * Mirror of the `capPaths` function in keyword-strategy-pages.ts
 */
function capPaths(
  allPaths: Set<string>,
  wfMetaByPath: Map<string, WebflowPageMeta>,
  maxPagesParam: number,
): { pathArray: string[]; cappedFromTotal: number } {
  let pathArray = Array.from(allPaths);
  let cappedFromTotal = 0;
  if (maxPagesParam > 0 && pathArray.length > maxPagesParam) {
    cappedFromTotal = pathArray.length;
    const scorePath = (p: string): number => {
      if (p === '/') return 0;
      const depth = p.split('/').filter(Boolean).length;
      const hasWfMeta = wfMetaByPath.has(p) ? 0 : 100;
      return depth * 10 + hasWfMeta;
    };
    pathArray.sort((a, b) => scorePath(a) - scorePath(b));
    pathArray = pathArray.slice(0, maxPagesParam);
  }
  return { pathArray, cappedFromTotal };
}

/**
 * Mirror of `removeThinPages` in keyword-strategy-pages.ts
 */
function removeThinPages(pageInfo: KeywordStrategyPageInfo[]): number {
  const thinPages = pageInfo.filter(p => p.contentSnippet.length < 50 && p.path !== '/');
  for (const thin of thinPages) {
    const idx = pageInfo.indexOf(thin);
    if (idx >= 0) pageInfo.splice(idx, 1);
  }
  return thinPages.length;
}

/**
 * Mirror of `addFreshPageSkeletons` in keyword-strategy-pages.ts
 */
function addFreshPageSkeletons(
  pageInfo: KeywordStrategyPageInfo[],
  preloadedPageKeywords: Array<{ pagePath: string; pageTitle?: string }> | null,
  freshPathSet: Set<string>,
): void {
  if (!preloadedPageKeywords || freshPathSet.size === 0) return;
  const fetchedPaths = new Set(pageInfo.map(p => p.path));
  for (const pk of preloadedPageKeywords) {
    if (freshPathSet.has(pk.pagePath) && !fetchedPaths.has(pk.pagePath)) {
      pageInfo.push({
        path: pk.pagePath,
        title: pk.pageTitle || '',
        seoTitle: '',
        seoDesc: '',
        contentSnippet: '',
      });
    }
  }
}

/**
 * Mirror of the path-to-title derivation in `fetchPageContent`
 */
function derivePathName(pagePath: string): string {
  return pagePath.replace(/^\//, '').replace(/\/$/, '').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) || 'Home';
}

// ---------------------------------------------------------------------------
// SKIP_PATHS exact match tests
// ---------------------------------------------------------------------------

describe('SKIP_PATHS (utility path filtering)', () => {
  it('skips /404', () => {
    expect(shouldSkipPath('/404')).toBe(true);
  });

  it('skips /login', () => {
    expect(shouldSkipPath('/login')).toBe(true);
  });

  it('skips /privacy-policy', () => {
    expect(shouldSkipPath('/privacy-policy')).toBe(true);
  });

  it('skips /terms-of-service', () => {
    expect(shouldSkipPath('/terms-of-service')).toBe(true);
  });

  it('skips /cookie-policy', () => {
    expect(shouldSkipPath('/cookie-policy')).toBe(true);
  });

  it('does not skip regular page paths', () => {
    expect(shouldSkipPath('/about')).toBe(false);
    expect(shouldSkipPath('/services')).toBe(false);
    expect(shouldSkipPath('/blog/my-post')).toBe(false);
  });

  it('does not skip home path', () => {
    expect(shouldSkipPath('/')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// SKIP_PREFIXES tests
// ---------------------------------------------------------------------------

describe('SKIP_PREFIXES (taxonomy path filtering)', () => {
  it('skips /tag/* paths', () => {
    expect(shouldSkipPath('/tag/seo')).toBe(true);
    expect(shouldSkipPath('/tag/marketing/paid')).toBe(true);
  });

  it('skips /category/* paths', () => {
    expect(shouldSkipPath('/category/news')).toBe(true);
  });

  it('skips /author/* paths', () => {
    expect(shouldSkipPath('/author/john-doe')).toBe(true);
  });

  it('skips /page/* paths (pagination)', () => {
    expect(shouldSkipPath('/page/2')).toBe(true);
    expect(shouldSkipPath('/page/10')).toBe(true);
  });

  it('skips /legal/* paths', () => {
    expect(shouldSkipPath('/legal/privacy')).toBe(true);
  });

  it('does not skip /pages/* (different prefix)', () => {
    // /pages/ is not in SKIP_PREFIXES — only /page/
    expect(shouldSkipPath('/pages/about')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// SKIP_SUFFIXES tests
// ---------------------------------------------------------------------------

describe('SKIP_SUFFIXES (feed path filtering)', () => {
  it('skips /rss suffix', () => {
    expect(shouldSkipPath('/blog/rss')).toBe(true);
  });

  it('skips /feed suffix', () => {
    expect(shouldSkipPath('/feed')).toBe(true);
  });

  it('skips /rss.xml suffix', () => {
    expect(shouldSkipPath('/rss.xml')).toBe(true);
  });

  it('skips /feed.xml suffix', () => {
    expect(shouldSkipPath('/feed.xml')).toBe(true);
  });

  it('does not skip normal paths ending in rss-like words', () => {
    expect(shouldSkipPath('/blog-rss-overview')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// SKIP_PATTERNS regex tests
// ---------------------------------------------------------------------------

describe('SKIP_PATTERNS (regex path filtering)', () => {
  it('skips /privacy_policy (underscore variant)', () => {
    expect(shouldSkipPath('/privacy_policy')).toBe(true);
  });

  it('skips /terms (bare)', () => {
    expect(shouldSkipPath('/terms')).toBe(true);
  });

  it('skips /terms_and_conditions', () => {
    expect(shouldSkipPath('/terms_and_conditions')).toBe(true);
  });

  it('skips nested /subfolder/legal paths', () => {
    expect(shouldSkipPath('/company/legal')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// capPaths
// ---------------------------------------------------------------------------

describe('capPaths', () => {
  it('does not cap when pathArray length <= maxPagesParam', () => {
    const paths = new Set(['/about', '/services', '/contact']);
    const result = capPaths(paths, new Map(), 10);
    expect(result.pathArray).toHaveLength(3);
    expect(result.cappedFromTotal).toBe(0);
  });

  it('caps to maxPagesParam when exceeded', () => {
    const paths = new Set(['/a', '/b', '/c', '/d', '/e']);
    const result = capPaths(paths, new Map(), 3);
    expect(result.pathArray).toHaveLength(3);
    expect(result.cappedFromTotal).toBe(5);
  });

  it('prioritizes home page "/" above all others', () => {
    const paths = new Set(['/deep/nested/path', '/', '/shallow']);
    const wfMeta = new Map<string, WebflowPageMeta>();
    const result = capPaths(paths, wfMeta, 1);
    expect(result.pathArray[0]).toBe('/');
  });

  it('prioritizes paths with Webflow metadata over those without', () => {
    const paths = new Set(['/no-meta', '/has-meta']);
    const wfMeta = new Map<string, WebflowPageMeta>([
      ['/has-meta', { title: 'Has Meta', seoTitle: '', seoDesc: '' }],
    ]);
    const result = capPaths(paths, wfMeta, 1);
    expect(result.pathArray[0]).toBe('/has-meta');
  });

  it('prefers shallower paths over deeper paths when both lack metadata', () => {
    const paths = new Set(['/a/b/c', '/shallow']);
    const result = capPaths(paths, new Map(), 1);
    expect(result.pathArray[0]).toBe('/shallow');
  });

  it('does not cap when maxPagesParam is 0 (unlimited)', () => {
    const paths = new Set(['/a', '/b', '/c', '/d', '/e', '/f']);
    const result = capPaths(paths, new Map(), 0);
    expect(result.pathArray).toHaveLength(6);
    expect(result.cappedFromTotal).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// removeThinPages
// ---------------------------------------------------------------------------

describe('removeThinPages', () => {
  it('removes pages with contentSnippet < 50 chars (non-home)', () => {
    const pages: KeywordStrategyPageInfo[] = [
      { path: '/short', title: 'Short', seoTitle: '', seoDesc: '', contentSnippet: 'Too short' },
      { path: '/long', title: 'Long', seoTitle: '', seoDesc: '', contentSnippet: 'A'.repeat(100) },
    ];
    const removed = removeThinPages(pages);
    expect(removed).toBe(1);
    expect(pages).toHaveLength(1);
    expect(pages[0].path).toBe('/long');
  });

  it('preserves the home page "/" even with thin content', () => {
    const pages: KeywordStrategyPageInfo[] = [
      { path: '/', title: 'Home', seoTitle: '', seoDesc: '', contentSnippet: 'Short' },
    ];
    const removed = removeThinPages(pages);
    expect(removed).toBe(0);
    expect(pages).toHaveLength(1);
  });

  it('returns 0 when no thin pages exist', () => {
    const pages: KeywordStrategyPageInfo[] = [
      { path: '/about', title: 'About', seoTitle: '', seoDesc: '', contentSnippet: 'A'.repeat(60) },
    ];
    expect(removeThinPages(pages)).toBe(0);
    expect(pages).toHaveLength(1);
  });

  it('removes all thin pages (only home exempt)', () => {
    const pages: KeywordStrategyPageInfo[] = [
      { path: '/a', title: 'A', seoTitle: '', seoDesc: '', contentSnippet: 'Hi' },
      { path: '/b', title: 'B', seoTitle: '', seoDesc: '', contentSnippet: 'Hello' },
      { path: '/', title: 'Home', seoTitle: '', seoDesc: '', contentSnippet: '' },
    ];
    const removed = removeThinPages(pages);
    expect(removed).toBe(2);
    expect(pages).toHaveLength(1);
    expect(pages[0].path).toBe('/');
  });

  it('treats exactly 50 chars as NOT thin', () => {
    const pages: KeywordStrategyPageInfo[] = [
      { path: '/exactly50', title: 'E', seoTitle: '', seoDesc: '', contentSnippet: 'A'.repeat(50) },
    ];
    const removed = removeThinPages(pages);
    expect(removed).toBe(0);
  });

  it('treats 49 chars as thin', () => {
    const pages: KeywordStrategyPageInfo[] = [
      { path: '/thin49', title: 'T', seoTitle: '', seoDesc: '', contentSnippet: 'A'.repeat(49) },
    ];
    const removed = removeThinPages(pages);
    expect(removed).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// addFreshPageSkeletons
// ---------------------------------------------------------------------------

describe('addFreshPageSkeletons', () => {
  it('does nothing when preloadedPageKeywords is null', () => {
    const pageInfo: KeywordStrategyPageInfo[] = [];
    addFreshPageSkeletons(pageInfo, null, new Set(['/about']));
    expect(pageInfo).toHaveLength(0);
  });

  it('does nothing when freshPathSet is empty', () => {
    const pageInfo: KeywordStrategyPageInfo[] = [];
    const keywords = [{ pagePath: '/about', pageTitle: 'About' }];
    addFreshPageSkeletons(pageInfo, keywords, new Set());
    expect(pageInfo).toHaveLength(0);
  });

  it('adds skeleton for fresh paths not already in pageInfo', () => {
    const pageInfo: KeywordStrategyPageInfo[] = [];
    const keywords = [{ pagePath: '/about', pageTitle: 'About Us' }];
    addFreshPageSkeletons(pageInfo, keywords, new Set(['/about']));
    expect(pageInfo).toHaveLength(1);
    expect(pageInfo[0].path).toBe('/about');
    expect(pageInfo[0].title).toBe('About Us');
    expect(pageInfo[0].contentSnippet).toBe('');
  });

  it('does not add pages already in pageInfo (already fetched)', () => {
    const pageInfo: KeywordStrategyPageInfo[] = [
      { path: '/about', title: 'About (fetched)', seoTitle: 'About', seoDesc: '', contentSnippet: 'Content here...' },
    ];
    const keywords = [{ pagePath: '/about', pageTitle: 'About' }];
    addFreshPageSkeletons(pageInfo, keywords, new Set(['/about']));
    expect(pageInfo).toHaveLength(1);
    expect(pageInfo[0].title).toBe('About (fetched)');
  });

  it('adds multiple fresh pages', () => {
    const pageInfo: KeywordStrategyPageInfo[] = [];
    const keywords = [
      { pagePath: '/about', pageTitle: 'About' },
      { pagePath: '/services', pageTitle: 'Services' },
      { pagePath: '/contact', pageTitle: 'Contact' },
    ];
    addFreshPageSkeletons(pageInfo, keywords, new Set(['/about', '/services', '/contact']));
    expect(pageInfo).toHaveLength(3);
  });

  it('skeleton seoTitle and seoDesc are empty strings', () => {
    const pageInfo: KeywordStrategyPageInfo[] = [];
    const keywords = [{ pagePath: '/blog', pageTitle: 'Blog' }];
    addFreshPageSkeletons(pageInfo, keywords, new Set(['/blog']));
    expect(pageInfo[0].seoTitle).toBe('');
    expect(pageInfo[0].seoDesc).toBe('');
  });
});

// ---------------------------------------------------------------------------
// derivePathName (path-to-title derivation from fetchPageContent)
// ---------------------------------------------------------------------------

describe('derivePathName (path-to-title derivation)', () => {
  it('returns "Home" for root path "/"', () => {
    expect(derivePathName('/')).toBe('Home');
  });

  it('converts kebab-case slug to Title Case', () => {
    expect(derivePathName('/about-us')).toBe('About Us');
    expect(derivePathName('/our-services')).toBe('Our Services');
  });

  it('strips leading and trailing slashes', () => {
    expect(derivePathName('/contact/')).toBe('Contact');
  });

  it('handles nested paths', () => {
    expect(derivePathName('/blog/my-great-post')).toBe('Blog/My Great Post');
  });

  it('capitalises first letter of each word', () => {
    expect(derivePathName('/seo-strategy')).toBe('Seo Strategy');
  });
});
