/**
 * Unit tests for uncovered utilities in src/utils/ and src/lib/.
 *
 * Covers:
 *   - src/utils/formatNumbers.ts   (fmtNum, fmtMoney, fmtMoneyFull)
 *   - src/lib/inline-markdown.ts   (inlineMarkdownToHtml)
 *   - src/lib/strategy-health-score.ts (calculateStrategyHealth)
 *   - src/lib/roadmapFilters.ts    (matchesFilters, estToHours, sortItems, filtersFromParams, deriveAllTags)
 *   - src/lib/pathUtils.ts         (normalizePath, matchPagePath, normalizePageUrl, findPageMapEntry, resolvePageAddress, tryResolvePagePath)
 */
import { describe, it, expect } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// src/utils/formatNumbers.ts
// ═══════════════════════════════════════════════════════════════════════════

import { fmtNum, fmtMoney, fmtMoneyFull } from '../../src/utils/formatNumbers';

describe('src/utils/formatNumbers — fmtNum', () => {
  it('formats millions with one decimal place', () => {
    expect(fmtNum(1_500_000)).toBe('1.5M');
  });

  it('formats millions at boundary (exactly 1M)', () => {
    expect(fmtNum(1_000_000)).toBe('1.0M');
  });

  it('formats thousands with one decimal place', () => {
    expect(fmtNum(1_234)).toBe('1.2K');
  });

  it('formats exactly 1K', () => {
    expect(fmtNum(1_000)).toBe('1.0K');
  });

  it('formats values below 1000 via toLocaleString', () => {
    const result = fmtNum(999);
    // toLocaleString returns the number formatted by locale — just ensure it contains 999
    expect(result).toContain('999');
  });

  it('formats zero without K or M suffix', () => {
    const result = fmtNum(0);
    expect(result).not.toContain('K');
    expect(result).not.toContain('M');
  });

  it('formats 10.5M correctly', () => {
    expect(fmtNum(10_500_000)).toBe('10.5M');
  });

  it('rounds down correctly at 1499', () => {
    expect(fmtNum(1_499)).toBe('1.5K');
  });
});

describe('src/utils/formatNumbers — fmtMoney', () => {
  it('formats amounts >= 1000 as compact k notation', () => {
    expect(fmtMoney(2_500)).toBe('$2.5k');
  });

  it('formats exactly 1000 as $1.0k', () => {
    expect(fmtMoney(1_000)).toBe('$1.0k');
  });

  it('formats amounts < 1000 with two decimal places', () => {
    expect(fmtMoney(49)).toBe('$49.00');
  });

  it('formats 0.5 as $0.50', () => {
    expect(fmtMoney(0.5)).toBe('$0.50');
  });

  it('formats zero as $0.00', () => {
    expect(fmtMoney(0)).toBe('$0.00');
  });

  it('formats 999.99 with two decimal places', () => {
    expect(fmtMoney(999.99)).toBe('$999.99');
  });
});

