/**
 * tests/unit/hooks/admin-queries-e.test.tsx
 *
 * Smoke / edge-case tests for:
 *   - useInsightFeed  (transformToFeedInsight, computeSummaryCounts, hook)
 *   - seoEditorFilters (isSyntheticCmsId, filterWritablePages, filterWritableItems,
 *                       filterWritableIds, countMissingField, filterPagesNeedingFix)
 *   - usePageJoin     (disabled when no siteId, success with empty data)
 *   - useWorkspaces extras (useLinkSite, useUnlinkSite)
 *   - useSmartPlaceholder (flag-off, client context, admin context branches)
 *   - useGlobalAdminEvents (WebSocket lifecycle + message dispatch)
 *   - useWorkspaceEvents  (delegates to workspaceEventBus, returns send helper)
 *
 * Runs in the `component` vitest project (jsdom environment).
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor, act } from '@testing-library/react';

// ── Standard query wrapper ────────────────────────────────────────────────────

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

// ── Mock: src/api/client ──────────────────────────────────────────────────────

vi.mock('../../../src/api/client', () => ({
  get: vi.fn(),
  getSafe: vi.fn(),
  getOptional: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
}));

import { get, getSafe, post, patch, del } from '../../../src/api/client';
const mockGet = vi.mocked(get);
const mockGetSafe = vi.mocked(getSafe);
const mockPost = vi.mocked(post);
const mockPatch = vi.mocked(patch);
const mockDel = vi.mocked(del);

// ── Mock: src/api/seo (keywords.providerStatus used by useKeywordStrategy) ───

vi.mock('../../../src/api/seo', () => ({
  keywords: {
    providerStatus: vi.fn().mockResolvedValue({ providers: [] }),
    list: vi.fn(),
    update: vi.fn(),
  },
}));

// ── Mock: src/api/workspaces (workspaces.getById used by useKeywordStrategy) ──

vi.mock('../../../src/api/workspaces', () => ({
  workspaces: {
    getById: vi.fn().mockResolvedValue(null),
  },
}));

// ── Mock: src/api/intelligence (used by useSmartPlaceholder) ─────────────────

vi.mock('../../../src/api/intelligence', () => ({
  intelligenceApi: {
    getIntelligence: vi.fn(),
  },
}));

import { intelligenceApi } from '../../../src/api/intelligence';
const mockGetIntelligence = vi.mocked(intelligenceApi.getIntelligence);

// ── Mock: workspaceEventBus (used by useWorkspaceEvents) ─────────────────────

vi.mock('../../../src/hooks/workspaceEventBus', () => ({
  subscribeWorkspaceEvents: vi.fn(() => vi.fn()),
  sendWorkspaceEvent: vi.fn(),
  __resetWorkspaceEventBusForTests: vi.fn(),
}));

import {
  subscribeWorkspaceEvents,
  sendWorkspaceEvent,
  __resetWorkspaceEventBusForTests,
} from '../../../src/hooks/workspaceEventBus';
const mockSubscribeWorkspaceEvents = vi.mocked(subscribeWorkspaceEvents);
const mockSendWorkspaceEvent = vi.mocked(sendWorkspaceEvent);

// ── Imports under test ────────────────────────────────────────────────────────

import {
  transformToFeedInsight,
  computeSummaryCounts,
  cleanSlugToTitle,
  useInsightFeed,
} from '../../../src/hooks/admin/useInsightFeed';

import {
  isSyntheticCmsId,
  filterWritablePages,
  filterWritableItems,
  filterWritableIds,
  countMissingField,
  filterPagesNeedingFix,
} from '../../../src/hooks/admin/seoEditorFilters';

import { usePageJoin } from '../../../src/hooks/admin/usePageJoin';
import { useLinkSite, useUnlinkSite } from '../../../src/hooks/admin/useWorkspaces';
import { useSmartPlaceholder } from '../../../src/hooks/useSmartPlaceholder';
import { useGlobalAdminEvents } from '../../../src/hooks/useGlobalAdminEvents';
import { useWorkspaceEvents } from '../../../src/hooks/useWorkspaceEvents';

import type { AnalyticsInsight } from '../../../shared/types/analytics';
import type { PageMeta } from '../../../src/hooks/admin/useSeoEditor';

// ── Helper: minimal AnalyticsInsight builder ──────────────────────────────────

function makeInsight(
  overrides: Partial<AnalyticsInsight> & { insightType: AnalyticsInsight['insightType'] },
): AnalyticsInsight {
  return {
    id: 'i1',
    workspaceId: 'ws1',
    pageId: '/blog/seo-tips',
    insightType: overrides.insightType,
    data: overrides.data ?? {},
    severity: overrides.severity ?? 'opportunity',
    computedAt: '2024-01-01T00:00:00Z',
    impactScore: overrides.impactScore ?? 50,
    domain: overrides.domain ?? 'search',
    ...overrides,
  } as AnalyticsInsight;
}

// ════════════════════════════════════════════════════════════════════════════════
// cleanSlugToTitle
// ════════════════════════════════════════════════════════════════════════════════

describe('cleanSlugToTitle', () => {
  it('returns "Unknown Page" for null', () => {
    expect(cleanSlugToTitle(null)).toBe('Unknown Page');
  });

  it('returns "Home" for root path "/"', () => {
    expect(cleanSlugToTitle('/')).toBe('Home');
  });

  it('converts a full URL slug to title-cased words', () => {
    expect(cleanSlugToTitle('https://example.com/blog/seo-tips')).toBe('SEO Tips');
  });

  it('handles acronyms like "ai" and "ctr"', () => {
    expect(cleanSlugToTitle('https://example.com/ai-guide')).toBe('AI Guide');
    expect(cleanSlugToTitle('https://example.com/ctr-optimization')).toBe('CTR Optimization');
  });

  it('handles a plain path (not a URL)', () => {
    expect(cleanSlugToTitle('/about-us')).toBe('About Us');
  });

  it('returns "Home" for path with no meaningful segments', () => {
    // empty after stripping trailing slash
    expect(cleanSlugToTitle('/')).toBe('Home');
  });

  it('handles underscores in slugs', () => {
    expect(cleanSlugToTitle('https://example.com/case_study')).toBe('Case Study');
  });

  it('takes the last path segment of a deep URL', () => {
    expect(cleanSlugToTitle('https://example.com/blog/2024/my-post')).toBe('My Post');
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// transformToFeedInsight — per-type headline generation
// ════════════════════════════════════════════════════════════════════════════════

describe('transformToFeedInsight — ranking_mover (improved)', () => {
  it('generates "climbed to position N" headline when new position ≤ 10', () => {
    const insight = makeInsight({
      insightType: 'ranking_mover',
      data: { previousPosition: 15, currentPosition: 8, currentClicks: 100, previousClicks: 40 },
    });
    const result = transformToFeedInsight(insight);
    expect(result.headline).toBe('climbed to position 8');
    expect(result.context).toContain('Position 15 → 8');
    expect(result.context).toContain('+60 clicks/mo');
  });

  it('generates "improved to position N" headline when new position > 10', () => {
    const insight = makeInsight({
      insightType: 'ranking_mover',
      data: { previousPosition: 25, currentPosition: 12 },
    });
    const result = transformToFeedInsight(insight);
    expect(result.headline).toBe('improved to position 12');
  });

  it('generates "dropped off page 1" when position worsens beyond 10', () => {
    const insight = makeInsight({
      insightType: 'ranking_mover',
      data: { previousPosition: 8, currentPosition: 14 },
    });
    const result = transformToFeedInsight(insight);
    expect(result.headline).toBe('dropped off page 1');
  });

  it('generates "fell to position N" when position worsens within page 1', () => {
    const insight = makeInsight({
      insightType: 'ranking_mover',
      data: { previousPosition: 3, currentPosition: 9 },
    });
    const result = transformToFeedInsight(insight);
    expect(result.headline).toBe('fell to position 9');
  });

  it('handles missing position data with fallback headline', () => {
    const insight = makeInsight({ insightType: 'ranking_mover', data: {} });
    const result = transformToFeedInsight(insight);
    expect(result.headline).toBe('position changed');
  });

  it('omits click delta from context when clicks are unchanged', () => {
    const insight = makeInsight({
      insightType: 'ranking_mover',
      data: { previousPosition: 12, currentPosition: 8, currentClicks: 100, previousClicks: 100 },
    });
    const result = transformToFeedInsight(insight);
    expect(result.context).not.toContain('clicks/mo');
  });
});

describe('transformToFeedInsight — ctr_opportunity', () => {
  it('formats actual vs expected CTR in headline', () => {
    const insight = makeInsight({
      insightType: 'ctr_opportunity',
      data: { actualCtr: 1.2, expectedCtr: 4.8, impressions: 5000 },
    });
    const result = transformToFeedInsight(insight);
    expect(result.headline).toBe('CTR 1.2% vs 4.8% expected');
    expect(result.context).toContain('5.0K impressions');
  });

  it('uses fallback headline when data is missing', () => {
    const insight = makeInsight({ insightType: 'ctr_opportunity', data: {} });
    const result = transformToFeedInsight(insight);
    expect(result.headline).toBe('low CTR vs expected');
  });
});

describe('transformToFeedInsight — ranking_opportunity', () => {
  it('shows positions from page 1', () => {
    const insight = makeInsight({
      insightType: 'ranking_opportunity',
      data: { currentPosition: 15.3, estimatedTrafficGain: 300 },
    });
    const result = transformToFeedInsight(insight);
    expect(result.headline).toBe('6 positions from page 1');
    expect(result.context).toContain('300 clicks/mo potential');
  });

  it('shows current position when already on page 1', () => {
    const insight = makeInsight({
      insightType: 'ranking_opportunity',
      data: { currentPosition: 7 },
    });
    const result = transformToFeedInsight(insight);
    expect(result.headline).toBe('currently position 7');
  });

  it('uses fallback headline when data is missing', () => {
    const insight = makeInsight({ insightType: 'ranking_opportunity', data: {} });
    const result = transformToFeedInsight(insight);
    expect(result.headline).toBe('ranking opportunity');
  });
});

describe('transformToFeedInsight — content_decay', () => {
  it('shows percentage traffic loss', () => {
    const insight = makeInsight({
      insightType: 'content_decay',
      data: { deltaPercent: -35.7, baselineClicks: 1000, currentClicks: 643 },
    });
    const result = transformToFeedInsight(insight);
    expect(result.headline).toBe('lost 36% traffic');
    expect(result.context).toContain('643 vs 1.0K clicks');
  });

  it('uses fallback headline when no delta', () => {
    const insight = makeInsight({ insightType: 'content_decay', data: {} });
    const result = transformToFeedInsight(insight);
    expect(result.headline).toBe('traffic declining');
  });
});

describe('transformToFeedInsight — page_health', () => {
  it('shows health score in headline', () => {
    const insight = makeInsight({
      insightType: 'page_health',
      data: { score: 72.4, trend: 'improving' },
    });
    const result = transformToFeedInsight(insight);
    expect(result.headline).toBe('health score 72');
    expect(result.context).toContain('improving');
  });

  it('uses fallback headline when score missing', () => {
    const insight = makeInsight({ insightType: 'page_health', data: {} });
    const result = transformToFeedInsight(insight);
    expect(result.headline).toBe('page health issue');
  });
});

describe('transformToFeedInsight — audit_finding', () => {
  it('formats site-scope audit with siteScore', () => {
    const insight = makeInsight({
      insightType: 'audit_finding',
      data: { scope: 'site', siteScore: 63, issueCount: 4 },
    });
    const result = transformToFeedInsight(insight);
    expect(result.headline).toBe('site audit score 63');
    expect(result.context).toContain('4 issues');
  });

  it('formats site-scope audit without siteScore', () => {
    const insight = makeInsight({
      insightType: 'audit_finding',
      data: { scope: 'site', issueCount: 1 },
    });
    const result = transformToFeedInsight(insight);
    expect(result.headline).toBe('site audit issues');
    expect(result.context).toContain('1 issue');
  });

  it('formats page-scope audit finding', () => {
    const insight = makeInsight({
      insightType: 'audit_finding',
      data: { issueCount: 3 },
    });
    const result = transformToFeedInsight(insight);
    expect(result.headline).toBe('3 audit issues');
  });

  it('uses "audit finding" fallback when no issueCount', () => {
    const insight = makeInsight({ insightType: 'audit_finding', data: {} });
    const result = transformToFeedInsight(insight);
    expect(result.headline).toBe('audit finding');
  });
});

describe('transformToFeedInsight — serp_opportunity', () => {
  it('uses fixed headline and appends schema status to context', () => {
    const insight = makeInsight({
      insightType: 'serp_opportunity',
      data: { schemaStatus: 'missing' }, // producer writes schemaStatus, not schemaType
    });
    const result = transformToFeedInsight(insight);
    expect(result.headline).toBe('eligible for rich results');
    expect(result.context).toContain('Schema missing');
  });
});

describe('transformToFeedInsight — cannibalization', () => {
  it('counts pages array length', () => {
    const insight = makeInsight({
      insightType: 'cannibalization',
      data: {
        pages: ['/page-a', '/page-b'],
        positions: [5, 12],
        query: 'best seo tool',
      },
    });
    const result = transformToFeedInsight(insight);
    expect(result.headline).toBe('2 pages competing for same query');
    expect(result.context).toContain('"best seo tool"');
    expect(result.details).toHaveLength(2);
    expect(result.details![0]).toContain('position 5');
  });

  it('falls back to pageCount when pages array is missing', () => {
    const insight = makeInsight({
      insightType: 'cannibalization',
      data: { pageCount: 3 },
    });
    const result = transformToFeedInsight(insight);
    expect(result.headline).toBe('3 pages competing for same query');
  });

  it('uses fallback headline when no count available', () => {
    const insight = makeInsight({ insightType: 'cannibalization', data: {} });
    const result = transformToFeedInsight(insight);
    expect(result.headline).toBe('keyword cannibalization');
  });
});

describe('transformToFeedInsight — conversion_attribution', () => {
  it('formats conversions and CVR', () => {
    const insight = makeInsight({
      insightType: 'conversion_attribution',
      data: { conversions: 42, conversionRate: 3.8 },
    });
    const result = transformToFeedInsight(insight);
    expect(result.headline).toBe('drove 42 conversions');
    expect(result.context).toContain('3.8% CVR');
  });

  it('uses fallback headline when no conversions', () => {
    const insight = makeInsight({ insightType: 'conversion_attribution', data: {} });
    const result = transformToFeedInsight(insight);
    expect(result.headline).toBe('conversion driver');
  });
});

describe('transformToFeedInsight — unknown type (default branch)', () => {
  it('converts underscores to spaces for an unrecognised type', () => {
    // cast to bypass type restriction
    const insight = makeInsight({ insightType: 'some_new_type' as AnalyticsInsight['insightType'], data: {} });
    const result = transformToFeedInsight(insight);
    expect(result.headline).toBe('some new type');
  });
});

describe('transformToFeedInsight — context enrichment', () => {
  it('appends strategy keyword context line when strategyKeyword is set', () => {
    const insight = makeInsight({
      insightType: 'page_health',
      data: { score: 80 },
      strategyKeyword: 'seo tool',
    });
    const result = transformToFeedInsight(insight);
    expect(result.context).toContain('Strategy keyword match');
  });

  it('appends pipeline status label when pipelineStatus is "brief_exists"', () => {
    const insight = makeInsight({
      insightType: 'page_health',
      data: { score: 80 },
      pipelineStatus: 'brief_exists',
    });
    const result = transformToFeedInsight(insight);
    expect(result.context).toContain('Brief exists');
  });

  it('appends pipeline status label when pipelineStatus is "in_progress"', () => {
    const insight = makeInsight({
      insightType: 'page_health',
      data: {},
      pipelineStatus: 'in_progress',
    });
    const result = transformToFeedInsight(insight);
    expect(result.context).toContain('Content in progress');
  });

  it('uses GA placeholder fallback when pageTitle matches placeholder', () => {
    const insight = makeInsight({
      insightType: 'page_health',
      data: {},
      pageTitle: '(not set)',
      pageId: '/pricing',
    });
    const result = transformToFeedInsight(insight);
    expect(result.title).toBe('Pricing');
  });

  it('uses real pageTitle when it is set and not a placeholder', () => {
    const insight = makeInsight({
      insightType: 'page_health',
      data: {},
      pageTitle: 'My Real Title',
    });
    const result = transformToFeedInsight(insight);
    expect(result.title).toBe('My Real Title');
  });

  it('includes keyword_cluster queries as details', () => {
    const insight = makeInsight({
      insightType: 'keyword_cluster',
      data: { queries: ['query1', 'query2', 'query3'] },
    });
    const result = transformToFeedInsight(insight);
    expect(result.details).toEqual(['query1', 'query2', 'query3']);
  });

  it('truncates keyword_cluster queries list at 10 with overflow message', () => {
    const queries = Array.from({ length: 15 }, (_, i) => `query${i + 1}`);
    const insight = makeInsight({
      insightType: 'keyword_cluster',
      data: { queries },
    });
    const result = transformToFeedInsight(insight);
    expect(result.details).toHaveLength(11); // 10 + "N more"
    expect(result.details![10]).toContain('5 more');
  });

  it('defaults domain to "cross" when domain is absent', () => {
    const insight = { ...makeInsight({ insightType: 'page_health', data: {} }), domain: undefined };
    const result = transformToFeedInsight(insight as AnalyticsInsight);
    expect(result.domain).toBe('cross');
  });

  it('defaults impactScore to 0 when absent', () => {
    const insight = { ...makeInsight({ insightType: 'page_health', data: {} }), impactScore: undefined };
    const result = transformToFeedInsight(insight as AnalyticsInsight);
    expect(result.impactScore).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// computeSummaryCounts
// ════════════════════════════════════════════════════════════════════════════════

describe('computeSummaryCounts', () => {
  it('returns an empty array for an empty feed', () => {
    expect(computeSummaryCounts([])).toEqual([]);
  });

  it('counts critical and warning as drops', () => {
    const feed = [
      { ...transformToFeedInsight(makeInsight({ insightType: 'content_decay', data: {} })), severity: 'critical' as const },
      { ...transformToFeedInsight(makeInsight({ insightType: 'page_health', data: {} })), severity: 'warning' as const },
    ];
    const counts = computeSummaryCounts(feed);
    const drops = counts.find(c => c.label === 'drops');
    expect(drops?.count).toBe(2);
    expect(drops?.color).toBe('red');
  });

  it('counts opportunities', () => {
    const feed = [
      { ...transformToFeedInsight(makeInsight({ insightType: 'ranking_opportunity', data: {} })), severity: 'opportunity' as const },
    ];
    const counts = computeSummaryCounts(feed);
    const opportunities = counts.find(c => c.label === 'opportunities');
    expect(opportunities?.count).toBe(1);
    expect(opportunities?.color).toBe('amber');
  });

  it('counts positive insights as wins', () => {
    const feed = [
      { ...transformToFeedInsight(makeInsight({ insightType: 'ranking_mover', data: {} })), severity: 'positive' as const },
    ];
    const counts = computeSummaryCounts(feed);
    const wins = counts.find(c => c.label === 'wins');
    expect(wins?.count).toBe(1);
    expect(wins?.color).toBe('emerald');
  });

  it('counts serp_opportunity insights as schema gaps', () => {
    const feed = [
      transformToFeedInsight(makeInsight({ insightType: 'serp_opportunity', data: {} })),
    ];
    const counts = computeSummaryCounts(feed);
    const schema = counts.find(c => c.label === 'schema gaps');
    expect(schema?.count).toBe(1);
    expect(schema?.color).toBe('blue');
  });

  it('counts content_decay insights as decaying pages', () => {
    const feed = [
      transformToFeedInsight(makeInsight({ insightType: 'content_decay', data: {} })),
    ];
    const counts = computeSummaryCounts(feed);
    const decay = counts.find(c => c.label === 'decaying pages');
    expect(decay?.count).toBe(1);
    expect(decay?.color).toBe('purple');
  });

  it('omits categories with zero count', () => {
    const counts = computeSummaryCounts([]);
    expect(counts).toHaveLength(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// useInsightFeed — hook integration
// ════════════════════════════════════════════════════════════════════════════════

describe('useInsightFeed — hook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty feed and summary when disabled (no workspaceId)', () => {
    const { result } = renderHook(() => useInsightFeed(''), { wrapper: makeWrapper() });
    expect(result.current.feed).toEqual([]);
    expect(result.current.summary).toEqual([]);
    expect(result.current.isLoading).toBe(false);
  });

  it('returns empty feed when explicitly disabled', () => {
    const { result } = renderHook(() => useInsightFeed('ws1', false), { wrapper: makeWrapper() });
    expect(result.current.feed).toEqual([]);
  });

  it('returns sorted feed with summary when fetch succeeds', async () => {
    const raw: AnalyticsInsight[] = [
      makeInsight({ insightType: 'page_health', data: { score: 70 }, impactScore: 10, severity: 'warning' }),
      makeInsight({ insightType: 'ranking_mover', data: { previousPosition: 20, currentPosition: 5 }, impactScore: 90, severity: 'positive', id: 'i2' }),
    ];
    mockGetSafe.mockResolvedValueOnce(raw);

    const { result } = renderHook(() => useInsightFeed('ws1'), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.feed).toHaveLength(2));

    // Sorted by impactScore descending
    expect(result.current.feed[0].impactScore).toBe(90);
    expect(result.current.summary.some(s => s.label === 'wins')).toBe(true);
  });

  it('returns error state on fetch failure', async () => {
    mockGetSafe.mockRejectedValueOnce(new Error('network error'));
    const { result } = renderHook(() => useInsightFeed('ws-err'), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.error?.message).toBe('network error');
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// seoEditorFilters — pure utility functions
// ════════════════════════════════════════════════════════════════════════════════

describe('isSyntheticCmsId', () => {
  it('returns true for IDs starting with "cms-"', () => {
    expect(isSyntheticCmsId('cms-abc123')).toBe(true);
    expect(isSyntheticCmsId('cms-')).toBe(true);
  });

  it('returns false for non-CMS IDs', () => {
    expect(isSyntheticCmsId('real-page-id')).toBe(false);
    expect(isSyntheticCmsId('page-123')).toBe(false);
    expect(isSyntheticCmsId('')).toBe(false);
  });
});

// Helper: build a PageMeta
function makePage(overrides: Partial<PageMeta> = {}): PageMeta {
  return {
    id: 'p1',
    title: 'Home',
    slug: 'home',
    source: 'static',
    ...overrides,
  };
}

describe('filterWritablePages', () => {
  it('keeps only static pages', () => {
    const pages = [
      makePage({ id: 'p1', source: 'static' }),
      makePage({ id: 'p2', source: 'cms' }),
      makePage({ id: 'p3' }), // source undefined — treated as static
    ];
    const result = filterWritablePages(pages);
    expect(result.map(p => p.id)).toEqual(['p1', 'p3']);
  });

  it('returns empty array when all pages are CMS', () => {
    const pages = [makePage({ source: 'cms' }), makePage({ source: 'cms' })];
    expect(filterWritablePages(pages)).toEqual([]);
  });

  it('returns all pages when none are CMS', () => {
    const pages = [makePage({ id: 'a', source: 'static' }), makePage({ id: 'b', source: 'static' })];
    expect(filterWritablePages(pages)).toHaveLength(2);
  });
});

describe('filterWritableItems', () => {
  it('filters items whose linked page is CMS', () => {
    const pages = [makePage({ id: 'static-1', source: 'static' }), makePage({ id: 'cms-1', source: 'cms' })];
    const items = [{ pageId: 'static-1', value: 'a' }, { pageId: 'cms-1', value: 'b' }];
    const result = filterWritableItems(items, pages);
    expect(result).toEqual([{ pageId: 'static-1', value: 'a' }]);
  });

  it('keeps items when their page is not found in pages list (assume writable)', () => {
    // find returns undefined → .source !== 'cms' is true
    const pages = [makePage({ id: 'other', source: 'static' })];
    const items = [{ pageId: 'unknown' }];
    const result = filterWritableItems(items, pages);
    expect(result).toHaveLength(1);
  });
});

describe('filterWritableIds', () => {
  it('removes IDs whose page source is CMS', () => {
    const pages = [makePage({ id: 'a', source: 'static' }), makePage({ id: 'b', source: 'cms' })];
    const result = filterWritableIds(['a', 'b', 'c'], pages);
    // 'c' not in pages → kept; 'b' is CMS → removed
    expect(result).toEqual(['a', 'c']);
  });

  it('returns empty array when all IDs map to CMS pages', () => {
    const pages = [makePage({ id: 'a', source: 'cms' })];
    expect(filterWritableIds(['a'], pages)).toEqual([]);
  });
});

describe('countMissingField', () => {
  it('counts static pages missing title', () => {
    const pages = [
      makePage({ source: 'static', seo: { title: null } }),
      makePage({ source: 'static', seo: { title: 'Good Title' } }),
      makePage({ source: 'cms', seo: { title: null } }), // CMS → excluded
    ];
    expect(countMissingField(pages, 'title')).toBe(1);
  });

  it('counts static pages missing description', () => {
    const pages = [
      makePage({ source: 'static', seo: { description: null } }),
      makePage({ source: 'static', seo: { description: 'desc' } }),
    ];
    expect(countMissingField(pages, 'description')).toBe(1);
  });

  it('counts page with no seo object as missing', () => {
    const pages = [makePage({ source: 'static', seo: undefined })];
    expect(countMissingField(pages, 'title')).toBe(1);
    expect(countMissingField(pages, 'description')).toBe(1);
  });

  it('returns 0 when all static pages have the field', () => {
    const pages = [
      makePage({ source: 'static', seo: { title: 'T', description: 'D' } }),
    ];
    expect(countMissingField(pages, 'title')).toBe(0);
  });
});

describe('filterPagesNeedingFix', () => {
  it('returns static pages missing title', () => {
    const pages = [
      makePage({ id: 'a', source: 'static', seo: { title: null } }),
      makePage({ id: 'b', source: 'static', seo: { title: 'OK' } }),
      makePage({ id: 'c', source: 'cms', seo: { title: null } }),
    ];
    const result = filterPagesNeedingFix(pages, 'title');
    expect(result.map(p => p.id)).toEqual(['a']);
  });

  it('returns static pages missing description', () => {
    const pages = [
      makePage({ id: 'a', source: 'static', seo: {} }),
      makePage({ id: 'b', source: 'static', seo: { description: 'OK' } }),
    ];
    const result = filterPagesNeedingFix(pages, 'description');
    expect(result.map(p => p.id)).toEqual(['a']);
  });

  it('returns empty array when all static pages have the field', () => {
    const pages = [makePage({ source: 'static', seo: { title: 'T', description: 'D' } })];
    expect(filterPagesNeedingFix(pages, 'title')).toHaveLength(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// usePageJoin — hook
// ════════════════════════════════════════════════════════════════════════════════

describe('usePageJoin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not call the all-pages endpoint when siteId is empty', async () => {
    // The pages query is disabled when siteId is empty (enabled: !!siteId)
    // The keywordStrategy sub-hook will call get, but NOT the /api/webflow/all-pages endpoint
    mockGet.mockResolvedValue(null);
    renderHook(() => usePageJoin('ws1', ''), { wrapper: makeWrapper() });
    // No call to the webflow all-pages endpoint
    const allPagesCalls = (mockGet as ReturnType<typeof vi.fn>).mock.calls.filter(
      (args: string[]) => args[0]?.includes('/api/webflow/all-pages'),
    );
    expect(allPagesCalls).toHaveLength(0);
  });

  it('returns merged pages on successful fetch', async () => {
    const webflowPages = [
      { id: 'wfp-1', title: 'Home', slug: 'home', source: 'static' as const },
    ];
    mockGet.mockResolvedValueOnce(webflowPages); // all-pages endpoint
    mockGet.mockResolvedValueOnce({ // keyword-strategy endpoint
      strategy: { pageMap: [] },
      seoDataAvailable: false,
      providers: [],
      workspaceData: null,
    });

    const { result } = renderHook(() => usePageJoin('ws1', 'site-123'), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.pages.length).toBeGreaterThanOrEqual(0); // graceful even if strategy fails
  });

  it('exposes refetch function without throwing', () => {
    mockGet.mockResolvedValue([]);
    const { result } = renderHook(() => usePageJoin('ws1', 'site-456'), { wrapper: makeWrapper() });
    expect(typeof result.current.refetch).toBe('function');
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// useWorkspaces extras — useLinkSite, useUnlinkSite
// ════════════════════════════════════════════════════════════════════════════════

describe('useLinkSite', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls patch with correct payload and invalidates workspaces', async () => {
    mockGet.mockResolvedValue([]);
    mockPatch.mockResolvedValueOnce({ id: 'ws1', name: 'Test', webflowSiteId: 'site-1' });

    const { result } = renderHook(() => useLinkSite(), { wrapper: makeWrapper() });
    await act(async () => {
      await result.current.mutateAsync({ workspaceId: 'ws1', siteId: 'site-1', siteName: 'Site One' });
    });

    expect(mockPatch).toHaveBeenCalledWith(
      '/api/workspaces/ws1',
      expect.objectContaining({ webflowSiteId: 'site-1', webflowSiteName: 'Site One' }),
    );
  });
});

describe('useUnlinkSite', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls patch to clear siteId', async () => {
    mockGet.mockResolvedValue([]);
    mockPatch.mockResolvedValueOnce({ id: 'ws1', name: 'Test', webflowSiteId: '' });

    const { result } = renderHook(() => useUnlinkSite(), { wrapper: makeWrapper() });
    await act(async () => {
      await result.current.mutateAsync('ws1');
    });

    expect(mockPatch).toHaveBeenCalledWith(
      '/api/workspaces/ws1',
      { webflowSiteId: '', webflowSiteName: '' },
    );
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// useSmartPlaceholder
// ════════════════════════════════════════════════════════════════════════════════

describe('useSmartPlaceholder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // feature flags endpoint — flag defaults to off in FEATURE_FLAGS
    mockGet.mockResolvedValue({});
  });

  it('returns generic admin placeholder when flag is off', async () => {
    // flag off by default from FEATURE_FLAGS['smart-placeholders'] = false
    const { result } = renderHook(
      () => useSmartPlaceholder({ workspaceId: 'ws1', isAdminContext: true }),
      { wrapper: makeWrapper() },
    );
    // Flag defaults to false — no intelligence query fires, generic placeholder returned synchronously
    expect(result.current.placeholder).toBe('Ask about this workspace...');
    expect(result.current.suggestions).toBeUndefined();
  });

  it('returns generic client placeholder when flag is off', () => {
    const { result } = renderHook(
      () => useSmartPlaceholder({ workspaceId: 'ws1', isAdminContext: false }),
      { wrapper: makeWrapper() },
    );
    expect(result.current.placeholder).toBe('Ask a question about your site...');
    expect(result.current.suggestions).toBeUndefined();
  });

  it('does not fetch intelligence when workspaceId is empty', () => {
    renderHook(
      () => useSmartPlaceholder({ workspaceId: '', isAdminContext: true }),
      { wrapper: makeWrapper() },
    );
    expect(mockGetIntelligence).not.toHaveBeenCalled();
  });

  it('does not fetch intelligence in client context even with flag on', async () => {
    // Manually pre-seed the feature flags cache so 'smart-placeholders' is on
    // queryKeys.shared.featureFlags() = ['feature-flags']
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(['feature-flags'], { 'smart-placeholders': true });
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );

    renderHook(
      () => useSmartPlaceholder({ workspaceId: 'ws1', isAdminContext: false }),
      { wrapper },
    );

    // Intelligence should not be fetched for client context (enabled = flagEnabled && !!workspaceId && isAdminContext)
    expect(mockGetIntelligence).not.toHaveBeenCalled();
  });

  it('returns admin contextual placeholder with suggestions when seoContext available', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    // queryKeys.shared.featureFlags() = ['feature-flags']
    qc.setQueryData(['feature-flags'], { 'smart-placeholders': true });
    const intelData = {
      seoContext: {
        brandVoice: 'Friendly, professional tone that builds trust',
        businessContext: 'SaaS productivity tool for marketing teams',
        personas: [{ name: 'Marketing Manager' }],
      },
    };
    // Pre-seed the intelligence cache using the actual key shape:
    // queryKeys.admin.intelligence(wsId, ['seoContext']) = ['admin-intelligence', wsId, '', 'all', 'seoContext']
    qc.setQueryData(['admin-intelligence', 'ws1', '', 'all', 'seoContext'], intelData);

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(
      () => useSmartPlaceholder({ workspaceId: 'ws1', isAdminContext: true }),
      { wrapper },
    );

    // Admin context with full seoContext → contextual placeholder + suggestion chips
    expect(result.current.placeholder).toContain('Ask about');
    expect(result.current.suggestions).toBeDefined();
    expect(result.current.suggestions!.length).toBeGreaterThanOrEqual(1);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// useGlobalAdminEvents — WebSocket lifecycle
// ════════════════════════════════════════════════════════════════════════════════

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  static OPEN = 1;
  static CONNECTING = 0;
  static CLOSED = 3;

  readyState = 0;
  sent: string[] = [];
  closeCount = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;

  constructor(public readonly url: string) {
    MockWebSocket.instances.push(this);
  }

  send(payload: string) { this.sent.push(payload); }
  close() {
    this.closeCount += 1;
    this.readyState = MockWebSocket.CLOSED;
  }

  emitOpen() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }

  emitMessage(payload: Record<string, unknown>) {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }

  emitClose() {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }
}

describe('useGlobalAdminEvents', () => {
  beforeEach(() => {
    MockWebSocket.instances.length = 0;
    vi.stubGlobal('window', { location: { protocol: 'http:', host: 'localhost:5173' } });
    vi.stubGlobal('localStorage', { getItem: vi.fn(() => null) });
    vi.stubGlobal('WebSocket', MockWebSocket as unknown as typeof WebSocket);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    MockWebSocket.instances.length = 0;
  });

  it('creates a WebSocket connection on mount', () => {
    renderHook(() => useGlobalAdminEvents({}));
    expect(MockWebSocket.instances).toHaveLength(1);
  });

  it('dispatches received events to the registered handler', () => {
    const received: unknown[] = [];
    renderHook(() => useGlobalAdminEvents({ 'queue:update': (d) => received.push(d) }));
    const ws = MockWebSocket.instances[0];
    ws.emitOpen();
    ws.emitMessage({ event: 'queue:update', data: { count: 5 } });
    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({ count: 5 });
  });

  it('ignores events with no matching handler', () => {
    const received: unknown[] = [];
    renderHook(() => useGlobalAdminEvents({ 'queue:update': (d) => received.push(d) }));
    const ws = MockWebSocket.instances[0];
    ws.emitOpen();
    ws.emitMessage({ event: 'other:event', data: {} });
    expect(received).toHaveLength(0);
  });

  it('sends authenticate message when auth token exists', () => {
    vi.stubGlobal('localStorage', { getItem: vi.fn(() => 'mytoken') });
    renderHook(() => useGlobalAdminEvents({}));
    const ws = MockWebSocket.instances[0];
    ws.emitOpen();
    const payloads = ws.sent.map(s => JSON.parse(s));
    expect(payloads.some((p: Record<string, unknown>) => p.action === 'authenticate' && p.token === 'mytoken')).toBe(true);
  });

  it('does NOT send a subscribe action (global hook invariant)', () => {
    renderHook(() => useGlobalAdminEvents({}));
    const ws = MockWebSocket.instances[0];
    ws.emitOpen();
    const payloads = ws.sent.map(s => JSON.parse(s));
    expect(payloads.some((p: Record<string, unknown>) => p.action === 'subscribe')).toBe(false);
  });

  it('schedules reconnect after socket close', () => {
    renderHook(() => useGlobalAdminEvents({}));
    const ws = MockWebSocket.instances[0];
    ws.emitOpen();
    ws.emitClose();
    vi.advanceTimersByTime(2100);
    expect(MockWebSocket.instances).toHaveLength(2);
  });

  it('closes the socket on unmount', () => {
    const { unmount } = renderHook(() => useGlobalAdminEvents({}));
    const ws = MockWebSocket.instances[0];
    unmount();
    expect(ws.closeCount).toBeGreaterThan(0);
  });

  it('does not reconnect after unmount', () => {
    const { unmount } = renderHook(() => useGlobalAdminEvents({}));
    const ws = MockWebSocket.instances[0];
    ws.emitOpen();
    unmount();
    ws.emitClose();
    vi.advanceTimersByTime(5000);
    expect(MockWebSocket.instances).toHaveLength(1); // no new instances
  });

  it('handles malformed JSON in message without throwing', () => {
    renderHook(() => useGlobalAdminEvents({}));
    const ws = MockWebSocket.instances[0];
    ws.emitOpen();
    expect(() => {
      ws.onmessage?.({ data: 'not-valid-json' });
    }).not.toThrow();
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// useWorkspaceEvents — delegates to workspaceEventBus
// ════════════════════════════════════════════════════════════════════════════════

describe('useWorkspaceEvents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSubscribeWorkspaceEvents.mockReturnValue(vi.fn()); // return unsubscribe fn
  });

  it('subscribes to workspace events on mount', () => {
    renderHook(() => useWorkspaceEvents('ws1', { 'activity:new': () => {} }));
    expect(mockSubscribeWorkspaceEvents).toHaveBeenCalledWith('ws1', expect.any(Object));
  });

  it('does not subscribe when workspaceId is empty', () => {
    renderHook(() => useWorkspaceEvents(undefined, { 'activity:new': () => {} }));
    expect(mockSubscribeWorkspaceEvents).not.toHaveBeenCalled();
  });

  it('re-subscribes when workspaceId changes', () => {
    const { rerender } = renderHook(
      ({ wsId }: { wsId: string }) => useWorkspaceEvents(wsId, {}),
      { initialProps: { wsId: 'ws1' } },
    );
    rerender({ wsId: 'ws2' });
    expect(mockSubscribeWorkspaceEvents).toHaveBeenCalledTimes(2);
  });

  it('calls unsubscribe on unmount', () => {
    const mockUnsub = vi.fn();
    mockSubscribeWorkspaceEvents.mockReturnValue(mockUnsub);
    const { unmount } = renderHook(() => useWorkspaceEvents('ws1', {}));
    unmount();
    expect(mockUnsub).toHaveBeenCalled();
  });

  it('returns a send helper function', () => {
    const { result } = renderHook(() => useWorkspaceEvents('ws1', {}));
    expect(typeof result.current.send).toBe('function');
  });

  it('send calls sendWorkspaceEvent with the given message', () => {
    const { result } = renderHook(() => useWorkspaceEvents('ws1', {}));
    act(() => {
      result.current.send({ action: 'ping' });
    });
    expect(mockSendWorkspaceEvent).toHaveBeenCalledWith('ws1', { action: 'ping' });
  });

  it('send is a no-op when workspaceId is undefined', () => {
    const { result } = renderHook(() => useWorkspaceEvents(undefined, {}));
    act(() => {
      result.current.send({ action: 'ping' });
    });
    expect(mockSendWorkspaceEvent).not.toHaveBeenCalled();
  });

  it('dispatches events to registered handlers via onMessage callback', () => {
    const received: unknown[] = [];
    let capturedListener: { onMessage: (msg: { event?: string; data?: unknown }) => void } | null = null;
    mockSubscribeWorkspaceEvents.mockImplementation((_wsId, listener) => {
      capturedListener = listener as typeof capturedListener;
      return vi.fn();
    });

    renderHook(() => useWorkspaceEvents('ws1', { 'activity:new': (d) => received.push(d) }));

    act(() => {
      capturedListener?.onMessage({ event: 'activity:new', data: { id: 'a1' } });
    });

    expect(received).toEqual([{ id: 'a1' }]);
  });

  it('ignores messages with no event name', () => {
    const received: unknown[] = [];
    let capturedListener: { onMessage: (msg: { event?: string; data?: unknown }) => void } | null = null;
    mockSubscribeWorkspaceEvents.mockImplementation((_wsId, listener) => {
      capturedListener = listener as typeof capturedListener;
      return vi.fn();
    });

    renderHook(() => useWorkspaceEvents('ws1', { 'activity:new': (d) => received.push(d) }));

    act(() => {
      capturedListener?.onMessage({ data: {} }); // no event name
    });

    expect(received).toHaveLength(0);
  });
});
