/**
 * tests/unit/hooks/admin-queries-d.test.tsx
 *
 * Smoke tests for admin hooks:
 *   useAdminSeo (useAuditTrafficMap, useAuditSuppressions, useAuditSchedule, useSchemaSnapshot, useWebflowPages)
 *   useSeoEditor
 *   useWorkspaces (useWorkspaces, useCreateWorkspace, useDeleteWorkspace)
 *   useAnalyticsOverview (composite — mocks sub-hook API deps)
 *   useIntelligenceSignals
 *   useClientSignals (useClientSignals, useUpdateSignalStatus)
 *   useCmsEditor (useCmsEditor, useCmsCollections)
 *
 * Runs in the `component` vitest project (jsdom environment).
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';

// ── Standard wrapper ─────────────────────────────────────────────────────────

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

// ── Mock: src/api/client ─────────────────────────────────────────────────────

vi.mock('../../../src/api/client', () => ({
  get: vi.fn(),
  getSafe: vi.fn(),
  getOptional: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
}));

import { get, getSafe, getOptional, post, patch, del } from '../../../src/api/client';
const mockGet = vi.mocked(get);
const mockGetSafe = vi.mocked(getSafe);
const mockGetOptional = vi.mocked(getOptional);
const mockPost = vi.mocked(post);
const mockPatch = vi.mocked(patch);
const mockDel = vi.mocked(del);

// ── Mock: src/api/analytics (for useAnalyticsOverview sub-hooks) ─────────────

vi.mock('../../../src/api/analytics', () => ({
  gscAdmin: {
    overview: vi.fn(),
    trend: vi.fn(),
    devices: vi.fn(),
    countries: vi.fn(),
    searchTypes: vi.fn(),
    comparison: vi.fn(),
  },
  ga4: {
    overview: vi.fn(),
    trend: vi.fn(),
    topPages: vi.fn(),
    sources: vi.fn(),
    devices: vi.fn(),
    countries: vi.fn(),
    comparison: vi.fn(),
    newVsReturning: vi.fn(),
    organic: vi.fn(),
    landingPages: vi.fn(),
    conversions: vi.fn(),
    events: vi.fn(),
  },
  fetchClientIntelligence: vi.fn(),
}));

import { gscAdmin, ga4 } from '../../../src/api/analytics';
const mockGscOverview = vi.mocked(gscAdmin.overview);
const mockGscTrend = vi.mocked(gscAdmin.trend);
const mockGscDevices = vi.mocked(gscAdmin.devices);
const mockGscCountries = vi.mocked(gscAdmin.countries);
const mockGscSearchTypes = vi.mocked(gscAdmin.searchTypes);
const mockGscComparison = vi.mocked(gscAdmin.comparison);
const mockGa4Overview = vi.mocked(ga4.overview);
const mockGa4Trend = vi.mocked(ga4.trend);
const mockGa4TopPages = vi.mocked(ga4.topPages);
const mockGa4Sources = vi.mocked(ga4.sources);
const mockGa4Devices = vi.mocked(ga4.devices);
const mockGa4Countries = vi.mocked(ga4.countries);
const mockGa4Comparison = vi.mocked(ga4.comparison);
const mockGa4NewVsReturning = vi.mocked(ga4.newVsReturning);
const mockGa4Organic = vi.mocked(ga4.organic);
const mockGa4LandingPages = vi.mocked(ga4.landingPages);
const mockGa4Conversions = vi.mocked(ga4.conversions);

// ── Mock: src/api/misc (for useAnalyticsAnnotations) ─────────────────────────

vi.mock('../../../src/api/misc', () => ({
  analyticsAnnotations: {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  },
  annotations: {
    list: vi.fn(),
  },
  publicActivity: {
    list: vi.fn(),
  },
}));

import { analyticsAnnotations } from '../../../src/api/misc';
const mockAnnotationsList = vi.mocked(analyticsAnnotations.list);

// ── Hook imports ─────────────────────────────────────────────────────────────

import {
  useAuditTrafficMap,
  useAuditSuppressions,
  useAuditSchedule,
  useSchemaSnapshot,
  useWebflowPages,
} from '../../../src/hooks/admin/useAdminSeo';
import { useSeoEditor } from '../../../src/hooks/admin/useSeoEditor';
import {
  useWorkspaces,
  useCreateWorkspace,
  useDeleteWorkspace,
} from '../../../src/hooks/admin/useWorkspaces';
import { useAnalyticsOverview } from '../../../src/hooks/admin/useAnalyticsOverview';
import { useIntelligenceSignals } from '../../../src/hooks/admin/useIntelligenceSignals';
import {
  useClientSignals,
  useUpdateSignalStatus,
} from '../../../src/hooks/admin/useClientSignals';
import { useCmsEditor, useCmsCollections } from '../../../src/hooks/admin/useCmsEditor';

// ── useAuditTrafficMap ────────────────────────────────────────────────────────

describe('useAuditTrafficMap', () => {
  beforeEach(() => { mockGetOptional.mockReset(); });

  it('is disabled when siteId is undefined', () => {
    const { result } = renderHook(
      () => useAuditTrafficMap(undefined, 'ws-1'),
      { wrapper: makeWrapper() },
    );
    expect(result.current.data).toBeUndefined();
    expect(result.current.isLoading).toBe(false);
    expect(mockGetOptional).not.toHaveBeenCalled();
  });

  it('is disabled when workspaceId is undefined', () => {
    const { result } = renderHook(
      () => useAuditTrafficMap('site-1', undefined),
      { wrapper: makeWrapper() },
    );
    expect(result.current.data).toBeUndefined();
    expect(result.current.isLoading).toBe(false);
  });

  it('enters loading state when both siteId and workspaceId are provided', () => {
    mockGetOptional.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(
      () => useAuditTrafficMap('site-1', 'ws-1'),
      { wrapper: makeWrapper() },
    );
    expect(result.current.isLoading).toBe(true);
  });

  it('returns traffic map data when API resolves with data', async () => {
    const trafficMap = {
      '/home': { clicks: 100, impressions: 1000, sessions: 80, pageviews: 200 },
      '/about': { clicks: 50, impressions: 500, sessions: 40, pageviews: 100 },
    };
    mockGetOptional.mockResolvedValue(trafficMap);
    const { result } = renderHook(
      () => useAuditTrafficMap('site-1', 'ws-1'),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.data).toEqual(trafficMap));
  });

  it('returns empty object when API resolves with null', async () => {
    mockGetOptional.mockResolvedValue(null);
    const { result } = renderHook(
      () => useAuditTrafficMap('site-1', 'ws-1'),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.data).toEqual({}));
  });

  it('sets error state when API rejects', async () => {
    mockGetOptional.mockRejectedValue(new Error('network error'));
    const { result } = renderHook(
      () => useAuditTrafficMap('site-1', 'ws-1'),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

// ── useAuditSuppressions ──────────────────────────────────────────────────────

describe('useAuditSuppressions', () => {
  beforeEach(() => { mockGetSafe.mockReset(); });

  it('is disabled when workspaceId is undefined', () => {
    const { result } = renderHook(
      () => useAuditSuppressions(undefined),
      { wrapper: makeWrapper() },
    );
    expect(result.current.data).toBeUndefined();
    expect(result.current.isLoading).toBe(false);
  });

  it('enters loading state when workspaceId is provided', () => {
    mockGetSafe.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(
      () => useAuditSuppressions('ws-1'),
      { wrapper: makeWrapper() },
    );
    expect(result.current.isLoading).toBe(true);
  });

  it('returns suppression list when API resolves', async () => {
    const suppressions = [
      { check: 'missing-title', pageSlug: '/home' },
      { check: 'duplicate-meta', pageSlug: '/about', pagePattern: '/about*' },
    ];
    mockGetSafe.mockResolvedValue(suppressions);
    const { result } = renderHook(
      () => useAuditSuppressions('ws-1'),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.data).toEqual(suppressions));
  });

  it('returns empty array when API resolves with non-array', async () => {
    mockGetSafe.mockResolvedValue(null as never);
    const { result } = renderHook(
      () => useAuditSuppressions('ws-1'),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.data).toEqual([]));
  });
});

// ── useAuditSchedule ──────────────────────────────────────────────────────────

describe('useAuditSchedule', () => {
  beforeEach(() => { mockGetOptional.mockReset(); });

  it('is disabled when workspaceId is undefined', () => {
    const { result } = renderHook(
      () => useAuditSchedule(undefined),
      { wrapper: makeWrapper() },
    );
    expect(result.current.data).toBeUndefined();
    expect(result.current.isLoading).toBe(false);
  });

  it('enters loading state when workspaceId is provided', () => {
    mockGetOptional.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(
      () => useAuditSchedule('ws-1'),
      { wrapper: makeWrapper() },
    );
    expect(result.current.isLoading).toBe(true);
  });

  it('returns null when API resolves with null', async () => {
    mockGetOptional.mockResolvedValue(null);
    const { result } = renderHook(
      () => useAuditSchedule('ws-1'),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.data).toBeNull());
  });

  it('returns schedule data when API resolves', async () => {
    const schedule = {
      enabled: true,
      intervalDays: 7,
      scoreDropThreshold: 10,
      lastRunAt: '2024-01-01T00:00:00Z',
      lastScore: 85,
    };
    mockGetOptional.mockResolvedValue(schedule);
    const { result } = renderHook(
      () => useAuditSchedule('ws-1'),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.data).toEqual(schedule));
  });
});

// ── useSchemaSnapshot ─────────────────────────────────────────────────────────

describe('useSchemaSnapshot', () => {
  beforeEach(() => { mockGet.mockReset(); });

  it('is disabled when siteId is empty string', () => {
    const { result } = renderHook(
      () => useSchemaSnapshot(''),
      { wrapper: makeWrapper() },
    );
    expect(result.current.data).toBeUndefined();
    expect(result.current.isLoading).toBe(false);
  });

  it('enters loading state when siteId is provided', () => {
    mockGet.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(
      () => useSchemaSnapshot('site-1'),
      { wrapper: makeWrapper() },
    );
    expect(result.current.isLoading).toBe(true);
  });

  it('returns null when API resolves with empty results', async () => {
    mockGet.mockResolvedValue({ results: [], createdAt: null });
    const { result } = renderHook(
      () => useSchemaSnapshot('site-1'),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.data).toBeNull());
  });

  it('returns snapshot data when API resolves with results', async () => {
    const snapshot = {
      results: [
        {
          pageId: 'p1',
          pageTitle: 'Home',
          slug: '/',
          url: 'https://example.com/',
          existingSchemas: [],
          suggestedSchemas: [{ type: 'WebSite', reason: 'Main page', priority: 'high' as const, template: {} }],
        },
      ],
      createdAt: '2024-01-01T00:00:00Z',
    };
    mockGet.mockResolvedValue(snapshot);
    const { result } = renderHook(
      () => useSchemaSnapshot('site-1'),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.data).toEqual(snapshot));
  });

  it('returns null when API throws', async () => {
    mockGet.mockRejectedValue(new Error('server error'));
    const { result } = renderHook(
      () => useSchemaSnapshot('site-1'),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.data).toBeNull());
  });
});

// ── useWebflowPages ───────────────────────────────────────────────────────────

describe('useWebflowPages', () => {
  beforeEach(() => { mockGetSafe.mockReset(); });

  it('is disabled when siteId is empty string', () => {
    const { result } = renderHook(
      () => useWebflowPages(''),
      { wrapper: makeWrapper() },
    );
    expect(result.current.data).toBeUndefined();
    expect(result.current.isLoading).toBe(false);
  });

  it('enters loading state when siteId is provided', () => {
    mockGetSafe.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(
      () => useWebflowPages('site-1'),
      { wrapper: makeWrapper() },
    );
    expect(result.current.isLoading).toBe(true);
  });

  it('returns mapped pages when API resolves', async () => {
    const rawPages = [
      { _id: 'p1', title: 'Home', slug: 'home' },
      { id: 'p2', title: 'About', slug: 'about' },
    ];
    mockGetSafe.mockResolvedValue(rawPages);
    const { result } = renderHook(
      () => useWebflowPages('site-1'),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => {
      expect(result.current.data).toEqual([
        { id: 'p1', title: 'Home', slug: 'home' },
        { id: 'p2', title: 'About', slug: 'about' },
      ]);
    });
  });

  it('returns empty array when API resolves with non-array', async () => {
    mockGetSafe.mockResolvedValue(null as never);
    const { result } = renderHook(
      () => useWebflowPages('site-1'),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.data).toEqual([]));
  });
});

// ── useSeoEditor ──────────────────────────────────────────────────────────────

describe('useSeoEditor', () => {
  beforeEach(() => { mockGet.mockReset(); });

  it('is disabled when siteId is empty string', () => {
    const { result } = renderHook(
      () => useSeoEditor(''),
      { wrapper: makeWrapper() },
    );
    expect(result.current.data).toBeUndefined();
    expect(result.current.isLoading).toBe(false);
  });

  it('enters loading state when siteId is provided', () => {
    mockGet.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(
      () => useSeoEditor('site-1'),
      { wrapper: makeWrapper() },
    );
    expect(result.current.isLoading).toBe(true);
  });

  it('returns page metadata when API resolves', async () => {
    const pages = [
      { id: 'p1', title: 'Home', slug: '/', source: 'static' as const },
      { id: 'p2', title: 'Blog', slug: '/blog', source: 'cms' as const, collectionId: 'col-1' },
    ];
    mockGet.mockResolvedValue(pages);
    const { result } = renderHook(
      () => useSeoEditor('site-1'),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.data).toEqual(pages));
  });

  it('returns empty array when API resolves with non-array', async () => {
    mockGet.mockResolvedValue(null as never);
    const { result } = renderHook(
      () => useSeoEditor('site-1'),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.data).toEqual([]));
  });

  it('includes workspaceId in the request when provided', async () => {
    mockGet.mockResolvedValue([]);
    const { result } = renderHook(
      () => useSeoEditor('site-1', 'ws-42'),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith(expect.stringContaining('ws-42'));
  });

  it('data is undefined before fetch resolves', () => {
    mockGet.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(
      () => useSeoEditor('site-1'),
      { wrapper: makeWrapper() },
    );
    expect(result.current.data).toBeUndefined();
  });
});

// ── useWorkspaces ─────────────────────────────────────────────────────────────

describe('useWorkspaces', () => {
  beforeEach(() => { mockGet.mockReset(); });

  it('enters loading state on mount (no enabled guard)', () => {
    mockGet.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useWorkspaces(), { wrapper: makeWrapper() });
    expect(result.current.isLoading).toBe(true);
  });

  it('returns sorted workspace list when API resolves', async () => {
    const workspaces = [
      { id: 'ws-2', name: 'Zebra Corp' },
      { id: 'ws-1', name: 'Acme Inc' },
    ];
    mockGet.mockResolvedValue(workspaces);
    const { result } = renderHook(() => useWorkspaces(), { wrapper: makeWrapper() });
    await waitFor(() => {
      expect(result.current.data).toEqual([
        { id: 'ws-1', name: 'Acme Inc' },
        { id: 'ws-2', name: 'Zebra Corp' },
      ]);
    });
  });

  it('data is undefined before fetch resolves', () => {
    mockGet.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useWorkspaces(), { wrapper: makeWrapper() });
    expect(result.current.data).toBeUndefined();
  });

  it('sets error state when API rejects', async () => {
    mockGet.mockRejectedValue(new Error('unauthorized'));
    const { result } = renderHook(() => useWorkspaces(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

// ── useCreateWorkspace ────────────────────────────────────────────────────────

describe('useCreateWorkspace', () => {
  beforeEach(() => { mockPost.mockReset(); mockGet.mockReset(); });

  it('exposes mutate function', () => {
    mockGet.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useCreateWorkspace(), { wrapper: makeWrapper() });
    expect(typeof result.current.mutate).toBe('function');
  });

  it('is idle before mutation is called', () => {
    const { result } = renderHook(() => useCreateWorkspace(), { wrapper: makeWrapper() });
    expect(result.current.isIdle).toBe(true);
    expect(result.current.isPending).toBe(false);
  });
});

// ── useDeleteWorkspace ────────────────────────────────────────────────────────

describe('useDeleteWorkspace', () => {
  beforeEach(() => { mockDel.mockReset(); mockGet.mockReset(); });

  it('exposes mutate function', () => {
    const { result } = renderHook(() => useDeleteWorkspace(), { wrapper: makeWrapper() });
    expect(typeof result.current.mutate).toBe('function');
  });

  it('is idle before mutation is called', () => {
    const { result } = renderHook(() => useDeleteWorkspace(), { wrapper: makeWrapper() });
    expect(result.current.isIdle).toBe(true);
  });
});

// ── useAnalyticsOverview ──────────────────────────────────────────────────────

describe('useAnalyticsOverview', () => {
  beforeEach(() => {
    mockGscOverview.mockReset();
    mockGscTrend.mockReset();
    mockGscDevices.mockReset();
    mockGscCountries.mockReset();
    mockGscSearchTypes.mockReset();
    mockGscComparison.mockReset();
    mockGa4Overview.mockReset();
    mockGa4Trend.mockReset();
    mockGa4TopPages.mockReset();
    mockGa4Sources.mockReset();
    mockGa4Devices.mockReset();
    mockGa4Countries.mockReset();
    mockGa4Comparison.mockReset();
    mockGa4NewVsReturning.mockReset();
    mockGa4Organic.mockReset();
    mockGa4LandingPages.mockReset();
    mockGa4Conversions.mockReset();
    mockAnnotationsList.mockReset();
  });

  it('returns zero defaults when no GSC/GA4 property configured', () => {
    mockAnnotationsList.mockResolvedValue([]);
    const { result } = renderHook(
      () => useAnalyticsOverview('ws-1', undefined, undefined, undefined, 28),
      { wrapper: makeWrapper() },
    );
    expect(result.current.gscClicks).toBe(0);
    expect(result.current.gscImpressions).toBe(0);
    expect(result.current.ga4Users).toBe(0);
    expect(result.current.ga4Sessions).toBe(0);
    expect(result.current.hasGsc).toBe(false);
    expect(result.current.hasGa4).toBe(false);
  });

  it('exposes isLoading, trendData, annotations, createAnnotation', () => {
    mockAnnotationsList.mockResolvedValue([]);
    const { result } = renderHook(
      () => useAnalyticsOverview('ws-1', 'site-1', undefined, undefined, 28),
      { wrapper: makeWrapper() },
    );
    expect(typeof result.current.isLoading).toBe('boolean');
    expect(Array.isArray(result.current.trendData)).toBe(true);
    expect(Array.isArray(result.current.annotations)).toBe(true);
    expect(typeof result.current.createAnnotation.mutate).toBe('function');
  });

  it('returns empty trendData when both GSC and GA4 are disabled', () => {
    mockAnnotationsList.mockResolvedValue([]);
    const { result } = renderHook(
      () => useAnalyticsOverview('ws-1', undefined, undefined, undefined, 28),
      { wrapper: makeWrapper() },
    );
    expect(result.current.trendData).toEqual([]);
  });

  it('shows annotations when they load', async () => {
    const annotations = [
      { id: 'a1', workspaceId: 'ws-1', date: '2024-01-15', label: 'Launch', category: 'release', createdAt: '2024-01-15T00:00:00Z' },
    ];
    mockAnnotationsList.mockResolvedValue(annotations);
    const { result } = renderHook(
      () => useAnalyticsOverview('ws-1', undefined, undefined, undefined, 28),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.annotations).toEqual(annotations));
  });
});

// ── useIntelligenceSignals ────────────────────────────────────────────────────

describe('useIntelligenceSignals', () => {
  beforeEach(() => { mockGetSafe.mockReset(); });

  it('is disabled when workspaceId is empty string', () => {
    const { result } = renderHook(
      () => useIntelligenceSignals(''),
      { wrapper: makeWrapper() },
    );
    expect(result.current.data).toBeUndefined();
    expect(result.current.isLoading).toBe(false);
    expect(mockGetSafe).not.toHaveBeenCalled();
  });

  it('enters loading state when workspaceId is provided', () => {
    mockGetSafe.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(
      () => useIntelligenceSignals('ws-1'),
      { wrapper: makeWrapper() },
    );
    expect(result.current.isLoading).toBe(true);
  });

  it('returns signals data when API resolves', async () => {
    const payload = {
      signals: [
        { id: 's1', type: 'momentum_keyword', keyword: 'seo audit', score: 0.85 },
        { id: 's2', type: 'content_gap', keyword: 'technical seo', score: 0.72 },
      ],
    };
    mockGetSafe.mockResolvedValue(payload);
    const { result } = renderHook(
      () => useIntelligenceSignals('ws-1'),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.data).toEqual(payload));
  });

  it('returns empty signals when API resolves with empty array', async () => {
    const payload = { signals: [] };
    mockGetSafe.mockResolvedValue(payload);
    const { result } = renderHook(
      () => useIntelligenceSignals('ws-1'),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.data).toEqual(payload));
  });

  it('sets error state when API rejects', async () => {
    mockGetSafe.mockRejectedValue(new Error('server error'));
    const { result } = renderHook(
      () => useIntelligenceSignals('ws-1'),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

// ── useClientSignals ──────────────────────────────────────────────────────────

describe('useClientSignals', () => {
  beforeEach(() => { mockGet.mockReset(); });

  it('is disabled when workspaceId is undefined', () => {
    const { result } = renderHook(
      () => useClientSignals(undefined),
      { wrapper: makeWrapper() },
    );
    expect(result.current.data).toBeUndefined();
    expect(result.current.isLoading).toBe(false);
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('is disabled when workspaceId is empty string', () => {
    const { result } = renderHook(
      () => useClientSignals(''),
      { wrapper: makeWrapper() },
    );
    expect(result.current.data).toBeUndefined();
    expect(result.current.isLoading).toBe(false);
  });

  it('enters loading state when workspaceId is provided', () => {
    mockGet.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(
      () => useClientSignals('ws-1'),
      { wrapper: makeWrapper() },
    );
    expect(result.current.isLoading).toBe(true);
  });

  it('returns signal list when API resolves', async () => {
    const signals = [
      { id: 'sig-1', workspaceId: 'ws-1', type: 'content_interest', status: 'new', triggerMessage: 'tell me about SEO' },
      { id: 'sig-2', workspaceId: 'ws-1', type: 'service_interest', status: 'reviewed', triggerMessage: 'pricing?' },
    ];
    mockGet.mockResolvedValue(signals);
    const { result } = renderHook(
      () => useClientSignals('ws-1'),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.data).toEqual(signals));
  });

  it('sets error state when API rejects', async () => {
    mockGet.mockRejectedValue(new Error('not found'));
    const { result } = renderHook(
      () => useClientSignals('ws-1'),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

// ── useUpdateSignalStatus ─────────────────────────────────────────────────────

describe('useUpdateSignalStatus', () => {
  beforeEach(() => { mockPatch.mockReset(); });

  it('exposes mutate function', () => {
    const { result } = renderHook(
      () => useUpdateSignalStatus('ws-1'),
      { wrapper: makeWrapper() },
    );
    expect(typeof result.current.mutate).toBe('function');
  });

  it('is idle before mutation is called', () => {
    const { result } = renderHook(
      () => useUpdateSignalStatus('ws-1'),
      { wrapper: makeWrapper() },
    );
    expect(result.current.isIdle).toBe(true);
    expect(result.current.isPending).toBe(false);
  });

  it('is also available when workspaceId is undefined', () => {
    const { result } = renderHook(
      () => useUpdateSignalStatus(undefined),
      { wrapper: makeWrapper() },
    );
    expect(typeof result.current.mutate).toBe('function');
  });
});

// ── useCmsEditor ──────────────────────────────────────────────────────────────

describe('useCmsEditor', () => {
  beforeEach(() => { mockGet.mockReset(); mockGetSafe.mockReset(); });

  it('is disabled when siteId is empty string', () => {
    const { result } = renderHook(
      () => useCmsEditor(''),
      { wrapper: makeWrapper() },
    );
    expect(result.current.data).toBeUndefined();
    expect(result.current.isLoading).toBe(false);
  });

  it('enters loading state when siteId is provided', () => {
    mockGet.mockReturnValue(new Promise(() => {}));
    mockGetSafe.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(
      () => useCmsEditor('site-1', 'ws-1'),
      { wrapper: makeWrapper() },
    );
    expect(result.current.isLoading).toBe(true);
  });

  it('returns combined collections and approval batches when both resolve', async () => {
    const collections = [
      {
        collectionId: 'col-1',
        collectionName: 'Blog Posts',
        collectionSlug: 'blog-posts',
        seoFields: [],
        items: [],
        total: 0,
      },
    ];
    const approvalBatches = [
      {
        id: 'batch-1',
        workspaceId: 'ws-1',
        siteId: 'site-1',
        name: 'SEO Update',
        items: [],
        status: 'pending',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      },
    ];
    mockGet.mockResolvedValue(collections);
    mockGetSafe.mockResolvedValue(approvalBatches);
    const { result } = renderHook(
      () => useCmsEditor('site-1', 'ws-1'),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => {
      expect(result.current.data?.collections).toEqual(collections);
      expect(result.current.data?.approvalBatches).toEqual(approvalBatches);
    });
  });

  it('returns empty arrays when both API calls fail', async () => {
    mockGet.mockRejectedValue(new Error('cms error'));
    mockGetSafe.mockRejectedValue(new Error('approvals error'));
    const { result } = renderHook(
      () => useCmsEditor('site-1', 'ws-1'),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => {
      expect(result.current.data?.collections).toEqual([]);
      expect(result.current.data?.approvalBatches).toEqual([]);
    });
  });

  it('returns empty approvalBatches array when no workspaceId', async () => {
    const collections = [
      {
        collectionId: 'col-1',
        collectionName: 'Blog Posts',
        collectionSlug: 'blog-posts',
        seoFields: [],
        items: [],
        total: 0,
      },
    ];
    mockGet.mockResolvedValue(collections);
    const { result } = renderHook(
      () => useCmsEditor('site-1'),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => {
      expect(result.current.data?.collections).toEqual(collections);
      expect(result.current.data?.approvalBatches).toEqual([]);
    });
  });
});

// ── useCmsCollections ─────────────────────────────────────────────────────────

describe('useCmsCollections', () => {
  beforeEach(() => { mockGet.mockReset(); });

  it('is disabled when siteId is empty string', () => {
    const { result } = renderHook(
      () => useCmsCollections(''),
      { wrapper: makeWrapper() },
    );
    expect(result.current.data).toBeUndefined();
    expect(result.current.isLoading).toBe(false);
  });

  it('enters loading state when siteId is provided', () => {
    mockGet.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(
      () => useCmsCollections('site-1'),
      { wrapper: makeWrapper() },
    );
    expect(result.current.isLoading).toBe(true);
  });

  it('returns collections when API resolves', async () => {
    const collections = [
      {
        collectionId: 'col-1',
        collectionName: 'Products',
        collectionSlug: 'products',
        seoFields: [{ id: 'f1', slug: 'seo-title', displayName: 'SEO Title', type: 'PlainText' }],
        items: [{ id: 'item-1', fieldData: { 'seo-title': 'Great Product' } }],
        total: 1,
      },
    ];
    mockGet.mockResolvedValue(collections);
    const { result } = renderHook(
      () => useCmsCollections('site-1'),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.data).toEqual(collections));
  });

  it('data is undefined before fetch resolves', () => {
    mockGet.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(
      () => useCmsCollections('site-1'),
      { wrapper: makeWrapper() },
    );
    expect(result.current.data).toBeUndefined();
  });

  it('includes workspaceId query param when provided', async () => {
    mockGet.mockResolvedValue([]);
    const { result } = renderHook(
      () => useCmsCollections('site-1', 'ws-99'),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith(expect.stringContaining('ws-99'));
  });
});
