import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../../src/components/Toast';
import { SearchTrafficSurface } from '../../../src/components/search-traffic-rebuilt/SearchTrafficSurface';
import { queryKeys } from '../../../src/lib/queryKeys';
import { expectNoA11yViolations } from '../a11y';

const getMock = vi.fn();
let capturedWorkspaceHandlers: Record<string, (data?: unknown) => void> = {};

const workspace = {
  id: 'ws-1',
  name: 'Acme Dental',
  webflowSiteId: 'site-1',
  webflowSiteName: 'acme.com',
  gscPropertyUrl: 'https://acme.com/',
  ga4PropertyId: '123',
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

const ga4Overview = {
  totalUsers: 900,
  totalSessions: 1200,
  totalPageviews: 2400,
  avgSessionDuration: 92,
  bounceRate: 41.2,
  newUserPercentage: 64,
  dateRange: { start: '2026-06-01', end: '2026-06-28' },
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
    data: [workspace],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useAnomalyAlerts: () => ({
    data: [],
    isLoading: false,
  }),
}));

vi.mock('../../../src/hooks/admin/useAdminSearch', () => ({
  useAdminSearch: () => ({
    overview: searchOverview,
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
    error: null,
  }),
}));

vi.mock('../../../src/hooks/admin/useAdminGA4', () => ({
  useAdminGA4: () => ({
    overview: ga4Overview,
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
  }),
}));

vi.mock('../../../src/hooks/admin/useAnalyticsOverview', () => ({
  useAnalyticsOverview: () => ({
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
  useAnomalyAlerts: () => ({ data: [], isLoading: false }),
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
  queryClient.setQueryData(queryKeys.shared.featureFlags(), { 'ui-rebuild-shell': true });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <ToastProvider>
          <SearchTrafficSurface workspaceId="ws-1" />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  getMock.mockResolvedValue([
    { date: '2026-05-01', clicks: 12, impressions: 300, ctr: 4, position: 9 },
    { date: '2026-05-02', clicks: 10, impressions: 280, ctr: 3.6, position: 9.2 },
  ]);
  capturedWorkspaceHandlers = {};
});

describe('SearchTrafficSurface', () => {
  it('renders the overview lens with a seeded QueryClient feature-flag cache', async () => {
    renderSurface();

    expect(await screen.findByRole('heading', { name: 'Search & Traffic' })).toBeInTheDocument();
    expect(screen.getByText('Demand mix')).toBeInTheDocument();
    expect(screen.getByTestId('annotated-trend-chart')).toHaveTextContent('chart 2');
    expect(Object.keys(capturedWorkspaceHandlers)).toContain('annotation:bridge_created');
  });

  it('honors the lens deep link and table view params', async () => {
    renderSurface('/ws/ws-1/analytics-hub?lens=search&view=pages&days=90');

    expect(await screen.findByRole('radio', { name: /Search Performance/i })).toHaveAttribute('aria-checked', 'true');
    await waitFor(() => expect(getMock).toHaveBeenCalled());
    expect(screen.getByText('1 page rows')).toBeInTheDocument();
    expect(screen.getByText('/cosmetic-dentistry')).toBeInTheDocument();
  });

  it('meets the a11y floor after skeletons clear', async () => {
    const { container } = renderSurface('/ws/ws-1/analytics-hub?lens=annotations');

    await screen.findByRole('button', { name: 'Add annotation' });
    await waitFor(() => expect(container.querySelectorAll('.animate-pulse').length).toBe(0));
    await expectNoA11yViolations(container);
  });
});
