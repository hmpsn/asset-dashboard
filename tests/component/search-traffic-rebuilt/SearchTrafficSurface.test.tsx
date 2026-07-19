import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../../src/components/Toast';
import { SearchTrafficSurface } from '../../../src/components/search-traffic-rebuilt/SearchTrafficSurface';
import { useFeatureFlag } from '../../../src/hooks/useFeatureFlag';
import { queryKeys } from '../../../src/lib/queryKeys';
import type { FeatureFlagKey } from '../../../shared/types/feature-flags';
import { expectNoA11yViolations } from '../a11y';

const getMock = vi.fn();
const featureFlagsListMock = vi.fn();
let capturedWorkspaceHandlers: Record<string, (data?: unknown) => void> = {};
const adminSearchCallMock = vi.fn();
const adminGa4CallMock = vi.fn();

const workspace = {
  id: 'ws-1',
  name: 'Acme Dental',
  webflowSiteId: 'site-1',
  webflowSiteName: 'acme.com',
  gscPropertyUrl: 'https://acme.com/',
  ga4PropertyId: '123',
};

type WorkspaceFixture = Omit<typeof workspace, 'gscPropertyUrl' | 'ga4PropertyId'> & {
  gscPropertyUrl?: string;
  ga4PropertyId?: string;
};

const searchOverview = {
  totalClicks: 1200,
  totalImpressions: 24000,
  avgCtr: 5,
  avgPosition: 8.2,
  dateRange: { start: '2026-06-01', end: '2026-06-28' },
  topQueries: [
    { query: 'acme dental', clicks: 300, impressions: 3000, ctr: 10, position: 1.5 },
    { query: 'cosmetic dentist chicago', clicks: 120, impressions: 2400, ctr: 5, position: 7.2 },
  ],
  topPages: [
    { page: 'https://acme.com/cosmetic-dentistry', clicks: 200, impressions: 2800, ctr: 7.1, position: 5.4 },
  ],
  brandedDemand: {
    status: 'ready',
    denominator: 'impressions',
    queryRowsSampled: 2,
    total: { clicks: 1200, impressions: 24000 },
    branded: { clicks: 300, impressions: 3000, sharePct: 12.5 },
    nonBranded: { clicks: 900, impressions: 21000, sharePct: 87.5 },
  },
};

let currentWorkspace: WorkspaceFixture = workspace;
let currentSearchOverview: typeof searchOverview | null = searchOverview;
let currentSearchError: string | null = null;

const ga4Overview = {
  totalUsers: 900,
  totalSessions: 1200,
  totalPageviews: 2400,
  avgSessionDuration: 92,
  bounceRate: 41.2,
  newUserPercentage: 64,
  dateRange: { start: '2026-06-01', end: '2026-06-28' },
};
let currentGa4Overview: typeof ga4Overview | null = ga4Overview;
let currentAnomalies: Array<{
  id: string;
  workspaceId: string;
  workspaceName: string;
  type: 'traffic_drop';
  severity: 'critical' | 'warning' | 'positive';
  title: string;
  description: string;
  metric: string;
  currentValue: number;
  previousValue: number;
  changePct: number;
  detectedAt: string;
  source: 'gsc';
}> = [];
const featureFlagResponse: Partial<Record<FeatureFlagKey, boolean>> = {
  'ui-rebuild-shell': true,
};

beforeAll(() => {
  class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', ResizeObserverMock);
});

