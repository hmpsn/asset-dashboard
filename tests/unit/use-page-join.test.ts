// tests/unit/use-page-join.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';

// ── Mocks (must be hoisted before imports) ──────────────────────────────────

vi.mock('../../src/api/client', () => ({
  get: vi.fn(),
}));

vi.mock('../../src/hooks/admin/useKeywordStrategy', () => ({
  useKeywordStrategy: vi.fn(),
}));

import { get } from '../../src/api/client';
import { useKeywordStrategy } from '../../src/hooks/admin/useKeywordStrategy';
import { usePageJoin } from '../../src/hooks/admin/usePageJoin';

const mockGet = vi.mocked(get);
const mockUseKeywordStrategy = vi.mocked(useKeywordStrategy);

// ── Helpers ──────────────────────────────────────────────────────────────────

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
}

/** Build a minimal useKeywordStrategy return shape */
function makeStrategyReturn(pageMap: object[] = []) {
  return {
    data: { strategy: { pageMap }, semrushAvailable: false, workspaceData: null },
    isLoading: false,
    error: null,
  } as ReturnType<typeof useKeywordStrategy>;
}

/** Build a minimal Webflow page object */
function makePage(overrides: {
  id?: string;
  title?: string;
  slug?: string;
  publishedPath?: string | null;
  source?: 'static' | 'cms';
} = {}) {
  return {
    id: overrides.id ?? 'page-1',
    title: overrides.title ?? 'Page Title',
    slug: overrides.slug ?? 'page-slug',
    publishedPath: overrides.publishedPath ?? `/${overrides.slug ?? 'page-slug'}`,
    source: overrides.source ?? ('static' as const),
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('usePageJoin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: no strategy entries
    mockUseKeywordStrategy.mockReturnValue(makeStrategyReturn([]));
  });

  // ── Test 1: Empty pageMap ──────────────────────────────────────────────────
  it('empty pageMap → all pages have strategy: undefined and analyzed: false', async () => {
    const pages = [makePage({ id: 'p1', slug: 'about', publishedPath: '/about' })];
    mockGet.mockResolvedValue(pages);
    mockUseKeywordStrategy.mockReturnValue(makeStrategyReturn([]));

    const { result } = renderHook(
      () => usePageJoin('ws1', 'site1'),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.pages).toHaveLength(1);
    expect(result.current.pages[0].strategy).toBeUndefined();
    expect(result.current.pages[0].analyzed).toBe(false);
  });

  // ── Test 2: Exact path match ──────────────────────────────────────────────
  it('exact match → page is linked to its strategy entry', async () => {
    const pages = [makePage({ id: 'p2', slug: 'services', publishedPath: '/services' })];
    mockGet.mockResolvedValue(pages);
    mockUseKeywordStrategy.mockReturnValue(
      makeStrategyReturn([
        { pagePath: '/services', pageTitle: 'Services', primaryKeyword: 'seo', secondaryKeywords: [] },
      ]),
    );

    const { result } = renderHook(
      () => usePageJoin('ws1', 'site1'),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const page = result.current.pages[0];
    expect(page.strategy).toBeDefined();
    expect(page.strategy?.pagePath).toBe('/services');
    expect(page.title).toBe('Services'); // strategy title takes precedence
  });

  // ── Test 3: Case-variant match ─────────────────────────────────────────────
  it('case-variant match → /Services/SEO in pageMap matches /services/seo page path', async () => {
    const pages = [makePage({ id: 'p3', slug: 'services-seo', publishedPath: '/services/seo' })];
    mockGet.mockResolvedValue(pages);
    mockUseKeywordStrategy.mockReturnValue(
      makeStrategyReturn([
        { pagePath: '/Services/SEO', pageTitle: 'SEO Services', primaryKeyword: 'seo services', secondaryKeywords: [] },
      ]),
    );

    const { result } = renderHook(
      () => usePageJoin('ws1', 'site1'),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const page = result.current.pages[0];
    expect(page.strategy).toBeDefined();
    expect(page.analyzed).toBe(false);
  });

  // ── Test 4: Legacy /${slug} fallback ──────────────────────────────────────
  it('legacy slug fallback → publishedPath /services/seo but pageMap has /seo', async () => {
    // publishedPath and slug differ → the fallback kicks in to check `/${slug}`
    const pages = [
      { id: 'p4', title: 'SEO Page', slug: 'seo', publishedPath: '/services/seo', source: 'static' as const },
    ];
    mockGet.mockResolvedValue(pages);
    mockUseKeywordStrategy.mockReturnValue(
      makeStrategyReturn([
        { pagePath: '/seo', pageTitle: 'SEO', primaryKeyword: 'seo', secondaryKeywords: [] },
      ]),
    );

    const { result } = renderHook(
      () => usePageJoin('ws1', 'site1'),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const page = result.current.pages[0];
    expect(page.strategy).toBeDefined();
    expect(page.strategy?.pagePath).toBe('/seo');
  });

  // ── Test 5: Homepage ──────────────────────────────────────────────────────
  it('homepage → slug: "" with publishedPath: null matches pageMap entry pagePath: "/"', async () => {
    const pages = [
      { id: 'home', title: 'Home', slug: '', publishedPath: null, source: 'static' as const },
    ];
    mockGet.mockResolvedValue(pages);
    mockUseKeywordStrategy.mockReturnValue(
      makeStrategyReturn([
        { pagePath: '/', pageTitle: 'Home Page', primaryKeyword: 'homepage', secondaryKeywords: [], analysisGeneratedAt: '2026-01-01T00:00:00Z' },
      ]),
    );

    const { result } = renderHook(
      () => usePageJoin('ws1', 'site1'),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const page = result.current.pages[0];
    expect(page.path).toBe('/');
    expect(page.strategy).toBeDefined();
    expect(page.analyzed).toBe(true);
  });

  // ── Test 6: Strategy-only entry ───────────────────────────────────────────
  it('strategy-only entry → no matching Webflow page emits source: "strategy-only"', async () => {
    mockGet.mockResolvedValue([]);
    mockUseKeywordStrategy.mockReturnValue(
      makeStrategyReturn([
        { pagePath: '/orphan-strategy', pageTitle: 'Orphan', primaryKeyword: 'orphan', secondaryKeywords: [] },
      ]),
    );

    const { result } = renderHook(
      () => usePageJoin('ws1', 'site1'),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.pages).toHaveLength(1);
    const entry = result.current.pages[0];
    expect(entry.source).toBe('strategy-only');
    expect(entry.id).toBe('strategy-/orphan-strategy');
    expect(entry.path).toBe('/orphan-strategy');
    expect(entry.strategy).toBeDefined();
  });

  // ── Test 7: strategyPages filter ─────────────────────────────────────────
  it('strategyPages filter → only returns pages with a strategy entry', async () => {
    const pages = [
      makePage({ id: 'p-with-strategy', slug: 'with-strategy', publishedPath: '/with-strategy' }),
      makePage({ id: 'p-no-strategy', slug: 'no-strategy', publishedPath: '/no-strategy' }),
    ];
    mockGet.mockResolvedValue(pages);
    mockUseKeywordStrategy.mockReturnValue(
      makeStrategyReturn([
        { pagePath: '/with-strategy', pageTitle: 'With Strategy', primaryKeyword: 'kw', secondaryKeywords: [] },
      ]),
    );

    const { result } = renderHook(
      () => usePageJoin('ws1', 'site1'),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.pages).toHaveLength(2);
    expect(result.current.strategyPages).toHaveLength(1);
    expect(result.current.strategyPages[0].id).toBe('p-with-strategy');
    // webflowPages includes both (no strategy-only entries here)
    expect(result.current.webflowPages).toHaveLength(2);
  });

  // ── Test 9: webflowPages excludes strategy-only entries ──────────────────
  it('webflowPages → excludes strategy-only entries, includes real Webflow pages', async () => {
    const pages = [makePage({ id: 'p-real', slug: 'real-page', publishedPath: '/real-page' })];
    mockGet.mockResolvedValue(pages);
    mockUseKeywordStrategy.mockReturnValue(
      makeStrategyReturn([
        { pagePath: '/real-page', pageTitle: 'Real Page', primaryKeyword: 'real', secondaryKeywords: [] },
        { pagePath: '/strategy-only-page', pageTitle: 'Strategy Only', primaryKeyword: 'strategy', secondaryKeywords: [] },
      ]),
    );

    const { result } = renderHook(
      () => usePageJoin('ws1', 'site1'),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // Total pages: 1 real Webflow page + 1 strategy-only entry
    expect(result.current.pages).toHaveLength(2);

    // webflowPages must exclude strategy-only entries
    expect(result.current.webflowPages).toHaveLength(1);
    expect(result.current.webflowPages[0].id).toBe('p-real');

    // The strategy-only entry must NOT appear in webflowPages
    const strategyOnlyInWebflow = result.current.webflowPages.find(
      p => p.source === 'strategy-only',
    );
    expect(strategyOnlyInWebflow).toBeUndefined();
  });

  // ── Test 8: Orphan page (no slug, no publishedPath) ───────────────────────
  it('orphan page → no slug and no publishedPath resolves to path "/" and analyzed: false', async () => {
    const pages = [
      { id: 'p-orphan', title: 'Mysterious Page', slug: undefined as unknown as string, publishedPath: null, source: 'static' as const },
    ];
    mockGet.mockResolvedValue(pages);
    mockUseKeywordStrategy.mockReturnValue(makeStrategyReturn([]));

    const { result } = renderHook(
      () => usePageJoin('ws1', 'site1'),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const page = result.current.pages[0];
    expect(page.id).toBe('p-orphan');
    expect(page.path).toBe('/');
    expect(page.analyzed).toBe(false);
    expect(page.strategy).toBeUndefined();
  });
});
