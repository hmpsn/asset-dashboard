import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { TrafficDetail } from '../../src/components/TrafficDetail';
import { queryKeys } from '../../src/lib/queryKeys';
import type { AdminGA4Data } from '../../src/hooks/admin/useAdminGA4';
import type { AnalyticsOverviewData } from '../../src/hooks/admin/useAnalyticsOverview';

const useAdminGA4Mock = vi.fn<(...args: unknown[]) => AdminGA4Data>();
const useAnalyticsOverviewMock = vi.fn<(...args: unknown[]) => AnalyticsOverviewData>();
const invalidateQueriesMock = vi.fn();

vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual<typeof import('@tanstack/react-query')>('@tanstack/react-query');
  return {
    ...actual,
    useQueryClient: () => ({ invalidateQueries: invalidateQueriesMock }),
  };
});

vi.mock('../../src/hooks/admin', () => ({
  useAdminGA4: (...args: unknown[]) => useAdminGA4Mock(...args),
}));

vi.mock('../../src/hooks/admin/useAnalyticsOverview', () => ({
  useAnalyticsOverview: (...args: unknown[]) => useAnalyticsOverviewMock(...args),
}));

vi.mock('../../src/hooks/admin/useInsightFeed', () => ({
  useInsightFeed: () => ({ feed: [], isLoading: false }),
}));

vi.mock('../../src/hooks/useToggleSet', () => ({
  useToggleSet: () => [new Set(['users', 'sessions']), vi.fn()],
}));

function baseGa4Data(overrides?: Partial<AdminGA4Data>): AdminGA4Data {
  return {
    overview: {
      totalUsers: 1200,
      totalSessions: 1800,
      totalPageviews: 3200,
      avgSessionDuration: 140,
      bounceRate: 42.1,
      newUserPercentage: 65,
      dateRange: { start: '2026-04-18', end: '2026-05-16' },
    },
    trend: [],
    topPages: [],
    sources: [],
    devices: [],
    countries: [],
    comparison: null,
    newVsReturning: [],
    organic: null,
    landingPages: [],
    conversions: [],
    isLoading: false,
    error: null,
    ...overrides,
  };
}

function baseOverviewData(overrides?: Partial<AnalyticsOverviewData>): AnalyticsOverviewData {
  return {
    gscClicks: 0,
    gscImpressions: 0,
    gscPosition: 0,
    gscClicksDelta: null,
    gscImpressionsDelta: null,
    gscPositionDelta: null,
    ga4Users: 1200,
    ga4Sessions: 1800,
    ga4BounceRate: 42.1,
    ga4UsersDelta: null,
    ga4SessionsDelta: null,
    ga4BounceRateDelta: null,
    trendData: [],
    annotations: [],
    createAnnotation: {
      mutate: vi.fn(),
      mutateAsync: vi.fn(),
      reset: vi.fn(),
      status: 'idle',
      variables: undefined,
      data: undefined,
      error: null,
      isError: false,
      isIdle: true,
      isPending: false,
      isSuccess: false,
      submittedAt: 0,
      failureCount: 0,
      failureReason: null,
      isPaused: false,
    },
    isLoading: false,
    hasGsc: false,
    hasGa4: true,
    ...overrides,
  };
}

describe('TrafficDetail', () => {
  beforeEach(() => {
    useAdminGA4Mock.mockReset();
    useAnalyticsOverviewMock.mockReset();
    invalidateQueriesMock.mockReset();
    useAdminGA4Mock.mockReturnValue(baseGa4Data());
    useAnalyticsOverviewMock.mockReturnValue(baseOverviewData());
  });

  it('renders GA4 not configured state', () => {
    render(<TrafficDetail workspaceId="ws-risk" />);

    expect(screen.getByText('Google Analytics not configured')).toBeInTheDocument();
  });

  it('renders loading state while GA4 data is loading', () => {
    useAdminGA4Mock.mockReturnValue(baseGa4Data({ overview: null, isLoading: true }));

    render(<TrafficDetail workspaceId="ws-risk" ga4PropertyId="ga4-1" />);

    expect(screen.getByText('Loading analytics data...')).toBeInTheDocument();
  });

  it('renders retry state on error and invalidates GA4 query key when retry is clicked', () => {
    useAdminGA4Mock.mockReturnValue(baseGa4Data({ overview: null, error: 'API timeout' }));

    render(<TrafficDetail workspaceId="ws-risk" ga4PropertyId="ga4-1" />);

    expect(screen.getByText('Failed to Load Analytics')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(invalidateQueriesMock).toHaveBeenCalledWith({
      queryKey: queryKeys.admin.ga4All('ws-risk'),
    });
  });
});