vi.mock('../../../src/hooks/admin', () => ({
  useWorkspaces: () => ({
    data: [currentWorkspace],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useAnomalyAlerts: () => ({
    data: currentAnomalies,
    isLoading: false,
  }),
}));

vi.mock('../../../src/hooks/admin/useAdminSearch', () => ({
  useAdminSearch: (...args: unknown[]) => {
    adminSearchCallMock(...args);
    return ({
    overview: currentSearchOverview,
    trend: [
      { date: '2026-06-01', clicks: 20, impressions: 400, ctr: 5, position: 8 },
      { date: '2026-06-02', clicks: 24, impressions: 420, ctr: 5.7, position: 7.8 },
    ],
    devices: [{ device: 'DESKTOP', clicks: 600, impressions: 10000, ctr: 6, position: 7 }],
    countries: [{ country: 'usa', clicks: 1000, impressions: 20000, ctr: 5, position: 8 }],
    searchTypes: [{ searchType: 'web', clicks: 1200, impressions: 24000, ctr: 5, position: 8.2 }],
    comparison: {
      current: { clicks: 1200, impressions: 24000, ctr: 5, position: 8.2 },
      previous: { clicks: 1000, impressions: 22000, ctr: 4.5, position: 9.1 },
      change: { clicks: 200, impressions: 2000, ctr: 0.5, position: -0.9 },
      changePercent: { clicks: 20, impressions: 9.1, ctr: 11.1, position: -9.9 },
    },
    isLoading: false,
    error: currentSearchError,
    });
  },
}));

vi.mock('../../../src/hooks/admin/useAdminGA4', () => ({
  useAdminGA4: (...args: unknown[]) => {
    adminGa4CallMock(...args);
    return ({
    overview: currentGa4Overview,
    trend: [
      { date: '2026-06-01', users: 30, sessions: 42, pageviews: 80 },
      { date: '2026-06-02', users: 34, sessions: 45, pageviews: 88 },
    ],
    topPages: [{ path: '/cosmetic-dentistry', pageviews: 700, users: 260, sessions: 310, avgEngagementTime: 41 }],
    sources: [{ source: 'google', medium: 'organic', users: 500, sessions: 700 }],
    devices: [{ device: 'desktop', users: 500, sessions: 700, percentage: 58.3 }],
    countries: [{ country: 'United States', users: 800, sessions: 1000 }],
    comparison: {
      current: ga4Overview,
      previous: { ...ga4Overview, totalUsers: 700, totalSessions: 900, totalPageviews: 1800 },
      change: { users: 200, sessions: 300, pageviews: 600, bounceRate: -2, avgSessionDuration: 8 },
      changePercent: { users: 28.6, sessions: 33.3, pageviews: 33.3 },
    },
    newVsReturning: [{ segment: 'new', users: 500, sessions: 650, bounceRate: 40, engagementRate: 61, avgEngagementTime: 70, percentage: 55.5 }],
    organic: { organicUsers: 640, organicSessions: 820, organicPageviews: 1400, organicBounceRate: 38, engagementRate: 62, avgEngagementTime: 75, shareOfTotalUsers: 71.1, dateRange: ga4Overview.dateRange },
    landingPages: [{ landingPage: '/services', sessions: 300, users: 220, bounceRate: 37, avgEngagementTime: 81, conversions: 14 }],
    conversions: [{ eventName: 'form_submit', conversions: 24, users: 20, rate: 2.2 }],
    isLoading: false,
    error: null,
    });
  },
}));

vi.mock('../../../src/hooks/admin/useAnalyticsOverview', () => ({
  useAnalyticsOverviewFromData: () => ({
    gscClicks: 1200,
    gscImpressions: 24000,
    gscPosition: 8.2,
    gscClicksDelta: 20,
    gscImpressionsDelta: 9.1,
    gscPositionDelta: -0.9,
    ga4Users: 900,
    ga4Sessions: 1200,
    ga4BounceRate: 41.2,
    ga4UsersDelta: 28.6,
    ga4SessionsDelta: 33.3,
    ga4BounceRateDelta: -2,
    trendData: [
      { date: '2026-06-01', clicks: 20, impressions: 400, ctr: 5, position: 8, users: 30, sessions: 42, pageviews: 80 },
      { date: '2026-06-02', clicks: 24, impressions: 420, ctr: 5.7, position: 7.8, users: 34, sessions: 45, pageviews: 88 },
    ],
    annotations: [{ id: 'ann-1', workspaceId: 'ws-1', date: '2026-06-01', label: 'Launch', category: 'site_change', createdAt: '2026-06-01T00:00:00.000Z' }],
    createAnnotation: { mutate: vi.fn(), isPending: false },
    isLoading: false,
    hasGsc: true,
    hasGa4: true,
  }),
}));

vi.mock('../../../src/hooks/admin/useAnalyticsAnnotations', () => ({
  useAnalyticsAnnotations: () => ({
    data: [{ id: 'ann-1', workspaceId: 'ws-1', date: '2026-06-01', label: 'Launch', category: 'site_change', createdAt: '2026-06-01T00:00:00.000Z', pageUrl: 'https://acme.com/services' }],
    isLoading: false,
    isError: false,
  }),
  useCreateAnnotation: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('../../../src/hooks/admin/useInsightFeed', () => ({
  useInsightFeed: () => ({
    feed: [
      { id: 'ins-1', title: 'CTR opportunity', headline: 'CTR below expected', domain: 'search', type: 'ctr_opportunity', severity: 'warning', pageUrl: 'https://acme.com/cosmetic-dentistry', detectedAt: '2026-06-02T00:00:00.000Z' },
      { id: 'ins-2', title: 'Traffic lift', headline: 'Organic users improved', domain: 'traffic', type: 'conversion_attribution', severity: 'positive', detectedAt: '2026-06-02T00:00:00.000Z' },
    ],
    summary: [{ key: 'wins', label: 'Wins', count: 1 }],
    isLoading: false,
  }),
}));

vi.mock('../../../src/hooks/admin/useAnomalyAlerts', () => ({
  useAnomalyAlerts: () => ({ data: currentAnomalies, isLoading: false }),
}));

vi.mock('../../../src/hooks/useWorkspaceEvents', () => ({
  useWorkspaceEvents: (_workspaceId: string, handlers: Record<string, (data?: unknown) => void>) => {
    capturedWorkspaceHandlers = handlers;
    return { send: vi.fn() };
  },
}));

vi.mock('../../../src/api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../src/api/client')>('../../../src/api/client');
  return {
    ...actual,
    get: (...args: unknown[]) => getMock(...args),
    post: vi.fn(),
  };
});

vi.mock('../../../src/api/keyword-strategy', () => ({
  getStrategyKeywordSet: vi.fn(async () => ({
    keywords: [{ id: 1, workspaceId: 'ws-1', keyword: 'cosmetic dentist chicago', source: 'manual_add', keptAt: null, removedAt: null, slotOrder: 1, createdAt: '2026-06-01T00:00:00.000Z' }],
  })),
}));

vi.mock('../../../src/api/misc', () => ({
  featureFlags: {
    list: () => featureFlagsListMock(),
  },
  analyticsAnnotations: {
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  },
}));

vi.mock('../../../src/components/charts/AnnotatedTrendChart', () => ({
  AnnotatedTrendChart: ({ data }: { data: unknown[] }) => <div data-testid="annotated-trend-chart">chart {data.length}</div>,
}));

vi.mock('../../../src/components/insights', () => ({
  InsightFeed: ({ domain }: { domain?: string }) => <div data-testid={`insight-feed-${domain ?? 'all'}`}>Insight feed</div>,
}));

function renderSurface(initialEntry = '/ws/ws-1/analytics-hub') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(queryKeys.shared.featureFlags(), featureFlagResponse);
  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[initialEntry]}>
          <LocationProbe />
          <ToastProvider>
            <SearchTrafficSurface workspaceId="ws-1" />
          </ToastProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  };
}

