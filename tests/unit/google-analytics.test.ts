import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getGlobalToken: vi.fn(),
  fetch: vi.fn(),
  loggerError: vi.fn(),
}));

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_LOCAL_FAKE_PROVIDERS = process.env.LOCAL_FAKE_PROVIDERS;

vi.mock('../../server/google-auth.js', () => ({
  getGlobalToken: mocks.getGlobalToken,
}));

vi.mock('../../server/logger.js', () => ({
  createLogger: () => ({
    error: mocks.loggerError,
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.stubGlobal('fetch', mocks.fetch);

describe('google-analytics behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-25T12:00:00.000Z'));
    mocks.getGlobalToken.mockResolvedValue('ga-token');
  });

  afterEach(() => {
    vi.useRealTimers();
    process.env.NODE_ENV = ORIGINAL_NODE_ENV;
    process.env.LOCAL_FAKE_PROVIDERS = ORIGINAL_LOCAL_FAKE_PROVIDERS;
  });

  it('serves the explicit provider-rich property without auth or network calls in local fixture mode', async () => {
    process.env.NODE_ENV = 'development';
    process.env.LOCAL_FAKE_PROVIDERS = 'true';
    mocks.getGlobalToken.mockResolvedValue(null);

    const { LOCAL_PROVIDER_FIXTURE } = await import('../../server/providers/local-provider-fixtures.js');
    const {
      getGA4Countries,
      getGA4DailyTrend,
      getGA4DeviceBreakdown,
      getGA4Overview,
      getGA4PeriodComparison,
      getGA4TopPages,
      getGA4TopSources,
    } = await import('../../server/google-analytics.js');

    const [overview, trend, pages, sources, devices, countries, comparison] = await Promise.all([
      getGA4Overview(LOCAL_PROVIDER_FIXTURE.ga4PropertyId),
      getGA4DailyTrend(LOCAL_PROVIDER_FIXTURE.ga4PropertyNumericId),
      getGA4TopPages(LOCAL_PROVIDER_FIXTURE.ga4PropertyId),
      getGA4TopSources(LOCAL_PROVIDER_FIXTURE.ga4PropertyId),
      getGA4DeviceBreakdown(LOCAL_PROVIDER_FIXTURE.ga4PropertyId),
      getGA4Countries(LOCAL_PROVIDER_FIXTURE.ga4PropertyId),
      getGA4PeriodComparison(LOCAL_PROVIDER_FIXTURE.ga4PropertyId),
    ]);

    expect(overview.totalUsers).toBeGreaterThan(0);
    expect(trend.length).toBeGreaterThanOrEqual(14);
    expect(pages[0]?.path).toBe('/');
    expect(sources[0]).toMatchObject({ source: 'google', medium: 'organic' });
    expect(devices.map((row) => row.device)).toEqual(['desktop', 'mobile', 'tablet']);
    expect(countries[0]?.country).toBe('United States');
    expect(comparison.current.totalSessions).toBeGreaterThan(comparison.previous.totalSessions);
    expect(mocks.getGlobalToken).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('throws auth error before any fetch when global token is unavailable', async () => {
    mocks.getGlobalToken.mockResolvedValue(null);

    const { getGA4Overview } = await import('../../server/google-analytics.js');

    await expect(getGA4Overview('prop-1')).rejects.toThrow('Google not connected');
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('surfaces runReport provider failures with status code and logs error', async () => {
    mocks.fetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      text: async () => 'forbidden',
    });

    const { getGA4TopPages } = await import('../../server/google-analytics.js');

    await expect(getGA4TopPages('prop-1')).rejects.toThrow('GA4 report failed: 403');
    expect(mocks.loggerError).toHaveBeenCalled();
  });

  it('falls back to default range when custom dateRange is malformed in period comparison', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    mocks.fetch.mockImplementation(async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
      return {
        ok: true,
        json: async () => ({
          rows: [
            { metricValues: [{ value: '10' }, { value: '20' }, { value: '30' }, { value: '40' }, { value: '0.5' }, { value: '4' }] },
            { metricValues: [{ value: '5' }, { value: '10' }, { value: '15' }, { value: '20' }, { value: '0.6' }, { value: '2' }] },
          ],
        }),
      };
    });

    const { getGA4PeriodComparison } = await import('../../server/google-analytics.js');

    const result = await getGA4PeriodComparison('prop-1', 28, {
      startDate: 'not-a-date',
      endDate: '2026-13-99',
    });

    expect(result.current.dateRange).toEqual({
      start: '2026-04-27',
      end: '2026-05-24',
    });
    expect(result.previous.dateRange).toEqual({
      start: '2026-03-30',
      end: '2026-04-26',
    });

    const dateRanges = bodies[0]?.dateRanges as Array<{ startDate: string; endDate: string }>;
    expect(dateRanges).toEqual([
      { startDate: '2026-04-27', endDate: '2026-05-24' },
      { startDate: '2026-03-30', endDate: '2026-04-26' },
    ]);
  });

  it('handles malformed metric payload values without throwing (degrades to finite numbers)', async () => {
    mocks.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        rows: [
          {
            metricValues: [
              { value: 'oops' },
              { value: '' },
              { value: 'NaN' },
              { value: 'bad-float' },
              { value: '' },
              { value: '??' },
            ],
          },
        ],
      }),
    });

    const { getGA4Overview } = await import('../../server/google-analytics.js');
    const result = await getGA4Overview('prop-1', 28);

    expect(Number.isFinite(result.totalUsers)).toBe(true);
    expect(Number.isFinite(result.totalSessions)).toBe(true);
    expect(Number.isFinite(result.totalPageviews)).toBe(true);
    expect(Number.isFinite(result.avgSessionDuration)).toBe(true);
    expect(Number.isFinite(result.bounceRate)).toBe(true);
    expect(Number.isFinite(result.newUserPercentage)).toBe(true);
  });
});
