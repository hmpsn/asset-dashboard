import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Mock external data sources ────────────────────────────────────────────────

const mockGetQueryPageData = vi.fn<() => Promise<unknown[]>>(() => Promise.resolve([]));
const mockGetSearchDeviceBreakdown = vi.fn<() => Promise<unknown[]>>(() => Promise.resolve([]));
const mockGetSearchCountryBreakdown = vi.fn<() => Promise<unknown[]>>(() => Promise.resolve([]));
const mockGetSearchPeriodComparison = vi.fn<() => Promise<unknown | null>>(() => Promise.resolve(null));
const mockGetGA4LandingPages = vi.fn<() => Promise<unknown[]>>(() => Promise.resolve([]));
const mockGetGA4OrganicOverview = vi.fn<() => Promise<unknown | null>>(() => Promise.resolve(null));
const mockGetGA4Conversions = vi.fn<() => Promise<unknown[]>>(() => Promise.resolve([]));
const mockGetGA4EventsByPage = vi.fn<() => Promise<unknown[]>>(() => Promise.resolve([]));

vi.mock('../../server/google-analytics.js', () => ({
  getGA4LandingPages: mockGetGA4LandingPages,
  getGA4OrganicOverview: mockGetGA4OrganicOverview,
  getGA4Conversions: mockGetGA4Conversions,
  getGA4EventsByPage: mockGetGA4EventsByPage,
}));
vi.mock('../../server/search-console.js', () => ({
  getQueryPageData: mockGetQueryPageData,
  getSearchDeviceBreakdown: mockGetSearchDeviceBreakdown,
  getSearchCountryBreakdown: mockGetSearchCountryBreakdown,
  getSearchPeriodComparison: mockGetSearchPeriodComparison,
}));
vi.mock('../../server/logger.js', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn() }),
}));
vi.mock('../../server/errors.js', () => ({
  isProgrammingError: vi.fn(() => false),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

type MinimalWorkspace = {
  id: string;
  webflowSiteId: string;
  gscPropertyUrl?: string;
  ga4PropertyId?: string;
};

function makeWs(overrides: Partial<MinimalWorkspace> = {}): MinimalWorkspace & { webflowSiteId: string } {
  return {
    id: 'ws_search',
    webflowSiteId: 'site_abc',
    ...overrides,
  };
}

const noop = (_step: string, _detail: string, _progress: number) => undefined;

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('fetchKeywordStrategySearchData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetQueryPageData.mockResolvedValue([]);
    mockGetSearchDeviceBreakdown.mockResolvedValue([]);
    mockGetSearchCountryBreakdown.mockResolvedValue([]);
    mockGetSearchPeriodComparison.mockResolvedValue(null);
    mockGetGA4LandingPages.mockResolvedValue([]);
    mockGetGA4OrganicOverview.mockResolvedValue(null);
    mockGetGA4Conversions.mockResolvedValue([]);
    mockGetGA4EventsByPage.mockResolvedValue([]);
  });

  it('returns empty arrays when neither GSC nor GA4 is configured', async () => {
    const { fetchKeywordStrategySearchData } = await import('../../server/keyword-strategy-search-data.js');
    const result = await fetchKeywordStrategySearchData({ ws: makeWs(), sendProgress: noop });

    expect(result.gscData).toEqual([]);
    expect(result.deviceBreakdown).toEqual([]);
    expect(result.countryBreakdown).toEqual([]);
    expect(result.periodComparison).toBeNull();
    expect(result.organicLandingPages).toEqual([]);
    expect(result.organicOverview).toBeNull();
    expect(result.ga4Conversions).toEqual([]);
    expect(result.ga4EventsByPage).toEqual([]);
  });

  it('skips GSC calls when gscPropertyUrl is absent', async () => {
    const { fetchKeywordStrategySearchData } = await import('../../server/keyword-strategy-search-data.js');
    await fetchKeywordStrategySearchData({ ws: makeWs({ gscPropertyUrl: undefined }), sendProgress: noop });

    expect(mockGetQueryPageData).not.toHaveBeenCalled();
    expect(mockGetSearchDeviceBreakdown).not.toHaveBeenCalled();
  });

  it('fetches and returns GSC data when gscPropertyUrl is set', async () => {
    const gscRow = { query: 'emergency plumber', page: '/services', clicks: 20, impressions: 400, position: 5 };
    mockGetQueryPageData.mockResolvedValue([gscRow]);
    mockGetSearchDeviceBreakdown.mockResolvedValue([{ device: 'MOBILE', clicks: 12, impressions: 250, ctr: 0.048, position: 5.2 }]);
    mockGetSearchCountryBreakdown.mockResolvedValue([{ country: 'usa', clicks: 20, impressions: 400, ctr: 0.05, position: 5 }]);

    const { fetchKeywordStrategySearchData } = await import('../../server/keyword-strategy-search-data.js');
    const result = await fetchKeywordStrategySearchData({
      ws: makeWs({ gscPropertyUrl: 'sc-domain:austinplumbing.com' }),
      sendProgress: noop,
    });

    expect(result.gscData).toEqual([gscRow]);
    expect(result.deviceBreakdown).toHaveLength(1);
    expect(result.countryBreakdown).toHaveLength(1);
    expect(mockGetQueryPageData).toHaveBeenCalledWith('site_abc', 'sc-domain:austinplumbing.com', 90);
  });

  it('fetches GA4 data when ga4PropertyId is set', async () => {
    const landingPage = { landingPage: '/services', sessions: 50, users: 40, bounceRate: 0.3, avgEngagementTime: 120, conversions: 5 };
    const overview = {
      organicUsers: 100,
      organicSessions: 120,
      organicPageviews: 200,
      organicBounceRate: 0.35,
      engagementRate: 0.65,
      avgEngagementTime: 130,
      shareOfTotalUsers: 0.4,
      dateRange: { start: '2026-04-27', end: '2026-05-24' },
    };
    mockGetGA4LandingPages.mockResolvedValue([landingPage]);
    mockGetGA4OrganicOverview.mockResolvedValue(overview);

    const { fetchKeywordStrategySearchData } = await import('../../server/keyword-strategy-search-data.js');
    const result = await fetchKeywordStrategySearchData({
      ws: makeWs({ ga4PropertyId: 'properties/123456' }),
      sendProgress: noop,
    });

    expect(result.organicLandingPages).toEqual([landingPage]);
    expect(result.organicOverview).toEqual(overview);
    expect(mockGetGA4LandingPages).toHaveBeenCalledWith('properties/123456', 28, 25, true);
  });

  it('degrades gracefully when GSC fetch throws a non-programming error', async () => {
    mockGetQueryPageData.mockRejectedValue(new Error('GSC timeout'));

    const { fetchKeywordStrategySearchData } = await import('../../server/keyword-strategy-search-data.js');
    const result = await fetchKeywordStrategySearchData({
      ws: makeWs({ gscPropertyUrl: 'sc-domain:austinplumbing.com' }),
      sendProgress: noop,
    });

    // Should return empty arrays rather than throw
    expect(result.gscData).toEqual([]);
    expect(result.deviceBreakdown).toEqual([]);
  });

  it('degrades gracefully when GA4 overview throws', async () => {
    mockGetGA4OrganicOverview.mockRejectedValue(new Error('GA4 quota'));

    const { fetchKeywordStrategySearchData } = await import('../../server/keyword-strategy-search-data.js');
    const result = await fetchKeywordStrategySearchData({
      ws: makeWs({ ga4PropertyId: 'properties/789' }),
      sendProgress: noop,
    });

    // organicOverview uses .catch(() => null) so should survive
    expect(result.organicOverview).toBeNull();
    // The landing pages call should still succeed if it didn't throw
    expect(result.organicLandingPages).toEqual([]);
  });

  it('calls sendProgress multiple times to report sub-steps', async () => {
    const progressCalls: [string, string, number][] = [];
    const sendProgress = (step: string, detail: string, progress: number) => {
      progressCalls.push([step, detail, progress]);
    };

    const { fetchKeywordStrategySearchData } = await import('../../server/keyword-strategy-search-data.js');
    await fetchKeywordStrategySearchData({ ws: makeWs(), sendProgress });

    // At least one progress call should have been made
    expect(progressCalls.length).toBeGreaterThan(0);
    // First call should be the search_data step
    expect(progressCalls[0][0]).toBe('search_data');
  });
});