function FlaggedSearchTraffic() {
  const enabled = useFeatureFlag('ui-rebuild-shell');
  return enabled ? <SearchTrafficSurface workspaceId="ws-1" /> : <div data-testid="legacy-search-traffic">Legacy analytics</div>;
}

function LocationProbe() {
  const location = useLocation();
  return <output aria-hidden="true" data-testid="location">{`${location.pathname}${location.search}`}</output>;
}

function reportModes() {
  return within(screen.getByRole('toolbar', { name: 'Search and traffic reports' })).getAllByRole('radio');
}

function expectBefore(first: Element, second: Element) {
  expect(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
}

function renderFlagged(initialEntry = '/ws/ws-1/analytics-hub') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[initialEntry]}>
          <LocationProbe />
          <ToastProvider>
            <FlaggedSearchTraffic />
          </ToastProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  currentWorkspace = workspace;
  currentSearchOverview = searchOverview;
  currentSearchError = null;
  currentGa4Overview = ga4Overview;
  currentAnomalies = [];
  adminSearchCallMock.mockClear();
  adminGa4CallMock.mockClear();
  getMock.mockResolvedValue([
    { date: '2026-05-01', clicks: 12, impressions: 300, ctr: 4, position: 9 },
    { date: '2026-05-02', clicks: 10, impressions: 280, ctr: 3.6, position: 9.2 },
  ]);
  featureFlagsListMock.mockReturnValue(new Promise(() => {}));
  capturedWorkspaceHandlers = {};
});

