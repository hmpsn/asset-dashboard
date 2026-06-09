/**
 * tests/unit/hooks/admin-queries-b.test.tsx
 *
 * Smoke tests for a batch of simple useQuery admin hooks.
 * Runs in the `component` vitest project (jsdom environment).
 *
 * Strategy:
 *  - Mock API modules so no real fetch calls fire.
 *  - Assert enabled/disabled behaviour, loading state, and data shape.
 *  - Keep tests shallow — surface behaviour only, not business logic.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';

// ── Standard wrapper ────────────────────────────────────────────────────────

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

// ── Mock API modules ────────────────────────────────────────────────────────

// useAdminGA4 → via useGA4Base → src/api/analytics (ga4 object)
vi.mock('../../../src/api/analytics', () => {
  const ga4Api = {
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
  };
  return {
    ga4: ga4Api,
    ga4Admin: ga4Api,
    gscAdmin: {
      overview: vi.fn(),
      trend: vi.fn(),
      devices: vi.fn(),
      countries: vi.fn(),
      searchTypes: vi.fn(),
      comparison: vi.fn(),
    },
  };
});

// useAdminAssets → src/api/client (get, getSafe)
vi.mock('../../../src/api/client', () => ({
  get: vi.fn(),
  getSafe: vi.fn(),
  getOptional: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
  postForm: vi.fn(),
  getText: vi.fn(),
  ApiError: class ApiError extends Error {
    readonly status: number;
    constructor(status: number, message: string) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
    }
  },
}));

// useAnalyticsAnnotations → src/api/misc (analyticsAnnotations.list)
// useNotifications → src/api/misc (anomalies.listAll, churnSignals.list)
//                  + src/api/platform (workspaceOverview.list)
vi.mock('../../../src/api/misc', () => ({
  analyticsAnnotations: { list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn() },
  anomalies: { listAll: vi.fn(), list: vi.fn() },
  churnSignals: { list: vi.fn() },
}));

vi.mock('../../../src/api/platform', () => ({
  integrationHealth: { get: vi.fn() },
  workspaceOverview: { list: vi.fn() },
}));

// useDiagnostics → src/api/index.js (diagnostics object)
vi.mock('../../../src/api/index.js', () => ({
  diagnostics: {
    list: vi.fn(),
    get: vi.fn(),
    getForInsight: vi.fn(),
    run: vi.fn(),
  },
}));

// ── Import mocked modules ───────────────────────────────────────────────────

import { ga4 } from '../../../src/api/analytics';
import { get, getSafe } from '../../../src/api/client';
import { analyticsAnnotations, anomalies as anomaliesApi, churnSignals } from '../../../src/api/misc';
import { integrationHealth, workspaceOverview } from '../../../src/api/platform';
import { diagnostics } from '../../../src/api/index.js';

const mockGa4Overview = vi.mocked(ga4.overview);
const mockGa4Trend = vi.mocked(ga4.trend);
const mockGscAdminOverview = vi.mocked((await import('../../../src/api/analytics')).gscAdmin.overview);
const mockGet = vi.mocked(get);
const mockGetSafe = vi.mocked(getSafe);
const mockAnnotationsList = vi.mocked(analyticsAnnotations.list);
const mockAnomaliesListAll = vi.mocked(anomaliesApi.listAll);
const mockChurnList = vi.mocked(churnSignals.list);
const mockIntegrationHealthGet = vi.mocked(integrationHealth.get);
const mockWorkspaceOverviewList = vi.mocked(workspaceOverview.list);
const mockDiagnosticsList = vi.mocked(diagnostics.list);
const mockDiagnosticsGet = vi.mocked(diagnostics.get);
const mockDiagnosticsForInsight = vi.mocked(diagnostics.getForInsight);

// ── Import hooks ────────────────────────────────────────────────────────────

import { useAdminGA4 } from '../../../src/hooks/admin/useAdminGA4';
import { useAdminSearch } from '../../../src/hooks/admin/useAdminSearch';
import { useWebflowAssets, useAssetAudit, useCmsImages } from '../../../src/hooks/admin/useAdminAssets';
import { useAnalyticsAnnotations } from '../../../src/hooks/admin/useAnalyticsAnnotations';
import { useAnomalyAlerts } from '../../../src/hooks/admin/useAnomalyAlerts';
import { useIntegrationHealth } from '../../../src/hooks/admin/useIntegrationHealth';
import { useNotifications } from '../../../src/hooks/admin/useNotifications';
import { useDiagnosticsList, useDiagnosticReport, useDiagnosticForInsight } from '../../../src/hooks/admin/useDiagnostics';
import { useWorkspaceOverviewData } from '../../../src/hooks/admin/useWorkspaceOverview';

// ── useAdminGA4 ─────────────────────────────────────────────────────────────

describe('useAdminGA4', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('is disabled when workspaceId is empty', () => {
    const { result } = renderHook(
      () => useAdminGA4('', 28, false),
      { wrapper: makeWrapper() },
    );
    expect(result.current.isLoading).toBe(false);
    expect(result.current.overview).toBeNull();
    expect(mockGa4Overview).not.toHaveBeenCalled();
  });

  it('enters loading state when enabled with a valid workspaceId', () => {
    let resolveFn!: (v: unknown) => void;
    mockGa4Overview.mockReturnValue(new Promise(r => { resolveFn = r; }));
    mockGa4Trend.mockResolvedValue([]);
    // Remaining sub-queries also return pending or empty
    vi.mocked(ga4.topPages).mockResolvedValue([]);
    vi.mocked(ga4.sources).mockResolvedValue([]);
    vi.mocked(ga4.devices).mockResolvedValue([]);
    vi.mocked(ga4.countries).mockResolvedValue([]);
    vi.mocked(ga4.comparison).mockResolvedValue(null);
    vi.mocked(ga4.newVsReturning).mockResolvedValue([]);
    vi.mocked(ga4.organic).mockResolvedValue(null);
    vi.mocked(ga4.landingPages).mockResolvedValue([]);
    vi.mocked(ga4.conversions).mockResolvedValue([]);
    vi.mocked(ga4.events).mockResolvedValue([]);

    const { result } = renderHook(
      () => useAdminGA4('ws-1', 28, true),
      { wrapper: makeWrapper() },
    );
    expect(result.current.isLoading).toBe(true);
    resolveFn(null);
  });

  it('returns data shape when API resolves', async () => {
    const overviewData = {
      totalUsers: 100, totalSessions: 150, avgEngagementTime: 60,
      bounceRate: 0.4, newUsers: 60, returningUsers: 40,
      organicUsers: 80, organicSessions: 110,
    };
    mockGa4Overview.mockResolvedValue(overviewData);
    mockGa4Trend.mockResolvedValue([]);
    vi.mocked(ga4.topPages).mockResolvedValue([]);
    vi.mocked(ga4.sources).mockResolvedValue([]);
    vi.mocked(ga4.devices).mockResolvedValue([]);
    vi.mocked(ga4.countries).mockResolvedValue([]);
    vi.mocked(ga4.comparison).mockResolvedValue(null);
    vi.mocked(ga4.newVsReturning).mockResolvedValue([]);
    vi.mocked(ga4.organic).mockResolvedValue(null);
    vi.mocked(ga4.landingPages).mockResolvedValue([]);
    vi.mocked(ga4.conversions).mockResolvedValue([]);
    vi.mocked(ga4.events).mockResolvedValue([]);

    const { result } = renderHook(
      () => useAdminGA4('ws-1', 28, true),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.overview).toEqual(overviewData);
    expect(result.current.trend).toEqual([]);
    expect(result.current.error).toBeNull();
  });
});

// ── useAdminSearch ──────────────────────────────────────────────────────────

describe('useAdminSearch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('is disabled when workspaceId is empty', () => {
    const { result } = renderHook(
      () => useAdminSearch('', 'site-1', 'https://example.com', 28),
      { wrapper: makeWrapper() },
    );
    expect(result.current.isLoading).toBe(false);
    expect(result.current.overview).toBeNull();
    expect(mockGscAdminOverview).not.toHaveBeenCalled();
  });

  it('is disabled when gscSiteUrl is undefined', () => {
    const { result } = renderHook(
      () => useAdminSearch('ws-1', 'site-1', undefined, 28),
      { wrapper: makeWrapper() },
    );
    expect(result.current.isLoading).toBe(false);
    expect(mockGscAdminOverview).not.toHaveBeenCalled();
  });

  it('returns data when API resolves', async () => {
    const gscAdmin = (await import('../../../src/api/analytics')).gscAdmin;
    const overviewData = {
      totalClicks: 500, totalImpressions: 10000, avgCtr: 0.05,
      avgPosition: 15, dateRange: { start: '2024-01-01', end: '2024-01-31' },
      topQueries: [], topPages: [],
    };
    vi.mocked(gscAdmin.overview).mockResolvedValue(overviewData);
    vi.mocked(gscAdmin.trend).mockResolvedValue([]);
    vi.mocked(gscAdmin.devices).mockResolvedValue([]);
    vi.mocked(gscAdmin.countries).mockResolvedValue([]);
    vi.mocked(gscAdmin.searchTypes).mockResolvedValue([]);
    vi.mocked(gscAdmin.comparison).mockResolvedValue(null);

    const { result } = renderHook(
      () => useAdminSearch('ws-1', 'site-1', 'https://example.com', 28),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.overview).toEqual(overviewData);
    expect(result.current.trend).toEqual([]);
    expect(result.current.error).toBeNull();
  });
});

// ── useWebflowAssets ────────────────────────────────────────────────────────

describe('useWebflowAssets', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('is disabled when siteId is empty', () => {
    const { result } = renderHook(
      () => useWebflowAssets('', 'ws-1'),
      { wrapper: makeWrapper() },
    );
    expect(result.current.isLoading).toBe(false);
    expect(mockGetSafe).not.toHaveBeenCalled();
  });

  it('enters loading state when enabled', () => {
    mockGetSafe.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(
      () => useWebflowAssets('site-1', 'ws-1'),
      { wrapper: makeWrapper() },
    );
    expect(result.current.isLoading).toBe(true);
  });

  it('returns array of assets when API resolves', async () => {
    const assets = [{ id: 'a1', size: 1024, contentType: 'image/png' }];
    mockGetSafe.mockResolvedValue(assets);
    const { result } = renderHook(
      () => useWebflowAssets('site-1', 'ws-1'),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data).toEqual(assets);
  });
});

// ── useAssetAudit ───────────────────────────────────────────────────────────

describe('useAssetAudit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('is disabled when enabled=false', () => {
    const { result } = renderHook(
      () => useAssetAudit('site-1', 'ws-1', false),
      { wrapper: makeWrapper() },
    );
    expect(result.current.isLoading).toBe(false);
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('enters loading state when enabled', () => {
    mockGet.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(
      () => useAssetAudit('site-1', 'ws-1', true),
      { wrapper: makeWrapper() },
    );
    expect(result.current.isLoading).toBe(true);
  });

  it('returns a Set of unused asset IDs when API resolves', async () => {
    mockGet.mockResolvedValue({ issues: [{ issues: ['unused'], assetId: 'img-1' }] });
    const { result } = renderHook(
      () => useAssetAudit('site-1', 'ws-1', true),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data).toBeInstanceOf(Set);
    expect((result.current.data as Set<string>).has('img-1')).toBe(true);
  });
});

// ── useCmsImages ────────────────────────────────────────────────────────────

describe('useCmsImages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('is disabled when enabled=false', () => {
    const { result } = renderHook(
      () => useCmsImages('site-1', 'ws-1', false),
      { wrapper: makeWrapper() },
    );
    expect(result.current.isLoading).toBe(false);
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('enters loading state when enabled', () => {
    mockGet.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(
      () => useCmsImages('site-1', 'ws-1', true),
      { wrapper: makeWrapper() },
    );
    expect(result.current.isLoading).toBe(true);
  });

  it('returns data when API resolves', async () => {
    const scanResult = { collections: [], totalImages: 0, missingAlt: 0 };
    mockGet.mockResolvedValue(scanResult);
    const { result } = renderHook(
      () => useCmsImages('site-1', 'ws-1', true),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data).toEqual(scanResult);
  });
});

// ── useAnalyticsAnnotations ─────────────────────────────────────────────────

describe('useAnalyticsAnnotations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('is disabled when workspaceId is empty', () => {
    const { result } = renderHook(
      () => useAnalyticsAnnotations(''),
      { wrapper: makeWrapper() },
    );
    expect(result.current.isLoading).toBe(false);
    expect(mockAnnotationsList).not.toHaveBeenCalled();
  });

  it('enters loading state when enabled', () => {
    mockAnnotationsList.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(
      () => useAnalyticsAnnotations('ws-1'),
      { wrapper: makeWrapper() },
    );
    expect(result.current.isLoading).toBe(true);
  });

  it('returns array of annotations when API resolves', async () => {
    const annotations = [
      { id: 'ann-1', workspaceId: 'ws-1', date: '2024-01-15', label: 'Deploy', category: 'release', createdAt: '2024-01-15T00:00:00Z' },
    ];
    mockAnnotationsList.mockResolvedValue(annotations);
    const { result } = renderHook(
      () => useAnalyticsAnnotations('ws-1'),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data).toEqual(annotations);
  });
});

// ── useAnomalyAlerts ────────────────────────────────────────────────────────

describe('useAnomalyAlerts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('is disabled when workspaceId is empty', () => {
    const { result } = renderHook(
      () => useAnomalyAlerts('', true),
      { wrapper: makeWrapper() },
    );
    expect(result.current.isLoading).toBe(false);
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('is disabled when isAdmin=false', () => {
    const { result } = renderHook(
      () => useAnomalyAlerts('ws-1', false),
      { wrapper: makeWrapper() },
    );
    expect(result.current.isLoading).toBe(false);
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('returns array of alerts when API resolves', async () => {
    const alerts = [
      {
        id: 'alert-1', workspaceId: 'ws-1', workspaceName: 'Test Site',
        type: 'traffic_drop' as const, severity: 'critical' as const,
        title: 'Traffic dropped', description: 'Traffic down 30%',
        metric: 'clicks', currentValue: 70, previousValue: 100, changePct: -30,
        detectedAt: '2024-01-01T00:00:00Z', source: 'gsc' as const,
      },
    ];
    mockGet.mockResolvedValue(alerts);
    const { result } = renderHook(
      () => useAnomalyAlerts('ws-1', true),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data).toEqual(alerts);
  });
});

// ── useIntegrationHealth ────────────────────────────────────────────────────

describe('useIntegrationHealth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('is disabled when workspaceId is empty', () => {
    const { result } = renderHook(
      () => useIntegrationHealth(''),
      { wrapper: makeWrapper() },
    );
    expect(result.current.isLoading).toBe(false);
    expect(mockIntegrationHealthGet).not.toHaveBeenCalled();
  });

  it('enters loading state when enabled', () => {
    mockIntegrationHealthGet.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(
      () => useIntegrationHealth('ws-1'),
      { wrapper: makeWrapper() },
    );
    expect(result.current.isLoading).toBe(true);
  });

  it('returns health data when API resolves', async () => {
    const healthData = { webflow: { connected: true }, gsc: { connected: false }, ga4: { connected: true } };
    mockIntegrationHealthGet.mockResolvedValue(healthData);
    const { result } = renderHook(
      () => useIntegrationHealth('ws-1'),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data).toEqual(healthData);
  });
});

// ── useNotifications ────────────────────────────────────────────────────────

describe('useNotifications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('enters loading state when APIs are pending', () => {
    mockWorkspaceOverviewList.mockReturnValue(new Promise(() => {}));
    mockAnomaliesListAll.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(
      () => useNotifications(),
      { wrapper: makeWrapper() },
    );
    expect(result.current.isLoading).toBe(true);
    expect(result.current.data).toBeUndefined();
  });

  it('returns an array when APIs resolve with empty data', async () => {
    mockWorkspaceOverviewList.mockResolvedValue([]);
    mockAnomaliesListAll.mockResolvedValue([]);
    mockChurnList.mockResolvedValue([]);
    const { result } = renderHook(
      () => useNotifications(),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(Array.isArray(result.current.data)).toBe(true);
  });
});

// ── useDiagnosticsList ──────────────────────────────────────────────────────

describe('useDiagnosticsList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('is disabled when workspaceId is empty', () => {
    const { result } = renderHook(
      () => useDiagnosticsList(''),
      { wrapper: makeWrapper() },
    );
    expect(result.current.isLoading).toBe(false);
    expect(mockDiagnosticsList).not.toHaveBeenCalled();
  });

  it('enters loading state when enabled', () => {
    mockDiagnosticsList.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(
      () => useDiagnosticsList('ws-1'),
      { wrapper: makeWrapper() },
    );
    expect(result.current.isLoading).toBe(true);
  });

  it('returns reports when API resolves', async () => {
    mockDiagnosticsList.mockResolvedValue({ reports: [] });
    const { result } = renderHook(
      () => useDiagnosticsList('ws-1'),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data).toEqual({ reports: [] });
  });
});

// ── useDiagnosticReport ─────────────────────────────────────────────────────

describe('useDiagnosticReport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('is disabled when workspaceId is empty', () => {
    const { result } = renderHook(
      () => useDiagnosticReport('', 'rep-1'),
      { wrapper: makeWrapper() },
    );
    expect(result.current.isLoading).toBe(false);
    expect(mockDiagnosticsGet).not.toHaveBeenCalled();
  });

  it('is disabled when reportId is empty', () => {
    const { result } = renderHook(
      () => useDiagnosticReport('ws-1', ''),
      { wrapper: makeWrapper() },
    );
    expect(result.current.isLoading).toBe(false);
    expect(mockDiagnosticsGet).not.toHaveBeenCalled();
  });

  it('returns report when API resolves', async () => {
    const report = { id: 'rep-1', workspaceId: 'ws-1', status: 'done', insightId: 'ins-1' };
    mockDiagnosticsGet.mockResolvedValue({ report });
    const { result } = renderHook(
      () => useDiagnosticReport('ws-1', 'rep-1'),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data).toEqual({ report });
  });
});

// ── useDiagnosticForInsight ─────────────────────────────────────────────────

describe('useDiagnosticForInsight', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('is disabled when insightId is empty', () => {
    const { result } = renderHook(
      () => useDiagnosticForInsight('ws-1', ''),
      { wrapper: makeWrapper() },
    );
    expect(result.current.isLoading).toBe(false);
    expect(mockDiagnosticsForInsight).not.toHaveBeenCalled();
  });

  it('returns report data when API resolves', async () => {
    mockDiagnosticsForInsight.mockResolvedValue({ report: null });
    const { result } = renderHook(
      () => useDiagnosticForInsight('ws-1', 'ins-1'),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data).toEqual({ report: null });
  });
});

// ── useWorkspaceOverviewData ────────────────────────────────────────────────

describe('useWorkspaceOverviewData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('enters loading state on mount', () => {
    mockGet.mockReturnValue(new Promise(() => {}));
    mockGetSafe.mockResolvedValue([]);
    const { result } = renderHook(
      () => useWorkspaceOverviewData(),
      { wrapper: makeWrapper() },
    );
    expect(result.current.isLoading).toBe(true);
    expect(result.current.data).toBeUndefined();
  });

  it('returns aggregated data shape when all APIs resolve', async () => {
    const ws = { id: 'ws-1', name: 'Site A', webflowSiteId: null, webflowSiteName: null, hasGsc: false, hasGa4: false, hasPassword: false, audit: null, requests: { total: 0, new: 0, active: 0, latestDate: null }, approvals: { pending: 0, total: 0 } };
    // get() is called for /api/workspace-overview; getSafe for activity+anomalies; getOptional for presence+timeSaved
    mockGet.mockResolvedValue([ws]);
    mockGetSafe.mockResolvedValue([]);
    const { getOptional } = await import('../../../src/api/client');
    vi.mocked(getOptional).mockResolvedValue(null);

    const { result } = renderHook(
      () => useWorkspaceOverviewData(),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data?.workspaces).toEqual([ws]);
    expect(result.current.data?.recentActivity).toEqual([]);
    expect(result.current.data?.anomalies).toEqual([]);
    expect(result.current.data?.timeSaved).toBeNull();
  });
});
