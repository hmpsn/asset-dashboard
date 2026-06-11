/**
 * tests/unit/hooks/client-hooks-extended.test.tsx
 *
 * Extended smoke-level unit tests for client and root hooks.
 * Runs in the `component` vitest project (jsdom environment).
 *
 * Hooks covered:
 *   - useClientGA4          (GA4 analytics data — delegates to useGA4Base)
 *   - useClientSearch       (GSC search data — four sub-queries)
 *   - useClientOutcomeSummary / useClientOutcomeWins (already in client-queries,
 *     but testing additional branches here)
 *   - useClientPostPreview  (post review fetch)
 *   - useClientBriefing     (published briefing — tier-gated)
 *   - useAuditSummary       (shared hook with refresh callback)
 *   - useWsInvalidation     (WS → React Query invalidation)
 *   - useDeepLinkFocus      (focus/scroll on ?focus= param)
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor, act } from '@testing-library/react';

// ── Standard wrapper ────────────────────────────────────────────────────────

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

// ── Mock: src/api/client ────────────────────────────────────────────────────

vi.mock('../../../src/api/client', () => ({
  get: vi.fn(),
  getSafe: vi.fn(),
  getOptional: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  ApiError: class ApiError extends Error {
    readonly status: number;
    constructor(status: number, message: string) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
    }
  },
}));

import { getSafe, getOptional } from '../../../src/api/client';
const mockGetSafe = vi.mocked(getSafe);
const mockGetOptional = vi.mocked(getOptional);

// ── Mock: src/api/analytics ─────────────────────────────────────────────────

vi.mock('../../../src/api/analytics', () => ({
  gsc: {
    overview: vi.fn(),
    trend: vi.fn(),
    comparison: vi.fn(),
    devices: vi.fn(),
  },
  ga4: {
    overview: vi.fn(),
    trend: vi.fn(),
    topPages: vi.fn(),
    sources: vi.fn(),
    devices: vi.fn(),
    countries: vi.fn(),
    events: vi.fn(),
    conversions: vi.fn(),
    comparison: vi.fn(),
    newVsReturning: vi.fn(),
    organic: vi.fn(),
    landingPages: vi.fn(),
  },
  fetchClientIntelligence: vi.fn(),
}));

import { gsc, ga4 } from '../../../src/api/analytics';
const mockGscOverview = vi.mocked(gsc.overview);
const mockGscTrend = vi.mocked(gsc.trend);
const mockGscComparison = vi.mocked(gsc.comparison);
const mockGscDevices = vi.mocked(gsc.devices);
const mockGa4Overview = vi.mocked(ga4.overview);
const mockGa4Trend = vi.mocked(ga4.trend);
const mockGa4TopPages = vi.mocked(ga4.topPages);
const mockGa4Sources = vi.mocked(ga4.sources);
const mockGa4Devices = vi.mocked(ga4.devices);
const mockGa4Countries = vi.mocked(ga4.countries);
const mockGa4Events = vi.mocked(ga4.events);
const mockGa4Conversions = vi.mocked(ga4.conversions);
const mockGa4Comparison = vi.mocked(ga4.comparison);
const mockGa4Nvr = vi.mocked(ga4.newVsReturning);
const mockGa4Organic = vi.mocked(ga4.organic);
const mockGa4Landing = vi.mocked(ga4.landingPages);

// ── Mock: src/api/outcomes ───────────────────────────────────────────────────

vi.mock('../../../src/api/outcomes', () => ({
  clientOutcomesApi: {
    getSummary: vi.fn(),
    getWins: vi.fn(),
  },
  outcomesApi: {},
}));

import { clientOutcomesApi } from '../../../src/api/outcomes';
const mockGetSummary = vi.mocked(clientOutcomesApi.getSummary);
const mockGetWins = vi.mocked(clientOutcomesApi.getWins);

// ── Mock: src/api/content ────────────────────────────────────────────────────

vi.mock('../../../src/api/content', () => ({
  publicPostReview: {
    getPost: vi.fn(),
  },
  contentBriefs: {},
  contentPosts: {},
}));

import { publicPostReview } from '../../../src/api/content';
const mockGetPost = vi.mocked(publicPostReview.getPost);

// ── Mock: src/api/briefing ───────────────────────────────────────────────────

vi.mock('../../../src/api/briefing', () => ({
  briefingApi: {
    getPublished: vi.fn(),
    listDrafts: vi.fn(),
    approve: vi.fn(),
    publish: vi.fn(),
    skip: vi.fn(),
    generateNow: vi.fn(),
    updateStories: vi.fn(),
  },
}));

import { briefingApi } from '../../../src/api/briefing';
const mockGetPublished = vi.mocked(briefingApi.getPublished);

// ── Mock: workspace event bus (for useWsInvalidation) ───────────────────────

vi.mock('../../../src/hooks/workspaceEventBus', () => ({
  subscribeWorkspaceEvents: vi.fn(() => () => {}),
  sendWorkspaceEvent: vi.fn(),
  __resetWorkspaceEventBusForTests: vi.fn(),
}));

import { subscribeWorkspaceEvents } from '../../../src/hooks/workspaceEventBus';
const mockSubscribe = vi.mocked(subscribeWorkspaceEvents);

// ── Mock: react-router-dom (for useDeepLinkFocus) ───────────────────────────

const mockSetSearchParams = vi.fn();
let mockSearchParamsValue = new URLSearchParams();

vi.mock('react-router-dom', () => ({
  useSearchParams: () => [mockSearchParamsValue, mockSetSearchParams],
}));

// ── Hook imports (after mocks) ───────────────────────────────────────────────

import { useClientGA4 } from '../../../src/hooks/client/useClientGA4';
import { useClientSearch } from '../../../src/hooks/client/useClientSearch';
import { useClientOutcomeSummary, useClientOutcomeWins } from '../../../src/hooks/client/useClientOutcomes';
import { useClientPostPreview } from '../../../src/hooks/client/useClientPostPreview';
import { useClientBriefing } from '../../../src/hooks/client/useClientBriefing';
import { useAuditSummary } from '../../../src/hooks/useAuditSummary';
import { useWsInvalidation } from '../../../src/hooks/useWsInvalidation';
import { useDeepLinkFocus } from '../../../src/hooks/useDeepLinkFocus';

// ═══════════════════════════════════════════════════════════════════════════════
// useClientSearch
// ═══════════════════════════════════════════════════════════════════════════════

describe('useClientSearch — disabled state', () => {
  beforeEach(() => {
    mockGscOverview.mockReset();
    mockGscTrend.mockReset();
    mockGscComparison.mockReset();
    mockGscDevices.mockReset();
  });

  it('does not call any sub-query when enabled is false', () => {
    renderHook(() => useClientSearch('ws-1', 28, undefined, false), { wrapper: makeWrapper() });
    expect(mockGscOverview).not.toHaveBeenCalled();
    expect(mockGscTrend).not.toHaveBeenCalled();
    expect(mockGscComparison).not.toHaveBeenCalled();
    expect(mockGscDevices).not.toHaveBeenCalled();
  });

  it('overview defaults to null when disabled', () => {
    const { result } = renderHook(() => useClientSearch('ws-1', 28, undefined, false), { wrapper: makeWrapper() });
    expect(result.current.overview).toBeNull();
  });

  it('trend defaults to empty array when disabled', () => {
    const { result } = renderHook(() => useClientSearch('ws-1', 28, undefined, false), { wrapper: makeWrapper() });
    expect(result.current.trend).toEqual([]);
  });

  it('comparison defaults to null when disabled', () => {
    const { result } = renderHook(() => useClientSearch('ws-1', 28, undefined, false), { wrapper: makeWrapper() });
    expect(result.current.comparison).toBeNull();
  });

  it('devices defaults to empty array when disabled', () => {
    const { result } = renderHook(() => useClientSearch('ws-1', 28, undefined, false), { wrapper: makeWrapper() });
    expect(result.current.devices).toEqual([]);
  });

  it('dataUpdatedAt defaults to null when disabled', () => {
    const { result } = renderHook(() => useClientSearch('ws-1', 28, undefined, false), { wrapper: makeWrapper() });
    expect(result.current.dataUpdatedAt).toBeNull();
  });
});

describe('useClientSearch — successful fetch', () => {
  beforeEach(() => {
    mockGscOverview.mockReset();
    mockGscTrend.mockReset();
    mockGscComparison.mockReset();
    mockGscDevices.mockReset();
  });

  it('returns overview data when all sub-queries resolve', async () => {
    const overview = { totalClicks: 500, totalImpressions: 5000, avgCtr: 0.1, avgPosition: 4.2 };
    mockGscOverview.mockResolvedValue(overview);
    mockGscTrend.mockResolvedValue([]);
    mockGscComparison.mockResolvedValue(null);
    mockGscDevices.mockResolvedValue([]);

    const { result } = renderHook(() => useClientSearch('ws-1', 28, undefined, true), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.overview).toEqual(overview);
  });

  it('returns trend data when fetch succeeds', async () => {
    const trend = [
      { date: '2024-01-01', clicks: 10, impressions: 100, ctr: 0.1, position: 3.5 },
    ];
    mockGscOverview.mockResolvedValue(null);
    mockGscTrend.mockResolvedValue(trend);
    mockGscComparison.mockResolvedValue(null);
    mockGscDevices.mockResolvedValue([]);

    const { result } = renderHook(() => useClientSearch('ws-1', 28, undefined, true), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.trend).toEqual(trend);
  });

  it('returns comparison data when available', async () => {
    const comparison = { current: { clicks: 100 }, previous: { clicks: 80 }, delta: { clicks: 25 } };
    mockGscOverview.mockResolvedValue(null);
    mockGscTrend.mockResolvedValue([]);
    mockGscComparison.mockResolvedValue(comparison);
    mockGscDevices.mockResolvedValue([]);

    const { result } = renderHook(() => useClientSearch('ws-1', 28, undefined, true), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.comparison).toEqual(comparison);
  });

  it('returns devices data when fetch succeeds', async () => {
    const devices = [{ device: 'mobile', clicks: 200 }];
    mockGscOverview.mockResolvedValue(null);
    mockGscTrend.mockResolvedValue([]);
    mockGscComparison.mockResolvedValue(null);
    mockGscDevices.mockResolvedValue(devices);

    const { result } = renderHook(() => useClientSearch('ws-1', 28, undefined, true), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.devices).toEqual(devices);
  });

  it('isLoading is false after all sub-queries succeed', async () => {
    mockGscOverview.mockResolvedValue(null);
    mockGscTrend.mockResolvedValue([]);
    mockGscComparison.mockResolvedValue(null);
    mockGscDevices.mockResolvedValue([]);

    const { result } = renderHook(() => useClientSearch('ws-1', 28, undefined, true), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
  });

  it('exposes overview dataUpdatedAt when primary overview data is present', async () => {
    mockGscOverview.mockResolvedValue({
      totalClicks: 500,
      totalImpressions: 5000,
      avgCtr: 10,
      avgPosition: 4.2,
      topQueries: [],
      topPages: [],
      dateRange: { start: '2026-06-01', end: '2026-06-11' },
    });
    mockGscTrend.mockResolvedValue([]);
    mockGscComparison.mockResolvedValue(null);
    mockGscDevices.mockResolvedValue([]);

    const { result } = renderHook(() => useClientSearch('ws-1', 28, undefined, true), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.dataUpdatedAt).toEqual(expect.any(Number)));
    expect(result.current.dataUpdatedAt).toBeGreaterThan(0);
  });

  it('does not expose freshness when only secondary sub-queries have data', async () => {
    mockGscOverview.mockResolvedValue(null);
    mockGscTrend.mockResolvedValue([
      { date: '2026-06-11', clicks: 10, impressions: 100, ctr: 10, position: 3 },
    ]);
    mockGscComparison.mockResolvedValue(null);
    mockGscDevices.mockResolvedValue([{ device: 'desktop', clicks: 5, impressions: 50, ctr: 10, position: 4 }]);

    const { result } = renderHook(() => useClientSearch('ws-1', 28, undefined, true), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.dataUpdatedAt).toBeNull();
  });

  it('exposes error when a sub-query fails', async () => {
    const err = new Error('GSC unavailable');
    mockGscOverview.mockRejectedValue(err);
    mockGscTrend.mockResolvedValue([]);
    mockGscComparison.mockResolvedValue(null);
    mockGscDevices.mockResolvedValue([]);

    const { result } = renderHook(() => useClientSearch('ws-1', 28, undefined, true), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.error).toBeTruthy());
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// useClientGA4
// ═══════════════════════════════════════════════════════════════════════════════

function resolveAllGA4Mocks() {
  mockGa4Overview.mockResolvedValue(null);
  mockGa4Trend.mockResolvedValue([]);
  mockGa4TopPages.mockResolvedValue([]);
  mockGa4Sources.mockResolvedValue([]);
  mockGa4Devices.mockResolvedValue([]);
  mockGa4Countries.mockResolvedValue([]);
  mockGa4Events.mockResolvedValue([]);
  mockGa4Conversions.mockResolvedValue([]);
  mockGa4Comparison.mockResolvedValue(null);
  mockGa4Nvr.mockResolvedValue([]);
  mockGa4Organic.mockResolvedValue(null);
  mockGa4Landing.mockResolvedValue([]);
}

describe('useClientGA4 — disabled state', () => {
  beforeEach(() => {
    mockGa4Overview.mockReset();
    mockGa4Trend.mockReset();
  });

  it('does not call ga4.overview when enabled is false', () => {
    renderHook(() => useClientGA4('ws-1', 28, undefined, false), { wrapper: makeWrapper() });
    expect(mockGa4Overview).not.toHaveBeenCalled();
  });

  it('does not call ga4.trend when enabled is false', () => {
    renderHook(() => useClientGA4('ws-1', 28, undefined, false), { wrapper: makeWrapper() });
    expect(mockGa4Trend).not.toHaveBeenCalled();
  });

  it('ga4Overview defaults to null when disabled', () => {
    const { result } = renderHook(() => useClientGA4('ws-1', 28, undefined, false), { wrapper: makeWrapper() });
    expect(result.current.ga4Overview).toBeNull();
  });

  it('ga4Trend defaults to empty array when disabled', () => {
    const { result } = renderHook(() => useClientGA4('ws-1', 28, undefined, false), { wrapper: makeWrapper() });
    expect(result.current.ga4Trend).toEqual([]);
  });

  it('ga4Pages defaults to empty array when disabled', () => {
    const { result } = renderHook(() => useClientGA4('ws-1', 28, undefined, false), { wrapper: makeWrapper() });
    expect(result.current.ga4Pages).toEqual([]);
  });

  it('ga4Sources defaults to empty array when disabled', () => {
    const { result } = renderHook(() => useClientGA4('ws-1', 28, undefined, false), { wrapper: makeWrapper() });
    expect(result.current.ga4Sources).toEqual([]);
  });

  it('sectionError is null when disabled', () => {
    const { result } = renderHook(() => useClientGA4('ws-1', 28, undefined, false), { wrapper: makeWrapper() });
    expect(result.current.sectionError).toBeNull();
  });

  it('dataUpdatedAt defaults to null when disabled', () => {
    const { result } = renderHook(() => useClientGA4('ws-1', 28, undefined, false), { wrapper: makeWrapper() });
    expect(result.current.dataUpdatedAt).toBeNull();
  });
});

describe('useClientGA4 — successful fetch', () => {
  beforeEach(() => {
    resolveAllGA4Mocks();
  });

  it('returns ga4Overview data when fetch resolves', async () => {
    const overview = { sessions: 1000, users: 800, pageViews: 2000, bounceRate: 0.4 };
    mockGa4Overview.mockResolvedValue(overview as never);

    const { result } = renderHook(() => useClientGA4('ws-1', 28, undefined, true), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.ga4Overview).toEqual(overview);
  });

  it('returns ga4Trend data when fetch resolves', async () => {
    const trend = [{ date: '2024-01-01', sessions: 100 }];
    mockGa4Trend.mockResolvedValue(trend as never);

    const { result } = renderHook(() => useClientGA4('ws-1', 28, undefined, true), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.ga4Trend).toEqual(trend);
  });

  it('returns ga4Pages data when fetch resolves', async () => {
    const pages = [{ path: '/home', sessions: 500 }];
    mockGa4TopPages.mockResolvedValue(pages as never);

    const { result } = renderHook(() => useClientGA4('ws-1', 28, undefined, true), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.ga4Pages).toEqual(pages);
  });

  it('returns ga4Sources data when fetch resolves', async () => {
    const sources = [{ source: 'google', sessions: 600 }];
    mockGa4Sources.mockResolvedValue(sources as never);

    const { result } = renderHook(() => useClientGA4('ws-1', 28, undefined, true), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.ga4Sources).toEqual(sources);
  });

  it('returns ga4Events data when fetch resolves', async () => {
    const events = [{ eventName: 'click', count: 300 }];
    mockGa4Events.mockResolvedValue(events as never);

    const { result } = renderHook(() => useClientGA4('ws-1', 28, undefined, true), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.ga4Events).toEqual(events);
  });

  it('sectionError is null when all sub-queries succeed', async () => {
    const { result } = renderHook(() => useClientGA4('ws-1', 28, undefined, true), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.sectionError).toBeNull();
  });

  it('exposes overview dataUpdatedAt when primary overview data is present', async () => {
    mockGa4Overview.mockResolvedValue({
      totalUsers: 800,
      totalSessions: 1000,
      totalPageviews: 2000,
      avgSessionDuration: 75,
      bounceRate: 40,
      newUserPercentage: 65,
      dateRange: { start: '2026-06-01', end: '2026-06-11' },
    });

    const { result } = renderHook(() => useClientGA4('ws-1', 28, undefined, true), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.dataUpdatedAt).toEqual(expect.any(Number)));
    expect(result.current.dataUpdatedAt).toBeGreaterThan(0);
  });

  it('does not expose freshness when only secondary GA4 sub-queries have data', async () => {
    mockGa4Overview.mockResolvedValue(null);
    mockGa4Trend.mockResolvedValue([{ date: '2026-06-11', users: 12, sessions: 18, pageviews: 40 }]);
    mockGa4TopPages.mockResolvedValue([
      { path: '/', pageviews: 40, users: 12, sessions: 18, avgEngagementTime: 30 },
    ]);

    const { result } = renderHook(() => useClientGA4('ws-1', 28, undefined, true), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.dataUpdatedAt).toBeNull();
  });
});

describe('useClientGA4 — partial errors', () => {
  beforeEach(() => {
    resolveAllGA4Mocks();
  });

  it('reports partial sectionError when some sub-queries fail', async () => {
    mockGa4Overview.mockRejectedValue(new Error('fail'));

    const { result } = renderHook(() => useClientGA4('ws-1', 28, undefined, true), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.sectionError).toContain('overview');
  });

  it('sectionError says "Unable to load analytics data" when all fail', async () => {
    const err = new Error('all fail');
    mockGa4Overview.mockRejectedValue(err);
    mockGa4Trend.mockRejectedValue(err);
    mockGa4TopPages.mockRejectedValue(err);
    mockGa4Sources.mockRejectedValue(err);
    mockGa4Devices.mockRejectedValue(err);
    mockGa4Countries.mockRejectedValue(err);
    mockGa4Events.mockRejectedValue(err);
    mockGa4Conversions.mockRejectedValue(err);
    mockGa4Comparison.mockRejectedValue(err);
    mockGa4Nvr.mockRejectedValue(err);
    mockGa4Organic.mockRejectedValue(err);
    mockGa4Landing.mockRejectedValue(err);

    const { result } = renderHook(() => useClientGA4('ws-1', 28, undefined, true), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.sectionError).toBe('Unable to load analytics data');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// useClientOutcomeSummary (extra branches beyond client-queries.test.tsx)
// ═══════════════════════════════════════════════════════════════════════════════

describe('useClientOutcomeSummary — additional branches', () => {
  beforeEach(() => {
    mockGetSummary.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('is enabled when wsId is non-empty', async () => {
    mockGetSummary.mockResolvedValue({ winRate: 0.5, totalActions: 10 } as never);
    const { result } = renderHook(() => useClientOutcomeSummary('ws-abc'), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGetSummary).toHaveBeenCalledWith('ws-abc', expect.anything());
  });

  it('isError is true when fetch rejects', async () => {
    mockGetSummary.mockRejectedValue(new Error('network error'));
    const { result } = renderHook(() => useClientOutcomeSummary('ws-err'), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// useClientOutcomeWins (extra branches)
// ═══════════════════════════════════════════════════════════════════════════════

describe('useClientOutcomeWins — additional branches', () => {
  beforeEach(() => {
    mockGetWins.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('is enabled when wsId is non-empty', async () => {
    mockGetWins.mockResolvedValue([{ id: 'w1', title: 'Win #1' }] as never);
    const { result } = renderHook(() => useClientOutcomeWins('ws-abc'), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGetWins).toHaveBeenCalledWith('ws-abc', expect.anything());
  });

  it('returns empty-ish state when wsId is empty', () => {
    renderHook(() => useClientOutcomeWins(''), { wrapper: makeWrapper() });
    expect(mockGetWins).not.toHaveBeenCalled();
  });

  it('isError is true when fetch rejects', async () => {
    mockGetWins.mockRejectedValue(new Error('server error'));
    const { result } = renderHook(() => useClientOutcomeWins('ws-err'), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// useClientPostPreview (extra branches)
// ═══════════════════════════════════════════════════════════════════════════════

describe('useClientPostPreview — extra branches', () => {
  beforeEach(() => {
    mockGetPost.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('does not fetch when postId is empty string', () => {
    renderHook(() => useClientPostPreview('ws-1', '', true), { wrapper: makeWrapper() });
    expect(mockGetPost).not.toHaveBeenCalled();
  });

  it('calls publicPostReview.getPost with correct args when enabled', async () => {
    const post = { id: 'post-99', title: 'Test Post', status: 'post_review', content: 'body' };
    mockGetPost.mockResolvedValue(post as never);

    const { result } = renderHook(() => useClientPostPreview('ws-1', 'post-99', true), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGetPost).toHaveBeenCalledWith('ws-1', 'post-99');
  });

  it('isError is true when fetch rejects', async () => {
    mockGetPost.mockRejectedValue(new Error('not found'));
    const { result } = renderHook(() => useClientPostPreview('ws-1', 'post-bad', true), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it('data is the fetched post on success', async () => {
    const post = { id: 'post-42', title: 'Article 42', status: 'post_review', content: '<p>hi</p>' };
    mockGetPost.mockResolvedValue(post as never);
    const { result } = renderHook(() => useClientPostPreview('ws-1', 'post-42', true), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toMatchObject({ id: 'post-42', title: 'Article 42' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// useClientBriefing
// ═══════════════════════════════════════════════════════════════════════════════

describe('useClientBriefing — disabled state', () => {
  beforeEach(() => mockGetPublished.mockReset());

  it('does not fetch when enabled is false', () => {
    renderHook(() => useClientBriefing('ws-1', false), { wrapper: makeWrapper() });
    expect(mockGetPublished).not.toHaveBeenCalled();
  });

  it('does not fetch when workspaceId is empty string', () => {
    renderHook(() => useClientBriefing('', true), { wrapper: makeWrapper() });
    expect(mockGetPublished).not.toHaveBeenCalled();
  });

  it('does not fetch when both conditions are false', () => {
    renderHook(() => useClientBriefing('', false), { wrapper: makeWrapper() });
    expect(mockGetPublished).not.toHaveBeenCalled();
  });
});

describe('useClientBriefing — successful fetch', () => {
  beforeEach(() => {
    mockGetPublished.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('returns briefing data on success', async () => {
    const briefing = {
      id: 'brief-1',
      workspaceId: 'ws-1',
      publishedAt: '2024-01-08T14:00:00Z',
      stories: [],
    };
    mockGetPublished.mockResolvedValue(briefing as never);

    const { result } = renderHook(() => useClientBriefing('ws-1', true), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(briefing);
  });

  it('returns null when API returns null (no published briefing)', async () => {
    mockGetPublished.mockResolvedValue(null as never);

    const { result } = renderHook(() => useClientBriefing('ws-1', true), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it('calls getPublished with the correct workspaceId', async () => {
    mockGetPublished.mockResolvedValue(null as never);
    renderHook(() => useClientBriefing('ws-briefing-42', true), { wrapper: makeWrapper() });
    await waitFor(() => expect(mockGetPublished).toHaveBeenCalledWith('ws-briefing-42'));
  });

  it('isError is true when fetch rejects', async () => {
    mockGetPublished.mockRejectedValue(new Error('tier gated'));
    const { result } = renderHook(() => useClientBriefing('ws-1', true), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// useAuditSummary
// ═══════════════════════════════════════════════════════════════════════════════

describe('useAuditSummary — disabled when workspaceId is undefined', () => {
  beforeEach(() => mockGetOptional.mockReset());

  it('does not fetch when workspaceId is undefined', () => {
    renderHook(() => useAuditSummary(undefined), { wrapper: makeWrapper() });
    expect(mockGetOptional).not.toHaveBeenCalled();
  });

  it('audit is null when workspaceId is undefined', () => {
    const { result } = renderHook(() => useAuditSummary(undefined), { wrapper: makeWrapper() });
    expect(result.current.audit).toBeNull();
  });

  it('loading is false when workspaceId is undefined', () => {
    const { result } = renderHook(() => useAuditSummary(undefined), { wrapper: makeWrapper() });
    expect(result.current.loading).toBe(false);
  });
});

describe('useAuditSummary — successful fetch', () => {
  beforeEach(() => mockGetOptional.mockReset());

  it('returns audit data when API resolves with valid data', async () => {
    const auditData = {
      id: 'audit-1',
      siteScore: 85,
      totalPages: 42,
      errors: 1,
      warnings: 3,
      infos: 10,
    };
    mockGetOptional.mockResolvedValue(auditData as never);

    const { result } = renderHook(() => useAuditSummary('ws-1'), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.audit).toEqual(auditData);
  });

  it('returns null when API returns data without id field', async () => {
    mockGetOptional.mockResolvedValue({ siteScore: 80 } as never);

    const { result } = renderHook(() => useAuditSummary('ws-1'), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.audit).toBeNull();
  });

  it('returns null when API returns null', async () => {
    mockGetOptional.mockResolvedValue(null as never);

    const { result } = renderHook(() => useAuditSummary('ws-1'), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.audit).toBeNull();
  });

  it('error is null when audit data has an id field', async () => {
    // Verify the successful path explicitly sets error to null
    mockGetOptional.mockResolvedValue({ id: 'audit-ok', siteScore: 92 } as never);

    const { result } = renderHook(() => useAuditSummary('ws-ok'), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.loading).toBe(false));
    // On success there is no error string
    expect(result.current.error).toBeNull();
  });

  it('error is null on success', async () => {
    mockGetOptional.mockResolvedValue({ id: 'a1', siteScore: 90 } as never);

    const { result } = renderHook(() => useAuditSummary('ws-1'), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeNull();
  });

  it('exposes a refresh function', () => {
    const { result } = renderHook(() => useAuditSummary('ws-1'), { wrapper: makeWrapper() });
    expect(typeof result.current.refresh).toBe('function');
  });

  it('refresh does not throw when called', async () => {
    mockGetOptional.mockResolvedValue({ id: 'a2', siteScore: 75 } as never);

    const { result } = renderHook(() => useAuditSummary('ws-1'), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(() => {
      act(() => { result.current.refresh(); });
    }).not.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// useWsInvalidation
// ═══════════════════════════════════════════════════════════════════════════════

// useWsInvalidation — useWorkspaceEvents wraps subscribeWorkspaceEvents,
// passing a listener object { onMessage }. To invoke a specific event handler,
// call listener.onMessage({ event: '<event-name>', data: {} }).
// The handlers Record passed to useWorkspaceEvents is stored in handlersRef
// and dispatched by event name inside onMessage.

type WsListener = { onMessage: (msg: { event: string; data?: unknown }) => void; getIdentity?: () => unknown };

function getWsListener(): WsListener {
  const calls = mockSubscribe.mock.calls;
  const lastCall = calls[calls.length - 1];
  return lastCall[1] as WsListener;
}

describe('useWsInvalidation', () => {
  beforeEach(() => {
    mockSubscribe.mockReset();
    mockSubscribe.mockReturnValue(() => {});
  });

  it('calls subscribeWorkspaceEvents with the given workspaceId', () => {
    renderHook(() => useWsInvalidation('ws-inv-1'), { wrapper: makeWrapper() });
    expect(mockSubscribe).toHaveBeenCalledWith('ws-inv-1', expect.any(Object));
  });

  it('does not call subscribeWorkspaceEvents when workspaceId is undefined', () => {
    renderHook(() => useWsInvalidation(undefined), { wrapper: makeWrapper() });
    expect(mockSubscribe).not.toHaveBeenCalled();
  });

  it('the listener has an onMessage function', () => {
    renderHook(() => useWsInvalidation('ws-inv-2'), { wrapper: makeWrapper() });
    const listener = getWsListener();
    expect(typeof listener.onMessage).toBe('function');
  });

  it('approval:update event triggers invalidation via onMessage', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = vi.spyOn(qc, 'invalidateQueries').mockResolvedValue();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );

    renderHook(() => useWsInvalidation('ws-inv-3'), { wrapper });

    const listener = getWsListener();
    expect(() => {
      listener.onMessage({ event: 'approval:update', data: {} });
    }).not.toThrow();
    expect(invalidate).toHaveBeenCalled();
  });

  it('approval:applied event triggers invalidation', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = vi.spyOn(qc, 'invalidateQueries').mockResolvedValue();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );

    renderHook(() => useWsInvalidation('ws-inv-4'), { wrapper });
    const listener = getWsListener();
    listener.onMessage({ event: 'approval:applied', data: {} });
    expect(invalidate).toHaveBeenCalled();
  });

  it('audit:complete event triggers multiple invalidations', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = vi.spyOn(qc, 'invalidateQueries').mockResolvedValue();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );

    renderHook(() => useWsInvalidation('ws-inv-5'), { wrapper });
    const listener = getWsListener();
    listener.onMessage({ event: 'audit:complete', data: {} });
    // Expect several query keys invalidated for audit, intelligence, admin, client
    expect(invalidate.mock.calls.length).toBeGreaterThan(3);
  });

  it('outcome:scored event triggers invalidation', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = vi.spyOn(qc, 'invalidateQueries').mockResolvedValue();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );

    renderHook(() => useWsInvalidation('ws-inv-6'), { wrapper });
    const listener = getWsListener();
    listener.onMessage({ event: 'outcome:scored', data: {} });
    expect(invalidate).toHaveBeenCalled();
  });

  it('activity:new event triggers invalidation', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = vi.spyOn(qc, 'invalidateQueries').mockResolvedValue();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );

    renderHook(() => useWsInvalidation('ws-inv-7'), { wrapper });
    const listener = getWsListener();
    listener.onMessage({ event: 'activity:new', data: {} });
    expect(invalidate).toHaveBeenCalled();
  });

  it('intelligence:cache_updated event triggers invalidation', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = vi.spyOn(qc, 'invalidateQueries').mockResolvedValue();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );

    renderHook(() => useWsInvalidation('ws-inv-8'), { wrapper });
    const listener = getWsListener();
    listener.onMessage({ event: 'intelligence:cache_updated', data: {} });
    expect(invalidate).toHaveBeenCalled();
  });

  it('content:updated event triggers multiple invalidations', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = vi.spyOn(qc, 'invalidateQueries').mockResolvedValue();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );

    renderHook(() => useWsInvalidation('ws-inv-9'), { wrapper });
    const listener = getWsListener();
    listener.onMessage({ event: 'content:updated', data: {} });
    expect(invalidate.mock.calls.length).toBeGreaterThan(3);
  });

  it('unknown event does not trigger any invalidation', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = vi.spyOn(qc, 'invalidateQueries').mockResolvedValue();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );

    renderHook(() => useWsInvalidation('ws-inv-10'), { wrapper });
    const listener = getWsListener();
    listener.onMessage({ event: 'totally:unknown', data: {} });
    expect(invalidate).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// useDeepLinkFocus
// ═══════════════════════════════════════════════════════════════════════════════

describe('useDeepLinkFocus — no focus param', () => {
  beforeEach(() => {
    mockSearchParamsValue = new URLSearchParams();
    mockSetSearchParams.mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not call setSearchParams when no focus param is present', () => {
    renderHook(() => useDeepLinkFocus());
    vi.advanceTimersByTime(100);
    expect(mockSetSearchParams).not.toHaveBeenCalled();
  });

  it('does not throw when mounted without focus param', () => {
    expect(() => {
      renderHook(() => useDeepLinkFocus());
    }).not.toThrow();
  });
});

describe('useDeepLinkFocus — with focus param, no matching element', () => {
  beforeEach(() => {
    mockSearchParamsValue = new URLSearchParams('focus=some-field');
    mockSetSearchParams.mockReset();
    vi.useFakeTimers();
    // Ensure document.querySelector returns null
    vi.spyOn(document, 'querySelector').mockReturnValue(null);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('does not call setSearchParams when no matching element is found', () => {
    renderHook(() => useDeepLinkFocus());
    act(() => { vi.advanceTimersByTime(100); });
    expect(mockSetSearchParams).not.toHaveBeenCalled();
  });
});

describe('useDeepLinkFocus — with focus param and matching element', () => {
  beforeEach(() => {
    mockSearchParamsValue = new URLSearchParams('focus=target-field');
    mockSetSearchParams.mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('calls setSearchParams to remove focus param after matching element found', () => {
    const mockEl = document.createElement('div');
    mockEl.tabIndex = 0;
    mockEl.scrollIntoView = vi.fn();
    vi.spyOn(document, 'querySelector').mockReturnValue(mockEl);

    renderHook(() => useDeepLinkFocus());
    act(() => { vi.advanceTimersByTime(100); });

    expect(mockSetSearchParams).toHaveBeenCalledWith(expect.any(Function), { replace: true });
  });

  it('calls scrollIntoView on the matched element', () => {
    const mockEl = document.createElement('div');
    const scrollSpy = vi.fn();
    mockEl.scrollIntoView = scrollSpy;
    vi.spyOn(document, 'querySelector').mockReturnValue(mockEl);

    renderHook(() => useDeepLinkFocus());
    act(() => { vi.advanceTimersByTime(100); });

    expect(scrollSpy).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' });
  });

  it('calls focus() on a matched input element', () => {
    const input = document.createElement('input');
    const focusSpy = vi.fn();
    input.focus = focusSpy;
    input.scrollIntoView = vi.fn();
    vi.spyOn(document, 'querySelector').mockReturnValue(input);

    renderHook(() => useDeepLinkFocus());
    act(() => { vi.advanceTimersByTime(100); });

    expect(focusSpy).toHaveBeenCalledWith({ preventScroll: true });
  });

  it('calls focus() on a matched textarea element', () => {
    const textarea = document.createElement('textarea');
    const focusSpy = vi.fn();
    textarea.focus = focusSpy;
    textarea.scrollIntoView = vi.fn();
    vi.spyOn(document, 'querySelector').mockReturnValue(textarea);

    renderHook(() => useDeepLinkFocus());
    act(() => { vi.advanceTimersByTime(100); });

    expect(focusSpy).toHaveBeenCalledWith({ preventScroll: true });
  });
});