describe('SearchTrafficSurface', () => {
  it('mounts through a real feature-flag loading to loaded transition', async () => {
    const { queryClient } = renderFlagged();

    expect(screen.getByTestId('legacy-search-traffic')).toBeInTheDocument();

    act(() => {
      queryClient.setQueryData(queryKeys.shared.featureFlags(), featureFlagResponse);
    });

    expect(await screen.findByRole('heading', { name: 'Search clicks are up 20.0% this period.' })).toBeInTheDocument();
    expect(screen.queryByTestId('legacy-search-traffic')).not.toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Search performance/i })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('Demand mix')).toBeInTheDocument();
  });

  it('uses Search Performance for bare and invalid lenses with exactly three visible report modes', async () => {
    renderSurface();

    expect(await screen.findByRole('heading', { name: 'Search clicks are up 20.0% this period.' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Search performance/i })).toHaveAttribute('aria-checked', 'true');
    expect(reportModes()).toHaveLength(3);
    expect(screen.queryByRole('radio', { name: /Overview/i })).not.toBeInTheDocument();
    expect(screen.getByText('Demand mix')).toBeInTheDocument();
    expect(screen.getByText('Priority insights')).toBeInTheDocument();
    expect(screen.queryByText('Search + traffic trend')).not.toBeInTheDocument();
    expect(screen.getByText(/Data as of/)).toHaveClass('t-caption-sm');
    const dateRange = screen.getByRole('group', { name: 'Analytics date range' });
    expect(within(dateRange).getByRole('button', { name: '28d' })).toBeInTheDocument();
    expect(within(dateRange).getByRole('button', { name: '90d' })).toBeInTheDocument();
    expect(within(dateRange).getByRole('button', { name: '12m' })).toBeInTheDocument();
    expect(within(dateRange).getByRole('button', { name: 'More date ranges' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: '7d' })).not.toBeInTheDocument();
    expect(screen.getByRole('toolbar', { name: 'Search and traffic reports' })).toHaveClass(
      'max-w-full',
      'overflow-x-auto',
    );
    expect(screen.getByText('Share uses impressions as the denominator; missing query rows remain in the non-branded remainder.')).toHaveClass('t-body');
    expect(Object.keys(capturedWorkspaceHandlers)).not.toContain('annotation:bridge_created');

    const trend = screen.getByText('Search performance trend');
    const movement = screen.getByText('Movement');
    const detail = screen.getByText('Detail');
    const monitoring = screen.getByText('Monitoring & insights');
    expectBefore(screen.getAllByText('Clicks')[0], trend);
    expectBefore(trend, movement);
    expectBefore(movement, detail);
    expectBefore(detail, monitoring);
  });

  it('keeps secondary date ranges reachable through the compact overflow menu', async () => {
    renderSurface();

    const dateRange = screen.getByRole('group', { name: 'Analytics date range' });
    fireEvent.click(within(dateRange).getByRole('button', { name: 'More date ranges' }));

    expect(await screen.findByRole('menuitem', { name: '7d' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: '14d' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: '6mo' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: '16mo' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('menuitem', { name: '7d' }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/ws/ws-1/analytics-hub?days=7'));
    expect(within(dateRange).getByRole('button', { name: 'More date ranges' })).toHaveTextContent('7d');
  });

  it('keeps explicit Re-scan wired to provider and surface read models', async () => {
    const { queryClient } = renderSurface();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    fireEvent.click(await screen.findByRole('button', { name: 'Re-scan' }));

    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.admin.gscAll('ws-1:site-1') });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.admin.ga4All('ws-1') });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.admin.analyticsAnnotations('ws-1') });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.admin.insightFeed('ws-1') });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.admin.anomalyAlerts('ws-1') });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.admin.strategyKeywordSet('ws-1') });
  });

  it('omits provider-window fallback copy when neither provider returned a real window', async () => {
    currentSearchOverview = null;
    currentGa4Overview = null;
    renderSurface();

    expect(await screen.findByText('No search data')).toBeInTheDocument();
    expect(screen.queryByText('Provider window unavailable')).not.toBeInTheDocument();
  });

  it('does not leak a cached GA4 timestamp when returning from Traffic to Search', async () => {
    currentSearchOverview = null;
    renderSurface('/ws/ws-1/analytics-hub?lens=traffic');

    expect(await screen.findByText(/Data as of/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: /Search performance/i }));

    await screen.findByText('No search data');
    expect(screen.queryByText(/Data as of/)).not.toBeInTheDocument();
  });

  it('normalizes an invalid lens to the default while preserving validated report params', async () => {
    renderSurface('/ws/ws-1/analytics-hub?lens=not-a-report&days=90&view=pages');

    expect(await screen.findByRole('radio', { name: /Search performance/i })).toHaveAttribute('aria-checked', 'true');
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/ws/ws-1/analytics-hub?days=90&view=pages'));
    expect(screen.queryByRole('radio', { name: /Overview/i })).not.toBeInTheDocument();
  });

  it('keeps the Overview receiver hidden while rendering its cross-source content once', async () => {
    renderSurface('/ws/ws-1/analytics-hub?lens=overview');

    expect(await screen.findByText('Search + traffic trend')).toBeInTheDocument();
    expect(screen.getAllByText('Demand mix')).toHaveLength(1);
    expect(screen.getAllByText('Priority insights')).toHaveLength(1);
    expect(reportModes()).toHaveLength(3);
    expect(reportModes().filter((radio) => radio.getAttribute('aria-checked') === 'true')).toHaveLength(0);
    expect(screen.queryByRole('radio', { name: /Overview/i })).not.toBeInTheDocument();
    expect(adminSearchCallMock).toHaveBeenLastCalledWith(
      'ws-1',
      'site-1',
      'https://acme.com/',
      28,
      { enabled: true, metrics: ['overview', 'trend', 'comparison'] },
    );
    expect(adminGa4CallMock).toHaveBeenLastCalledWith(
      'ws-1',
      28,
      true,
      ['overview', 'trend', 'comparison'],
    );
    expect(getMock).not.toHaveBeenCalled();
  });

  it('honors the lens deep link and table view params', async () => {
    renderSurface('/ws/ws-1/analytics-hub?lens=search&view=pages&days=90');

    expect(await screen.findByRole('radio', { name: /Search performance/i })).toHaveAttribute('aria-checked', 'true');
    await waitFor(() => expect(getMock).toHaveBeenCalled());
    expect(screen.getByText('Showing 1 of 1 rows')).toHaveClass('t-caption-sm');
    expect(screen.getByText('Open Keyword Hub')).toHaveClass('t-ui');
    expect(screen.getByText('/cosmetic-dentistry')).toBeInTheDocument();
  });

  it('reads the anomalies section deep link, opens monitoring, and focuses the existing alert section', async () => {
    currentAnomalies = [{
      id: 'anomaly-1',
      workspaceId: 'ws-1',
      workspaceName: 'Acme Dental',
      type: 'traffic_drop',
      severity: 'critical',
      title: 'Organic traffic dropped',
      description: 'Clicks fell outside the expected range.',
      metric: 'clicks',
      currentValue: 75,
      previousValue: 100,
      changePct: -25,
      detectedAt: '2026-07-16T12:00:00.000Z',
      source: 'gsc',
    }];

    renderSurface('/ws/ws-1/analytics-hub?section=anomalies');

    const anomalySection = await screen.findByRole('button', { name: /Anomaly Alerts/i });
    await waitFor(() => expect(anomalySection).toHaveFocus());
    expect(anomalySection.closest('details')).toHaveAttribute('open');
    expect(screen.getByTestId('location')).toHaveTextContent('/ws/ws-1/analytics-hub?section=anomalies');
  });

  it('caps Search detail at 25 rows and expands or filters against the truthful row count', async () => {
    currentSearchOverview = {
      ...searchOverview,
      topQueries: Array.from({ length: 32 }, (_, index) => ({
        query: `detail query ${String(index + 1).padStart(2, '0')}`,
        clicks: 320 - index,
        impressions: 3_200 - index,
        ctr: 10 - (index / 10),
        position: 1 + index,
      })),
      topPages: Array.from({ length: 28 }, (_, index) => ({
        page: `https://acme.com/detail-page-${String(index + 1).padStart(2, '0')}`,
        clicks: 280 - index,
        impressions: 2_800 - index,
        ctr: 9 - (index / 10),
        position: 2 + index,
      })),
    };
    renderSurface('/ws/ws-1/analytics-hub?lens=search');

    const grid = await screen.findByRole('grid');
    expect(within(grid).getAllByRole('row')).toHaveLength(26);
    expect(screen.getByText('detail query 25')).toBeInTheDocument();
    expect(screen.queryByText('detail query 26')).not.toBeInTheDocument();
    expect(screen.getByText('Showing 25 of 32 rows')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Show all 32' }));

    expect(await screen.findByText('detail query 32')).toBeInTheDocument();
    expect(screen.getByTestId('search-detail-table-region')).toHaveClass('max-h-[60vh]', 'overflow-auto');
    expect(screen.getByText('Showing 32 of 32 rows')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Search queries…'), {
      target: { value: 'query 30' },
    });

    expect(await screen.findByText('detail query 30')).toBeInTheDocument();
    expect(screen.queryByText('detail query 29')).not.toBeInTheDocument();
    expect(screen.getByText('Showing 1 of 1 matching rows (32 total)')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: 'Pages' }));

    expect(await screen.findByText('/detail-page-25')).toBeInTheDocument();
    expect(screen.queryByText('/detail-page-26')).not.toBeInTheDocument();
    expect(screen.getByText('Showing 25 of 28 rows')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show all 28' })).toBeInTheDocument();
  });

  it('returns to Search with canonical URL state while preserving days and view', async () => {
    renderSurface('/ws/ws-1/analytics-hub?lens=traffic&days=90&view=pages');

    expect(await screen.findByRole('radio', { name: /Site traffic/i })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('radio', { name: /Search performance/i }));

    await waitFor(() => expect(screen.getByRole('radio', { name: /Search performance/i })).toHaveAttribute('aria-checked', 'true'));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/ws/ws-1/analytics-hub?days=90&view=pages'));
  });

  it('keeps the reporting modes visible without implementation labels', async () => {
    const { container } = renderSurface('/ws/ws-1/analytics-hub?lens=search');

    expect(await screen.findByRole('radio', { name: /Search performance/i })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: /Site traffic/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Annotations/i })).toBeInTheDocument();
    expect(reportModes()).toHaveLength(3);
    expect(screen.queryByRole('radio', { name: /Overview/i })).not.toBeInTheDocument();
    expect(container).not.toHaveTextContent(/mover link in Keyword Hub|cached data|projection|migration|rebuild|mounted below|T1|carry-over/i);
  });

  it('opens the search breakdowns drawer exactly once and closes cleanly', async () => {
    renderSurface('/ws/ws-1/analytics-hub?lens=search');

    expect(await screen.findByRole('heading', { name: 'Search clicks are up 20.0% this period.' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Breakdowns/i }));

    const dialogs = await screen.findAllByRole('dialog', { name: 'Search breakdowns' });
    expect(dialogs).toHaveLength(1);
    expect(screen.getByText('Devices')).toBeInTheDocument();
    expect(screen.getByText('Search types')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Search breakdowns' })).not.toBeInTheDocument());
  });

  it('shows conversion evidence by default on the Site Traffic lens', async () => {
    renderSurface('/ws/ws-1/analytics-hub?lens=traffic');

    expect(await screen.findByRole('radio', { name: /Site traffic/i })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('heading', { name: 'Site users are up 28.6% this period.' })).toBeInTheDocument();
    expect(screen.getByText('Events & conversions')).toBeInTheDocument();
    expect(screen.getByText('form submit')).toBeInTheDocument();
    expect(screen.getAllByText('Traffic sources')).toHaveLength(1);
    expect(screen.getByText('Devices')).toBeInTheDocument();
    expect(adminSearchCallMock).toHaveBeenLastCalledWith(
      'ws-1',
      'site-1',
      'https://acme.com/',
      28,
      { enabled: false, metrics: undefined },
    );
    expect(adminGa4CallMock).toHaveBeenLastCalledWith('ws-1', 28, true, undefined);
    expect(getMock).not.toHaveBeenCalled();
    expectBefore(screen.getByText('Traffic trend'), screen.getByText('Acquisition'));
    expectBefore(screen.getByText('Acquisition'), screen.getByText('Engagement'));
    expectBefore(screen.getByText('Engagement'), screen.getByText('Conversion'));
    expectBefore(screen.getByText('Conversion'), screen.getByText('Monitoring & insights'));

    fireEvent.click(screen.getByRole('button', { name: 'Hide' }));
    expect(screen.getByText('1 tracked conversion event available.')).toHaveClass('t-body');

    fireEvent.click(screen.getByRole('button', { name: /Breakdowns/i }));
    const dialogs = await screen.findAllByRole('dialog', { name: 'Traffic breakdowns' });
    expect(dialogs).toHaveLength(1);
    expect(screen.getByText('google / organic')).toHaveClass('t-ui');
  });

  it('keeps the Annotations deep link as a visible peer report', async () => {
    renderSurface('/ws/ws-1/analytics-hub?lens=annotations');

    expect(await screen.findByRole('radio', { name: /Annotations/i })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('button', { name: 'Add annotation' })).toBeInTheDocument();
    expectBefore(screen.getByText('Trend with context'), screen.getByText('Annotation timeline'));
    expect(screen.getByTestId('annotated-trend-chart')).toHaveTextContent('chart 2');
    expect(adminSearchCallMock).toHaveBeenLastCalledWith(
      'ws-1',
      'site-1',
      'https://acme.com/',
      28,
      { enabled: true, metrics: ['overview', 'trend'] },
    );
    expect(adminGa4CallMock).toHaveBeenLastCalledWith('ws-1', 28, true, ['overview', 'trend']);
    expect(getMock).toHaveBeenCalledOnce();
  });

  it('keeps provider-independent Annotations CRUD mounted exactly once without analytics providers', async () => {
    currentWorkspace = { ...workspace, gscPropertyUrl: undefined, ga4PropertyId: undefined };
    renderSurface('/ws/ws-1/analytics-hub?lens=annotations');

    expect(await screen.findByRole('radio', { name: /Annotations/i })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getAllByRole('button', { name: 'Add annotation' })).toHaveLength(1);
  });

  it('keeps Search Performance truthful and Annotations usable for a GA4-only workspace', async () => {
    currentWorkspace = { ...workspace, gscPropertyUrl: undefined };
    renderSurface();

    expect(await screen.findByRole('radio', { name: /Search performance/i })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('Search Console not configured')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: /Annotations/i }));
    expect(screen.getAllByRole('button', { name: 'Add annotation' })).toHaveLength(1);
  });

  it('opens Workspace Settings Connections from the Search Console setup state', async () => {
    currentWorkspace = { ...workspace, gscPropertyUrl: undefined };
    renderSurface();

    expect(await screen.findByText('Search Console not configured')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open Workspace Settings' }));

    expect(screen.getByTestId('location')).toHaveTextContent('/ws/ws-1/workspace-settings?tab=connections');
  });

  it('opens Workspace Settings Connections from the GA4 setup state', async () => {
    currentWorkspace = { ...workspace, ga4PropertyId: undefined };
    renderSurface('/ws/ws-1/analytics-hub?lens=traffic');

    expect(await screen.findByText('GA4 not configured')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open Workspace Settings' }));

    expect(screen.getByTestId('location')).toHaveTextContent('/ws/ws-1/workspace-settings?tab=connections');
  });

  it('keeps the lower Search home mounted once when GSC returns no overview', async () => {
    currentSearchOverview = null;
    currentSearchError = 'Search Console returned no overview rows';
    renderSurface();

    expect(await screen.findByText('Search data unavailable')).toBeInTheDocument();
    expect(screen.getAllByText('Demand mix')).toHaveLength(1);
    expect(screen.getAllByText('Priority insights')).toHaveLength(1);
    expect(screen.getByText('Search Console did not return overview data for this window.')).toBeInTheDocument();
  });

  it('uses blue for branded Demand mix share and click metrics', async () => {
    renderSurface();

    const brandedShare = within(screen.getByText('branded').parentElement as HTMLElement).getByText('12.5%');
    const brandedClicks = within(screen.getByText('Branded clicks').parentElement as HTMLElement).getByText('300');

    expect(brandedShare).toHaveStyle({ color: 'var(--blue)' });
    expect(brandedClicks).toHaveStyle({ color: 'var(--blue)' });
  });

  it('meets the a11y floor after skeletons clear', async () => {
    const { container } = renderSurface('/ws/ws-1/analytics-hub?lens=annotations');

    await screen.findByRole('button', { name: 'Add annotation' });
    await waitFor(() => expect(container.querySelectorAll('.animate-pulse').length).toBe(0));
    await expectNoA11yViolations(container);
  });
});