describe('src/utils/formatNumbers — fmtMoneyFull', () => {
  it('formats 12345 as $12,345', () => {
    expect(fmtMoneyFull(12345)).toBe('$12,345');
  });

  it('formats 0 as $0', () => {
    expect(fmtMoneyFull(0)).toBe('$0');
  });

  it('formats 1000000 as $1,000,000', () => {
    expect(fmtMoneyFull(1_000_000)).toBe('$1,000,000');
  });

  it('rounds fractional amounts (no decimals)', () => {
    const result = fmtMoneyFull(1234.56);
    // Intl.NumberFormat with maximumFractionDigits=0 rounds to nearest integer
    expect(result).toBe('$1,235');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// src/lib/inline-markdown.ts
// ═══════════════════════════════════════════════════════════════════════════

import { inlineMarkdownToHtml } from '../../src/lib/inline-markdown';

describe('src/lib/inline-markdown — inlineMarkdownToHtml', () => {
  it('converts **bold** to <b> tag', () => {
    const result = inlineMarkdownToHtml('Hello **world**');
    expect(result).toContain('<b ');
    expect(result).toContain('world');
    expect(result).toContain('</b>');
  });

  it('converts *em* to <em> tag', () => {
    const result = inlineMarkdownToHtml('Hello *world*');
    expect(result).toContain('<em ');
    expect(result).toContain('world');
    expect(result).toContain('</em>');
  });

  it('converts `code` to <code> tag', () => {
    const result = inlineMarkdownToHtml('Run `npm install`');
    expect(result).toContain('<code ');
    expect(result).toContain('npm install');
    expect(result).toContain('</code>');
  });

  it('strips Markdown links but keeps link text', () => {
    const result = inlineMarkdownToHtml('[Click here](https://example.com)');
    expect(result).not.toContain('href');
    expect(result).not.toContain('https://example.com');
    expect(result).toContain('Click here');
  });

  it('strips bare https URLs', () => {
    const result = inlineMarkdownToHtml('Visit https://example.com for more');
    expect(result).not.toContain('https://example.com');
    expect(result).toContain('Visit');
    expect(result).toContain('for more');
  });

  it('escapes HTML special characters', () => {
    const result = inlineMarkdownToHtml('<script>alert("xss")</script>');
    expect(result).not.toContain('<script>');
    expect(result).toContain('&lt;script&gt;');
  });

  it('escapes ampersands', () => {
    const result = inlineMarkdownToHtml('A & B');
    expect(result).toContain('&amp;');
  });

  it('passes through plain text unchanged (aside from HTML escaping)', () => {
    const result = inlineMarkdownToHtml('Hello world');
    expect(result).toBe('Hello world');
  });

  it('returns empty string for empty input', () => {
    expect(inlineMarkdownToHtml('')).toBe('');
  });

  it('handles combined bold and code in same string', () => {
    const result = inlineMarkdownToHtml('Use **bold** and `code` together');
    expect(result).toContain('<b ');
    expect(result).toContain('<code ');
  });

  it('accepts custom class overrides', () => {
    const result = inlineMarkdownToHtml('**test**', { bold: 'my-bold-class' });
    expect(result).toContain('my-bold-class');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// src/lib/strategy-health-score.ts
// ═══════════════════════════════════════════════════════════════════════════

import { calculateStrategyHealth } from '../../src/lib/strategy-health-score';

const emptyStrategy = {
  contentGaps: [],
  quickWins: [],
  keywordGaps: [],
  pageMap: [],
} as never;

describe('src/lib/strategy-health-score — calculateStrategyHealth', () => {
  it('returns zero health score for empty strategy', () => {
    const result = calculateStrategyHealth(emptyStrategy);
    expect(result.healthScore).toBe(0);
    expect(result.contentScore).toBe(0);
    expect(result.quickWinScore).toBe(0);
    expect(result.coverageScore).toBe(0);
  });

  it('caps contentScore at 40 (10+ content gaps)', () => {
    const strategy = {
      ...emptyStrategy,
      contentGaps: new Array(15).fill({ topic: 'gap' }),
    } as never;
    const result = calculateStrategyHealth(strategy);
    expect(result.contentScore).toBe(40);
    expect(result.contentGapsFound).toBe(15);
  });

  it('calculates contentScore correctly for small count', () => {
    const strategy = {
      ...emptyStrategy,
      contentGaps: [{ topic: 'gap-1' }, { topic: 'gap-2' }],
    } as never;
    const result = calculateStrategyHealth(strategy);
    expect(result.contentScore).toBe(8); // 2 gaps × 4
  });

  it('caps quickWinScore at 30 (5+ quick wins)', () => {
    const strategy = {
      ...emptyStrategy,
      quickWins: new Array(8).fill({ keyword: 'kw' }),
    } as never;
    const result = calculateStrategyHealth(strategy);
    expect(result.quickWinScore).toBe(30);
    expect(result.quickWinsAvailable).toBe(8);
  });

  it('calculates quickWinScore correctly for small count', () => {
    const strategy = {
      ...emptyStrategy,
      quickWins: [{ keyword: 'kw-1' }, { keyword: 'kw-2' }, { keyword: 'kw-3' }],
    } as never;
    const result = calculateStrategyHealth(strategy);
    expect(result.quickWinScore).toBe(18); // 3 × 6
  });

  it('calculates coverageScore from pagesRanking / totalPages', () => {
    const strategy = {
      ...emptyStrategy,
      pageMap: [
        { pagePath: '/a', currentPosition: 5 },
        { pagePath: '/b', currentPosition: 10 },
        { pagePath: '/c', currentPosition: null },
        { pagePath: '/d', currentPosition: null },
      ],
    } as never;
    const result = calculateStrategyHealth(strategy);
    // 2 ranking / 4 total = 0.5, × 30 = 15
    expect(result.coverageScore).toBe(15);
    expect(result.pagesRanking).toBe(2);
    expect(result.totalPages).toBe(4);
  });

  it('does not divide by zero when pageMap is empty', () => {
    const result = calculateStrategyHealth(emptyStrategy);
    expect(result.coverageScore).toBe(0);
    expect(isFinite(result.healthScore)).toBe(true);
  });

  it('counts keyword gaps correctly', () => {
    const strategy = {
      ...emptyStrategy,
      keywordGaps: [{ keyword: 'k1' }, { keyword: 'k2' }],
    } as never;
    const result = calculateStrategyHealth(strategy);
    expect(result.keywordGapCount).toBe(2);
    expect(result.newContentTopicCount).toBe(2); // 0 content gaps + 2 keyword gaps
  });

  it('newContentTopicCount combines contentGaps and keywordGaps', () => {
    const strategy = {
      ...emptyStrategy,
      contentGaps: [{ topic: 'g1' }],
      keywordGaps: [{ keyword: 'k1' }, { keyword: 'k2' }],
    } as never;
    const result = calculateStrategyHealth(strategy);
    expect(result.newContentTopicCount).toBe(3);
  });

  it('counts pages with growth opportunities (impressions > 0, no currentPosition)', () => {
    const strategy = {
      ...emptyStrategy,
      pageMap: [
        { pagePath: '/a', currentPosition: null, impressions: 100 },
        { pagePath: '/b', currentPosition: null, impressions: 0 },
        { pagePath: '/c', currentPosition: 5, impressions: 200 },
      ],
    } as never;
    const result = calculateStrategyHealth(strategy);
    expect(result.pagesWithGrowthOpps).toBe(1); // Only /a has impressions but no position
  });

  it('healthScore is sum of all component scores', () => {
    const result = calculateStrategyHealth(emptyStrategy);
    expect(result.healthScore).toBe(
      result.contentScore + result.quickWinScore + result.coverageScore,
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// src/lib/roadmapFilters.ts
// ═══════════════════════════════════════════════════════════════════════════

import { matchesFilters, estToHours, sortItems, filtersFromParams, deriveAllTags, DEFAULT_FILTERS } from '../../src/lib/roadmapFilters';
import type { FlatRoadmapItem } from '../../src/lib/roadmapFilters';

const makeItem = (overrides: Partial<FlatRoadmapItem> = {}): FlatRoadmapItem => ({
  id: 1,
  title: 'Test Item',
  status: 'pending',
  sprintId: 'sprint-1',
  sprintName: 'Sprint 1',
  priority: 'P2',
  est: '2h',
  tags: [],
  featureId: undefined,
  ...overrides,
} as FlatRoadmapItem);

describe('src/lib/roadmapFilters — DEFAULT_FILTERS', () => {
  it('all filters default to "all"', () => {
    expect(DEFAULT_FILTERS.priority).toBe('all');
    expect(DEFAULT_FILTERS.status).toBe('all');
    expect(DEFAULT_FILTERS.sprint).toBe('all');
    expect(DEFAULT_FILTERS.feature).toBe('all');
    expect(DEFAULT_FILTERS.tags).toBe('all');
  });
});

describe('src/lib/roadmapFilters — matchesFilters', () => {
  it('returns true for item matching all filters', () => {
    const item = makeItem({ status: 'pending', priority: 'P1', featureId: 1 });
    expect(matchesFilters(item, DEFAULT_FILTERS, 'sprint-1')).toBe(true);
  });

  it('filters by priority', () => {
    const item = makeItem({ priority: 'P2' });
    expect(matchesFilters(item, { ...DEFAULT_FILTERS, priority: 'P1' }, 'sprint-1')).toBe(false);
    expect(matchesFilters(item, { ...DEFAULT_FILTERS, priority: 'P2' }, 'sprint-1')).toBe(true);
  });

  it('filters by status', () => {
    const item = makeItem({ status: 'done' });
    expect(matchesFilters(item, { ...DEFAULT_FILTERS, status: 'pending' }, 'sprint-1')).toBe(false);
    expect(matchesFilters(item, { ...DEFAULT_FILTERS, status: 'done' }, 'sprint-1')).toBe(true);
  });

  it('filters by sprintId', () => {
    const item = makeItem();
    expect(matchesFilters(item, { ...DEFAULT_FILTERS, sprint: 'sprint-2' }, 'sprint-1')).toBe(false);
    expect(matchesFilters(item, { ...DEFAULT_FILTERS, sprint: 'sprint-1' }, 'sprint-1')).toBe(true);
  });

  it('filters by featureId', () => {
    const item = makeItem({ featureId: 42 });
    expect(matchesFilters(item, { ...DEFAULT_FILTERS, feature: '99' }, 'sprint-1')).toBe(false);
    expect(matchesFilters(item, { ...DEFAULT_FILTERS, feature: '42' }, 'sprint-1')).toBe(true);
  });

  it('filters by tags (OR semantics)', () => {
    const item = makeItem({ tags: ['seo', 'content'] });
    expect(matchesFilters(item, { ...DEFAULT_FILTERS, tags: 'seo' }, 'sprint-1')).toBe(true);
    expect(matchesFilters(item, { ...DEFAULT_FILTERS, tags: 'analytics' }, 'sprint-1')).toBe(false);
    expect(matchesFilters(item, { ...DEFAULT_FILTERS, tags: 'seo,analytics' }, 'sprint-1')).toBe(true);
  });

  it('returns false for item with no tags when tag filter is set', () => {
    const item = makeItem({ tags: [] });
    expect(matchesFilters(item, { ...DEFAULT_FILTERS, tags: 'seo' }, 'sprint-1')).toBe(false);
  });
});

describe('src/lib/roadmapFilters — estToHours', () => {
  it('parses "2h" as 2', () => {
    expect(estToHours('2h')).toBe(2);
  });

  it('parses "30m" as 0.5', () => {
    expect(estToHours('30m')).toBe(0.5);
  });

  it('parses "2-3h" as average (2.5)', () => {
    expect(estToHours('2-3h')).toBe(2.5);
  });

  it('parses "30m-1h" as average (0.75)', () => {
    expect(estToHours('30m-1h')).toBe(0.75);
  });

  it('returns Infinity for undefined', () => {
    expect(estToHours(undefined)).toBe(Infinity);
  });

  it('returns Infinity for empty string', () => {
    expect(estToHours('')).toBe(Infinity);
  });

  it('returns Infinity for unparseable string', () => {
    expect(estToHours('a few days')).toBe(Infinity);
  });

  it('parses "1h" as 1', () => {
    expect(estToHours('1h')).toBe(1);
  });

  it('parses "10-14h" as 12', () => {
    expect(estToHours('10-14h')).toBe(12);
  });
});

describe('src/lib/roadmapFilters — sortItems', () => {
  const items: FlatRoadmapItem[] = [
    makeItem({ id: 3, priority: 'P0', status: 'pending', est: '1h' }),
    makeItem({ id: 1, priority: 'P2', status: 'done', est: '3h' }),
    makeItem({ id: 2, priority: 'P1', status: 'in_progress', est: '2h' }),
  ];

  it('sorts by id ascending', () => {
    const sorted = sortItems(items, 'id', 'asc');
    expect(sorted.map(i => i.id)).toEqual([1, 2, 3]);
  });

  it('sorts by id descending', () => {
    const sorted = sortItems(items, 'id', 'desc');
    expect(sorted.map(i => i.id)).toEqual([3, 2, 1]);
  });

  it('sorts by priority ascending (P0 first)', () => {
    const sorted = sortItems(items, 'priority', 'asc');
    expect(sorted[0].priority).toBe('P0');
    expect(sorted[1].priority).toBe('P1');
  });

  it('sorts by status ascending (in_progress first)', () => {
    const sorted = sortItems(items, 'status', 'asc');
    expect(sorted[0].status).toBe('in_progress');
    expect(sorted[2].status).toBe('done');
  });

  it('sorts by est ascending (smallest hours first)', () => {
    const sorted = sortItems(items, 'est', 'asc');
    expect(sorted[0].est).toBe('1h');
    expect(sorted[2].est).toBe('3h');
  });

  it('does not mutate the input array', () => {
    const original = [...items];
    sortItems(items, 'id', 'asc');
    expect(items).toEqual(original);
  });
});

describe('src/lib/roadmapFilters — filtersFromParams', () => {
  it('returns all defaults for empty params', () => {
    const filters = filtersFromParams(new URLSearchParams());
    expect(filters).toEqual(DEFAULT_FILTERS);
  });

  it('parses valid priority from params', () => {
    const filters = filtersFromParams(new URLSearchParams('priority=P1'));
    expect(filters.priority).toBe('P1');
  });

  it('falls back to "all" for invalid priority', () => {
    const filters = filtersFromParams(new URLSearchParams('priority=P9'));
    expect(filters.priority).toBe('all');
  });

  it('parses valid status from params', () => {
    const filters = filtersFromParams(new URLSearchParams('status=done'));
    expect(filters.status).toBe('done');
  });

  it('preserves freeform sprint value', () => {
    const filters = filtersFromParams(new URLSearchParams('sprint=sprint-abc'));
    expect(filters.sprint).toBe('sprint-abc');
  });

  it('preserves freeform tags value', () => {
    const filters = filtersFromParams(new URLSearchParams('tags=seo,content'));
    expect(filters.tags).toBe('seo,content');
  });
});

describe('src/lib/roadmapFilters — deriveAllTags', () => {
  it('collects tags from all sprints', () => {
    const sprints = [
      { items: [makeItem({ tags: ['seo', 'content'] }), makeItem({ tags: ['analytics'] })] },
      { items: [makeItem({ tags: ['seo', 'performance'] })] },
    ];
    const tags = deriveAllTags(sprints);
    expect(tags).toContain('seo');
    expect(tags).toContain('content');
    expect(tags).toContain('analytics');
    expect(tags).toContain('performance');
  });

  it('deduplicates tags', () => {
    const sprints = [
      { items: [makeItem({ tags: ['seo'] }), makeItem({ tags: ['seo'] })] },
    ];
    const tags = deriveAllTags(sprints);
    expect(tags.filter(t => t === 'seo')).toHaveLength(1);
  });

  it('returns sorted tags', () => {
    const sprints = [
      { items: [makeItem({ tags: ['z-tag', 'a-tag', 'm-tag'] })] },
    ];
    const tags = deriveAllTags(sprints);
    expect(tags).toEqual([...tags].sort());
  });

  it('handles items with no tags', () => {
    const sprints = [
      { items: [makeItem({ tags: undefined })] },
    ];
    expect(() => deriveAllTags(sprints)).not.toThrow();
  });

  it('returns empty array for empty sprints', () => {
    expect(deriveAllTags([])).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// src/lib/pathUtils.ts
// ═══════════════════════════════════════════════════════════════════════════

import {
  normalizePageUrl,
  matchPagePath,
  findPageMapEntry,
  resolvePageAddress,
  tryResolvePagePath,
} from '../../src/lib/pathUtils';
const normalizePath = normalizePageUrl;

describe('src/lib/pathUtils — normalizePath', () => {
  it('adds leading slash when missing', () => {
    expect(normalizePath('about')).toBe('/about');
  });

  it('strips trailing slash from paths longer than 1', () => {
    expect(normalizePath('/about/')).toBe('/about');
  });

  it('keeps root "/" as-is', () => {
    expect(normalizePath('/')).toBe('/');
  });

  it('handles path already starting with slash', () => {
    expect(normalizePath('/services/seo')).toBe('/services/seo');
  });

  it('handles empty string', () => {
    // normalizePath('') → '/'.slice(0,-1) would be '' → edge: returns '/'
    expect(normalizePath('')).toBe('/');
  });
});

describe('src/lib/pathUtils — matchPagePath', () => {
  it('matches identical paths', () => {
    expect(matchPagePath('/about', '/about')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(matchPagePath('/About', '/about')).toBe(true);
  });

  it('ignores trailing slash difference', () => {
    expect(matchPagePath('/about/', '/about')).toBe(true);
  });

  it('returns false for different paths', () => {
    expect(matchPagePath('/about', '/contact')).toBe(false);
  });
});

describe('src/lib/pathUtils — normalizePageUrl', () => {
  it('strips origin from a full URL', () => {
    expect(normalizePageUrl('https://example.com/about')).toBe('/about');
  });

  it('preserves path-only input', () => {
    expect(normalizePageUrl('/about')).toBe('/about');
  });

  it('handles root URL', () => {
    expect(normalizePageUrl('https://example.com/')).toBe('/');
  });

  it('strips trailing slash from URL path', () => {
    expect(normalizePageUrl('https://example.com/about/')).toBe('/about');
  });
});

describe('src/lib/pathUtils — findPageMapEntry', () => {
  const pageMap = [
    { pagePath: '/home', title: 'Home' },
    { pagePath: '/about', title: 'About' },
    { pagePath: '/services/seo', title: 'SEO Services' },
  ];

  it('finds an entry by exact path', () => {
    const result = findPageMapEntry(pageMap, '/about');
    expect(result?.title).toBe('About');
  });

  it('finds an entry case-insensitively', () => {
    const result = findPageMapEntry(pageMap, '/ABOUT');
    expect(result?.title).toBe('About');
  });

  it('finds an entry stripping trailing slash', () => {
    const result = findPageMapEntry(pageMap, '/about/');
    expect(result?.title).toBe('About');
  });

  it('returns undefined when not found', () => {
    expect(findPageMapEntry(pageMap, '/nonexistent')).toBeUndefined();
  });

  it('finds nested path', () => {
    const result = findPageMapEntry(pageMap, '/services/seo');
    expect(result?.title).toBe('SEO Services');
  });
});

describe('src/lib/pathUtils — resolvePageAddress', () => {
  it('uses publishedPath when available', () => {
    const result = resolvePageAddress({ publishedPath: '/services/seo', slug: 'seo' });
    expect(result.canonicalPath).toBe('/services/seo');
    expect(result.source).toBe('publishedPath');
  });

  it('falls back to slug when publishedPath is null', () => {
    const result = resolvePageAddress({ publishedPath: null, slug: 'about' });
    expect(result.canonicalPath).toBe('/about');
    expect(result.source).toBe('slug');
  });

  it('resolves empty slug to root "/"', () => {
    const result = resolvePageAddress({ slug: '' });
    expect(result.canonicalPath).toBe('/');
  });

  it('builds canonicalUrl when baseUrl is provided', () => {
    const result = resolvePageAddress({ slug: 'about' }, { baseUrl: 'example.com' });
    expect(result.canonicalUrl).toBe('https://example.com/about');
  });

  it('canonicalUrl is undefined without baseUrl', () => {
    const result = resolvePageAddress({ slug: 'about' });
    expect(result.canonicalUrl).toBeUndefined();
  });

  it('does not append path for homepage in canonicalUrl', () => {
    const result = resolvePageAddress({ slug: '' }, { baseUrl: 'https://example.com' });
    expect(result.canonicalUrl).toBe('https://example.com');
  });

  it('adds legacyFallbackPath when slug differs from publishedPath', () => {
    const result = resolvePageAddress({ publishedPath: '/services/seo', slug: 'seo' });
    expect(result.legacyFallbackPath).toBe('/seo');
  });

  it('does not add legacyFallbackPath when slug and path match', () => {
    const result = resolvePageAddress({ publishedPath: '/about', slug: 'about' });
    expect(result.legacyFallbackPath).toBeUndefined();
  });

  it('uses url field when publishedPath and slug are absent', () => {
    const result = resolvePageAddress({ url: 'https://example.com/contact' });
    expect(result.canonicalPath).toBe('/contact');
    expect(result.source).toBe('url');
  });
});

describe('src/lib/pathUtils — tryResolvePagePath', () => {
  it('returns undefined when no slug, publishedPath, path, or url', () => {
    expect(tryResolvePagePath({})).toBeUndefined();
  });

  it('returns "/" for empty-string slug (homepage)', () => {
    expect(tryResolvePagePath({ slug: '' })).toBe('/');
  });

  it('returns resolved path when slug is provided', () => {
    expect(tryResolvePagePath({ slug: 'about' })).toBe('/about');
  });

  it('uses publishedPath when available', () => {
    expect(tryResolvePagePath({ publishedPath: '/services/seo', slug: 'seo' })).toBe('/services/seo');
  });
});
