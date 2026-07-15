/**
 * Unit tests for server/google-analytics.ts — GA4 API response parsing,
 * data normalization, aggregation logic, and URL normalization.
 *
 * All external dependencies (google-auth, fetch) are mocked via vi.hoisted().
 * No HTTP server, no createTestContext, no port needed.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Mock setup ────────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  getGlobalToken: vi.fn<[], Promise<string | null>>(),
  fetch: vi.fn(),
}));

vi.mock('../../server/google-auth.js', () => ({
  getGlobalToken: mocks.getGlobalToken,
}));

vi.mock('../../server/logger.js', () => ({
  createLogger: () => ({
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Patch global fetch
vi.stubGlobal('fetch', mocks.fetch);

import {
  listGA4Properties,
  getGA4Overview,
  getGA4DailyTrend,
  getGA4TopPages,
  getGA4TopSources,
  getGA4DeviceBreakdown,
  getGA4KeyEvents,
  getGA4EventTrend,
  getGA4Conversions,
  getGA4EventsByPage,
  getGA4LandingPages,
  getGA4PageOrganicTrafficMap,
  getGA4OrganicOverview,
  getGA4PeriodComparison,
  getGA4NewVsReturning,
  getGA4Countries,
  getTopDroppedGA4Page,
  getTopSpikedGA4Page,
} from '../../server/google-analytics.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

type DimRow = { dimensionValues: Array<{ value: string }>; metricValues: Array<{ value: string }> };

function mockFetchOk(jsonBody: unknown): void {
  mocks.fetch.mockResolvedValue({
    ok: true,
    json: async () => jsonBody,
    text: async () => JSON.stringify(jsonBody),
  });
}

function mockFetchFail(status: number, body = 'API Error'): void {
  mocks.fetch.mockResolvedValue({
    ok: false,
    status,
    text: async () => body,
  });
}

function makeRow(dims: string[], metrics: string[]): DimRow {
  return {
    dimensionValues: dims.map(v => ({ value: v })),
    metricValues: metrics.map(v => ({ value: v })),
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  mocks.getGlobalToken.mockResolvedValue('test-token');
  mocks.fetch.mockReset();
});

// ─── listGA4Properties ────────────────────────────────────────────────────────

describe('listGA4Properties', () => {
  it('returns empty array when accountSummaries is absent', async () => {
    mockFetchOk({});
    const result = await listGA4Properties();
    expect(result).toEqual([]);
  });

  it('returns empty array when accountSummaries is empty', async () => {
    mockFetchOk({ accountSummaries: [] });
    const result = await listGA4Properties();
    expect(result).toEqual([]);
  });

  it('parses properties from accountSummaries correctly', async () => {
    mockFetchOk({
      accountSummaries: [
        {
          account: 'accounts/111',
          displayName: 'Acme Corp',
          propertySummaries: [
            { property: 'properties/123456789', displayName: 'Main Site' },
            { property: 'properties/987654321', displayName: 'Blog' },
          ],
        },
      ],
    });

    const result = await listGA4Properties();
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      name: 'properties/123456789',
      displayName: 'Main Site (Acme Corp)',
      propertyId: '123456789',
    });
    expect(result[1]).toEqual({
      name: 'properties/987654321',
      displayName: 'Blog (Acme Corp)',
      propertyId: '987654321',
    });
  });

  it('strips the "properties/" prefix from propertyId', async () => {
    mockFetchOk({
      accountSummaries: [
        {
          account: 'accounts/1',
          displayName: 'Org',
          propertySummaries: [{ property: 'properties/42', displayName: 'X' }],
        },
      ],
    });
    const [prop] = await listGA4Properties();
    expect(prop.propertyId).toBe('42');
    expect(prop.name).toBe('properties/42');
  });

  it('flattens properties across multiple accounts', async () => {
    mockFetchOk({
      accountSummaries: [
        {
          account: 'accounts/1',
          displayName: 'Alpha',
          propertySummaries: [{ property: 'properties/1', displayName: 'A1' }],
        },
        {
          account: 'accounts/2',
          displayName: 'Beta',
          propertySummaries: [
            { property: 'properties/2', displayName: 'B1' },
            { property: 'properties/3', displayName: 'B2' },
          ],
        },
      ],
    });
    const result = await listGA4Properties();
    expect(result).toHaveLength(3);
  });

  it('handles account with no propertySummaries', async () => {
    mockFetchOk({
      accountSummaries: [
        { account: 'accounts/1', displayName: 'No Props' },
      ],
    });
    const result = await listGA4Properties();
    expect(result).toEqual([]);
  });

  it('throws when Google not connected', async () => {
    mocks.getGlobalToken.mockResolvedValue(null);
    await expect(listGA4Properties()).rejects.toThrow('Google not connected');
  });

  it('throws when API returns non-OK status', async () => {
    mockFetchFail(403, 'Forbidden');
    await expect(listGA4Properties()).rejects.toThrow('Failed to list GA4 properties: 403');
  });

  it('surfaces invalid JSON as a provider-classified parity error', async () => {
    mocks.fetch.mockResolvedValue(new Response('not-json', {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    await expect(listGA4Properties()).rejects.toThrow('Failed to list GA4 properties: invalid-json');
  });
});

// ─── getGA4Overview ───────────────────────────────────────────────────────────

describe('getGA4Overview', () => {
  it('parses all metric fields correctly', async () => {
    mockFetchOk({
      rows: [
        { metricValues: [
          { value: '1000' }, // totalUsers
          { value: '1500' }, // sessions
          { value: '3000' }, // screenPageViews
          { value: '120.5' }, // averageSessionDuration
          { value: '0.35' }, // bounceRate
          { value: '600' },  // newUsers
        ]},
      ],
    });

    const result = await getGA4Overview('prop123', 28);
    expect(result.totalUsers).toBe(1000);
    expect(result.totalSessions).toBe(1500);
    expect(result.totalPageviews).toBe(3000);
    expect(result.avgSessionDuration).toBe(120.5);
    expect(result.bounceRate).toBe(35);
    expect(result.newUserPercentage).toBe(60.0); // 600/1000 * 100
  });

  it('handles missing rows gracefully (all zeros)', async () => {
    mockFetchOk({ rows: [] });
    const result = await getGA4Overview('prop123', 28);
    expect(result.totalUsers).toBe(0);
    expect(result.totalSessions).toBe(0);
    expect(result.totalPageviews).toBe(0);
    expect(result.avgSessionDuration).toBe(0);
    expect(result.bounceRate).toBe(0);
    expect(result.newUserPercentage).toBe(0);
  });

  it('returns 0 newUserPercentage when totalUsers is 0', async () => {
    mockFetchOk({
      rows: [
        { metricValues: [
          { value: '0' }, { value: '0' }, { value: '0' },
          { value: '0' }, { value: '0' }, { value: '100' },
        ]},
      ],
    });
    const result = await getGA4Overview('prop123');
    expect(result.newUserPercentage).toBe(0);
  });

  it('uses provided dateRange over computed dates', async () => {
    mockFetchOk({ rows: [] });
    const result = await getGA4Overview('prop123', 28, {
      startDate: '2025-01-01',
      endDate: '2025-01-31',
    });
    expect(result.dateRange.start).toBe('2025-01-01');
    expect(result.dateRange.end).toBe('2025-01-31');
  });

  it('includes dateRange in the response', async () => {
    mockFetchOk({ rows: [] });
    const result = await getGA4Overview('prop123', 28, {
      startDate: '2024-06-01',
      endDate: '2024-06-28',
    });
    expect(result.dateRange).toEqual({ start: '2024-06-01', end: '2024-06-28' });
  });

  it('throws when token is not available', async () => {
    mocks.getGlobalToken.mockResolvedValue(null);
    await expect(getGA4Overview('prop123')).rejects.toThrow('Google not connected');
  });

  it('throws when API report fails', async () => {
    mockFetchFail(500);
    await expect(getGA4Overview('prop123')).rejects.toThrow('GA4 report failed: 500');
  });

  it('newUserPercentage rounds to 1 decimal place', async () => {
    mockFetchOk({
      rows: [
        { metricValues: [
          { value: '3' },  // totalUsers
          { value: '5' },  // sessions (unused for this calc)
          { value: '0' }, { value: '0' }, { value: '0' },
          { value: '1' },  // newUsers = 33.333...%
        ]},
      ],
    });
    const result = await getGA4Overview('prop123');
    expect(result.newUserPercentage).toBe(33.3);
  });
});

// ─── getGA4DailyTrend ─────────────────────────────────────────────────────────

describe('getGA4DailyTrend', () => {
  it('parses and reformats date from YYYYMMDD to YYYY-MM-DD', async () => {
    mockFetchOk({
      rows: [
        makeRow(['20250115'], ['100', '150', '300']),
        makeRow(['20250116'], ['120', '180', '360']),
      ],
    });

    const result = await getGA4DailyTrend('prop123', 28);
    expect(result).toHaveLength(2);
    expect(result[0].date).toBe('2025-01-15');
    expect(result[1].date).toBe('2025-01-16');
  });

  it('parses user, session, pageview counts as integers', async () => {
    mockFetchOk({
      rows: [makeRow(['20250101'], ['42', '65', '130'])],
    });

    const result = await getGA4DailyTrend('prop123');
    expect(result[0].users).toBe(42);
    expect(result[0].sessions).toBe(65);
    expect(result[0].pageviews).toBe(130);
  });

  it('returns empty array when no rows', async () => {
    mockFetchOk({ rows: [] });
    const result = await getGA4DailyTrend('prop123');
    expect(result).toEqual([]);
  });

  it('returns empty array when rows is undefined', async () => {
    mockFetchOk({});
    const result = await getGA4DailyTrend('prop123');
    expect(result).toEqual([]);
  });

  it('uses custom dateRange when provided', async () => {
    mockFetchOk({ rows: [] });
    // Verify the call was made (the dateRange params reach runReport)
    await getGA4DailyTrend('prop123', 28, { startDate: '2024-01-01', endDate: '2024-01-28' });
    const callBody = JSON.parse(mocks.fetch.mock.calls[0][1].body);
    expect(callBody.dateRanges[0].startDate).toBe('2024-01-01');
    expect(callBody.dateRanges[0].endDate).toBe('2024-01-28');
  });
});

// ─── getGA4TopPages ───────────────────────────────────────────────────────────

describe('getGA4TopPages', () => {
  it('parses path, pageviews, users, sessions correctly', async () => {
    mockFetchOk({
      rows: [
        makeRow(['/blog/seo-tips'], ['1200', '800', '900', '96000']),
        makeRow(['/about'], ['300', '200', '250', '10000']),
      ],
    });

    const result = await getGA4TopPages('prop123');
    expect(result).toHaveLength(2);
    expect(result[0].path).toBe('/blog/seo-tips');
    expect(result[0].pageviews).toBe(1200);
    expect(result[0].users).toBe(800);
    expect(result[0].sessions).toBe(900);
  });

  it('computes avgEngagementTime as total duration / sessions', async () => {
    // userEngagementDuration = 9600 seconds total, sessions = 900
    mockFetchOk({
      rows: [makeRow(['/blog/post'], ['1200', '800', '900', '9600'])],
    });

    const result = await getGA4TopPages('prop123');
    expect(result[0].avgEngagementTime).toBeCloseTo(9600 / 900, 5);
  });

  it('sets avgEngagementTime to 0 when sessions is 0', async () => {
    mockFetchOk({
      rows: [makeRow(['/page'], ['0', '0', '0', '1000'])],
    });

    const result = await getGA4TopPages('prop123');
    expect(result[0].avgEngagementTime).toBe(0);
  });

  it('returns empty array when no rows', async () => {
    mockFetchOk({});
    const result = await getGA4TopPages('prop123');
    expect(result).toEqual([]);
  });
});

// ─── getGA4TopSources ─────────────────────────────────────────────────────────

describe('getGA4TopSources', () => {
  it('parses source, medium, users, sessions', async () => {
    mockFetchOk({
      rows: [
        makeRow(['google', 'organic'], ['500', '600']),
        makeRow(['direct', '(none)'], ['200', '220']),
        makeRow(['newsletter', 'email'], ['100', '110']),
      ],
    });

    const result = await getGA4TopSources('prop123');
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ source: 'google', medium: 'organic', users: 500, sessions: 600 });
    expect(result[1]).toEqual({ source: 'direct', medium: '(none)', users: 200, sessions: 220 });
    expect(result[2]).toEqual({ source: 'newsletter', medium: 'email', users: 100, sessions: 110 });
  });

  it('returns empty array when no rows', async () => {
    mockFetchOk({});
    const result = await getGA4TopSources('prop123');
    expect(result).toEqual([]);
  });
});

// ─── getGA4DeviceBreakdown ────────────────────────────────────────────────────

describe('getGA4DeviceBreakdown', () => {
  it('computes percentage correctly from sessions', async () => {
    mockFetchOk({
      rows: [
        makeRow(['desktop'], ['600', '700']),   // 700 sessions
        makeRow(['mobile'], ['350', '250']),    // 250 sessions
        makeRow(['tablet'], ['50', '50']),      // 50 sessions
      ],
    });

    const result = await getGA4DeviceBreakdown('prop123');
    expect(result).toHaveLength(3);
    const total = 700 + 250 + 50; // 1000
    expect(result[0].percentage).toBeCloseTo((700 / total) * 100, 1);
    expect(result[1].percentage).toBeCloseTo((250 / total) * 100, 1);
    expect(result[2].percentage).toBeCloseTo((50 / total) * 100, 1);
  });

  it('percentages sum to approximately 100', async () => {
    mockFetchOk({
      rows: [
        makeRow(['desktop'], ['600', '700']),
        makeRow(['mobile'], ['350', '250']),
        makeRow(['tablet'], ['50', '50']),
      ],
    });

    const result = await getGA4DeviceBreakdown('prop123');
    const sum = result.reduce((s, r) => s + r.percentage, 0);
    expect(sum).toBeCloseTo(100, 0);
  });

  it('sets percentage to 0 when totalSessions is 0', async () => {
    mockFetchOk({
      rows: [makeRow(['desktop'], ['0', '0'])],
    });

    const result = await getGA4DeviceBreakdown('prop123');
    expect(result[0].percentage).toBe(0);
  });

  it('returns empty array when no rows', async () => {
    mockFetchOk({ rows: [] });
    const result = await getGA4DeviceBreakdown('prop123');
    expect(result).toEqual([]);
  });

  it('parses device name as string dimension', async () => {
    mockFetchOk({
      rows: [makeRow(['smart tv'], ['10', '15'])],
    });

    const result = await getGA4DeviceBreakdown('prop123');
    expect(result[0].device).toBe('smart tv');
  });
});

// ─── getGA4KeyEvents ──────────────────────────────────────────────────────────

describe('getGA4KeyEvents', () => {
  it('parses eventName, eventCount, users', async () => {
    mockFetchOk({
      rows: [
        makeRow(['purchase'], ['1200', '800']),
        makeRow(['sign_up'], ['300', '290']),
        makeRow(['contact_form_submit'], ['150', '145']),
      ],
    });

    const result = await getGA4KeyEvents('prop123');
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ eventName: 'purchase', eventCount: 1200, users: 800 });
    expect(result[1]).toEqual({ eventName: 'sign_up', eventCount: 300, users: 290 });
  });

  it('returns empty array when no rows', async () => {
    mockFetchOk({});
    const result = await getGA4KeyEvents('prop123');
    expect(result).toEqual([]);
  });
});

// ─── getGA4EventTrend ─────────────────────────────────────────────────────────

describe('getGA4EventTrend', () => {
  it('parses date and eventCount per day', async () => {
    mockFetchOk({
      rows: [
        makeRow(['20250101'], ['10']),
        makeRow(['20250102'], ['15']),
        makeRow(['20250103'], ['8']),
      ],
    });

    const result = await getGA4EventTrend('prop123', 'purchase');
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ date: '2025-01-01', eventCount: 10 });
    expect(result[1]).toEqual({ date: '2025-01-02', eventCount: 15 });
    expect(result[2]).toEqual({ date: '2025-01-03', eventCount: 8 });
  });

  it('reformats YYYYMMDD date to YYYY-MM-DD', async () => {
    mockFetchOk({
      rows: [makeRow(['20251225'], ['5'])],
    });

    const result = await getGA4EventTrend('prop123', 'purchase');
    expect(result[0].date).toBe('2025-12-25');
  });

  it('returns empty array when no rows', async () => {
    mockFetchOk({});
    const result = await getGA4EventTrend('prop123', 'purchase');
    expect(result).toEqual([]);
  });

  it('passes eventName filter in request body', async () => {
    mockFetchOk({ rows: [] });
    await getGA4EventTrend('prop123', 'contact_form');
    const body = JSON.parse(mocks.fetch.mock.calls[0][1].body);
    expect(body.dimensionFilter.filter.stringFilter.value).toBe('contact_form');
    expect(body.dimensionFilter.filter.stringFilter.matchType).toBe('EXACT');
  });
});

// ─── getGA4Conversions ────────────────────────────────────────────────────────

describe('getGA4Conversions', () => {
  it('queries GA4 key events only', async () => {
    // First call: overview (totalUsers)
    mocks.fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          rows: [{ metricValues: [{ value: '1000' }] }],
        }),
      })
      // Second call: events list
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          rows: [
            makeRow(['purchase'], ['500', '250']),
            makeRow(['sign_up'], ['300', '280']),
          ],
        }),
      });

    const result = await getGA4Conversions('prop123');
    const requestBody = JSON.parse(mocks.fetch.mock.calls[1][1].body);
    expect(requestBody.metrics[0].name).toBe('keyEvents');
    expect(requestBody.dimensionFilter.filter.fieldName).toBe('isKeyEvent');
    expect(requestBody.dimensionFilter.filter.stringFilter).toEqual({
      matchType: 'EXACT',
      value: 'true',
    });
    expect(requestBody.orderBys[0].metric.metricName).toBe('keyEvents');

    const eventNames = result.map(r => r.eventName);
    expect(eventNames).toEqual(['purchase', 'sign_up']);
  });

  it('computes conversion rate as users/totalUsers * 100', async () => {
    mocks.fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ rows: [{ metricValues: [{ value: '1000' }] }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          rows: [makeRow(['purchase'], ['500', '100'])], // 100 users out of 1000 total
        }),
      });

    const result = await getGA4Conversions('prop123');
    expect(result[0].rate).toBeCloseTo(10.0, 2); // 100/1000 * 100 = 10%
  });

  it('sets rate to 0 when totalUsers is 0', async () => {
    mocks.fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ rows: [{ metricValues: [{ value: '0' }] }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          rows: [makeRow(['purchase'], ['500', '100'])],
        }),
      });

    const result = await getGA4Conversions('prop123');
    expect(result[0].rate).toBe(0);
  });

  it('limits key event results to 15 items', async () => {
    // Generate 20 key event rows from GA4.
    const events = Array.from({ length: 20 }, (_, i) =>
      makeRow([`custom_event_${i}`], [`${100 + i}`, `${50 + i}`])
    );

    mocks.fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ rows: [{ metricValues: [{ value: '1000' }] }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ rows: events }),
      });

    const result = await getGA4Conversions('prop123');
    expect(result.length).toBeLessThanOrEqual(15);
  });

  it('returns empty when no rows returned', async () => {
    mocks.fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ rows: [{ metricValues: [{ value: '0' }] }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ rows: [] }),
      });

    const result = await getGA4Conversions('prop123');
    expect(result).toEqual([]);
  });

  it('rate rounds to 2 decimal places', async () => {
    mocks.fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ rows: [{ metricValues: [{ value: '300' }] }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          rows: [makeRow(['purchase'], ['100', '100'])], // 100/300 = 33.333...%
        }),
      });

    const result = await getGA4Conversions('prop123');
    expect(result[0].rate).toBe(33.33);
  });
});

// ─── getGA4EventsByPage ───────────────────────────────────────────────────────

describe('getGA4EventsByPage', () => {
  it('parses eventName, pagePath, eventCount, users', async () => {
    mockFetchOk({
      rows: [
        makeRow(['purchase', '/checkout'], ['50', '45']),
        makeRow(['sign_up', '/register'], ['30', '29']),
      ],
    });

    const result = await getGA4EventsByPage('prop123');
    expect(result[0]).toEqual({
      eventName: 'purchase',
      pagePath: '/checkout',
      eventCount: 50,
      users: 45,
    });
    expect(result[1]).toEqual({
      eventName: 'sign_up',
      pagePath: '/register',
      eventCount: 30,
      users: 29,
    });
  });

  it('sends no dimensionFilter when no options provided', async () => {
    mockFetchOk({ rows: [] });
    await getGA4EventsByPage('prop123', 28, {});
    const body = JSON.parse(mocks.fetch.mock.calls[0][1].body);
    expect(body.dimensionFilter).toBeUndefined();
  });

  it('sends single filter when only eventName provided', async () => {
    mockFetchOk({ rows: [] });
    await getGA4EventsByPage('prop123', 28, { eventName: 'purchase' });
    const body = JSON.parse(mocks.fetch.mock.calls[0][1].body);
    expect(body.dimensionFilter.filter.fieldName).toBe('eventName');
    expect(body.dimensionFilter.filter.stringFilter.value).toBe('purchase');
    expect(body.dimensionFilter.filter.stringFilter.matchType).toBe('EXACT');
  });

  it('sends single CONTAINS filter when only pagePath provided', async () => {
    mockFetchOk({ rows: [] });
    await getGA4EventsByPage('prop123', 28, { pagePath: '/blog' });
    const body = JSON.parse(mocks.fetch.mock.calls[0][1].body);
    expect(body.dimensionFilter.filter.fieldName).toBe('pagePath');
    expect(body.dimensionFilter.filter.stringFilter.matchType).toBe('CONTAINS');
    expect(body.dimensionFilter.filter.stringFilter.value).toBe('/blog');
  });

  it('sends andGroup filter when both eventName and pagePath provided', async () => {
    mockFetchOk({ rows: [] });
    await getGA4EventsByPage('prop123', 28, { eventName: 'purchase', pagePath: '/checkout' });
    const body = JSON.parse(mocks.fetch.mock.calls[0][1].body);
    expect(body.dimensionFilter.andGroup.expressions).toHaveLength(2);
    const fieldNames = body.dimensionFilter.andGroup.expressions.map(
      (e: { filter: { fieldName: string } }) => e.filter.fieldName
    );
    expect(fieldNames).toContain('eventName');
    expect(fieldNames).toContain('pagePath');
  });

  it('returns empty array when no rows', async () => {
    mockFetchOk({});
    const result = await getGA4EventsByPage('prop123');
    expect(result).toEqual([]);
  });

  it('uses custom limit from options', async () => {
    mockFetchOk({ rows: [] });
    await getGA4EventsByPage('prop123', 28, { limit: 100 });
    const body = JSON.parse(mocks.fetch.mock.calls[0][1].body);
    expect(body.limit).toBe(100);
  });

  it('defaults limit to 50', async () => {
    mockFetchOk({ rows: [] });
    await getGA4EventsByPage('prop123', 28, {});
    const body = JSON.parse(mocks.fetch.mock.calls[0][1].body);
    expect(body.limit).toBe(50);
  });
});

// ─── getGA4LandingPages ───────────────────────────────────────────────────────

describe('getGA4LandingPages', () => {
  it('parses all landing page fields correctly', async () => {
    mockFetchOk({
      rows: [
        makeRow(['/'], ['1000', '800', '0.4', '2000', '50']),
        makeRow(['/blog'], ['500', '400', '0.3', '1500', '20']),
      ],
    });

    const result = await getGA4LandingPages('prop123');
    expect(result).toHaveLength(2);
    expect(result[0].landingPage).toBe('/');
    expect(result[0].sessions).toBe(1000);
    expect(result[0].users).toBe(800);
    expect(result[0].conversions).toBe(50);
  });

  it('computes avgEngagementTime as userEngagementDuration / sessions', async () => {
    mockFetchOk({
      rows: [makeRow(['/service'], ['200', '150', '0.35', '3000', '10'])],
    });

    const result = await getGA4LandingPages('prop123');
    expect(result[0].avgEngagementTime).toBeCloseTo(3000 / 200, 5);
  });

  it('sets avgEngagementTime to 0 when sessions is 0', async () => {
    mockFetchOk({
      rows: [makeRow(['/page'], ['0', '0', '0', '1000', '0'])],
    });

    const result = await getGA4LandingPages('prop123');
    expect(result[0].avgEngagementTime).toBe(0);
  });

  it('rounds bounceRate to 1 decimal', async () => {
    mockFetchOk({
      rows: [makeRow(['/test'], ['100', '80', '0.345', '500', '5'])],
    });

    const result = await getGA4LandingPages('prop123');
    expect(result[0].bounceRate).toBe(34.5);
  });

  it('sends organic filter when organicOnly=true', async () => {
    mockFetchOk({ rows: [] });
    await getGA4LandingPages('prop123', 28, 25, true);
    const body = JSON.parse(mocks.fetch.mock.calls[0][1].body);
    expect(body.dimensionFilter.filter.fieldName).toBe('sessionDefaultChannelGroup');
    expect(body.dimensionFilter.filter.stringFilter.value).toBe('Organic Search');
  });

  it('sends no dimensionFilter when organicOnly=false', async () => {
    mockFetchOk({ rows: [] });
    await getGA4LandingPages('prop123', 28, 25, false);
    const body = JSON.parse(mocks.fetch.mock.calls[0][1].body);
    expect(body.dimensionFilter).toBeUndefined();
  });

  it('returns empty array when no rows', async () => {
    mockFetchOk({});
    const result = await getGA4LandingPages('prop123');
    expect(result).toEqual([]);
  });
});

describe('getGA4PageOrganicTrafficMap', () => {
  it('returns a normalized organic landing-page sessions map', async () => {
    mockFetchOk({
      rows: [
        makeRow(['/Services/SEO/'], ['123', '100', '0.2', '400', '4']),
        makeRow(['https://example.com/blog/post?utm=ignored'], ['45', '40', '0.3', '300', '1']),
      ],
    });

    const result = await getGA4PageOrganicTrafficMap('prop123', 28, 500);
    expect(result.get('/services/seo')).toBe(123);
    expect(result.get('/blog/post')).toBe(45);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });
});

// ─── getGA4OrganicOverview ────────────────────────────────────────────────────

describe('getGA4OrganicOverview', () => {
  function setupOrganicMocks(organicMetrics: string[], totalUsers: string): void {
    mocks.fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          rows: [{ metricValues: organicMetrics.map(v => ({ value: v })) }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          rows: [{ metricValues: [{ value: totalUsers }] }],
        }),
      });
  }

  it('parses all organic overview metrics correctly', async () => {
    setupOrganicMocks(
      ['500', '600', '1200', '0.35', '0.65', '7200'],
      '2000'
    );

    const result = await getGA4OrganicOverview('prop123');
    expect(result.organicUsers).toBe(500);
    expect(result.organicSessions).toBe(600);
    expect(result.organicPageviews).toBe(1200);
    expect(result.organicBounceRate).toBe(35);
    expect(result.engagementRate).toBe(65);
  });

  it('computes avgEngagementTime as totalDuration / organicSessions', async () => {
    setupOrganicMocks(
      ['500', '600', '1200', '0.35', '0.65', '7200'],
      '2000'
    );

    const result = await getGA4OrganicOverview('prop123');
    expect(result.avgEngagementTime).toBeCloseTo(7200 / 600, 5);
  });

  it('computes shareOfTotalUsers as organicUsers/totalUsers * 100', async () => {
    setupOrganicMocks(
      ['500', '600', '1200', '0.35', '0.65', '7200'],
      '2000'
    );

    const result = await getGA4OrganicOverview('prop123');
    expect(result.shareOfTotalUsers).toBeCloseTo((500 / 2000) * 100, 1); // 25.0
  });

  it('sets shareOfTotalUsers to 0 when totalUsers is 0', async () => {
    setupOrganicMocks(
      ['0', '0', '0', '0', '0', '0'],
      '0'
    );

    const result = await getGA4OrganicOverview('prop123');
    expect(result.shareOfTotalUsers).toBe(0);
  });

  it('sets avgEngagementTime to 0 when organicSessions is 0', async () => {
    setupOrganicMocks(
      ['0', '0', '0', '0', '0', '0'],
      '0'
    );

    const result = await getGA4OrganicOverview('prop123');
    expect(result.avgEngagementTime).toBe(0);
  });

  it('returns dateRange from provided custom range', async () => {
    setupOrganicMocks(
      ['100', '120', '300', '0.3', '0.7', '1200'],
      '500'
    );

    const result = await getGA4OrganicOverview('prop123', 28, {
      startDate: '2025-03-01',
      endDate: '2025-03-28',
    });
    expect(result.dateRange).toEqual({ start: '2025-03-01', end: '2025-03-28' });
  });

  it('handles missing organic rows gracefully', async () => {
    mocks.fetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ rows: [] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ rows: [{ metricValues: [{ value: '1000' }] }] }) });

    const result = await getGA4OrganicOverview('prop123');
    expect(result.organicUsers).toBe(0);
    expect(result.shareOfTotalUsers).toBe(0);
  });
});

// ─── getGA4PeriodComparison ───────────────────────────────────────────────────

describe('getGA4PeriodComparison', () => {
  it('parses current and previous period from dual-row response', async () => {
    mockFetchOk({
      rows: [
        // current: row[0]
        { metricValues: [
          { value: '1000' }, { value: '1200' }, { value: '3000' },
          { value: '90' }, { value: '0.4' }, { value: '200' },
        ]},
        // previous: row[1]
        { metricValues: [
          { value: '800' }, { value: '900' }, { value: '2500' },
          { value: '85' }, { value: '0.5' }, { value: '150' },
        ]},
      ],
    });

    const result = await getGA4PeriodComparison('prop123', 28, {
      startDate: '2025-01-01',
      endDate: '2025-01-28',
    });

    expect(result.current.totalUsers).toBe(1000);
    expect(result.current.totalSessions).toBe(1200);
    expect(result.previous.totalUsers).toBe(800);
    expect(result.previous.totalSessions).toBe(900);
  });

  it('computes absolute change between periods', async () => {
    mockFetchOk({
      rows: [
        { metricValues: [
          { value: '1000' }, { value: '1200' }, { value: '3000' },
          { value: '90' }, { value: '0.4' }, { value: '200' },
        ]},
        { metricValues: [
          { value: '800' }, { value: '900' }, { value: '2500' },
          { value: '85' }, { value: '0.5' }, { value: '150' },
        ]},
      ],
    });

    const result = await getGA4PeriodComparison('prop123', 28, {
      startDate: '2025-01-01',
      endDate: '2025-01-28',
    });

    expect(result.change.users).toBe(200);       // 1000 - 800
    expect(result.change.sessions).toBe(300);    // 1200 - 900
    expect(result.change.pageviews).toBe(500);   // 3000 - 2500
  });

  it('computes changePercent correctly', async () => {
    mockFetchOk({
      rows: [
        { metricValues: [
          { value: '1000' }, { value: '1200' }, { value: '3000' },
          { value: '90' }, { value: '0.4' }, { value: '200' },
        ]},
        { metricValues: [
          { value: '800' }, { value: '1000' }, { value: '2000' },
          { value: '85' }, { value: '0.5' }, { value: '150' },
        ]},
      ],
    });

    const result = await getGA4PeriodComparison('prop123', 28, {
      startDate: '2025-01-01',
      endDate: '2025-01-28',
    });

    expect(result.changePercent.users).toBeCloseTo(((1000 - 800) / 800) * 100, 1); // 25%
    expect(result.changePercent.sessions).toBeCloseTo(((1200 - 1000) / 1000) * 100, 1); // 20%
    expect(result.changePercent.pageviews).toBeCloseTo(((3000 - 2000) / 2000) * 100, 1); // 50%
  });

  it('returns 100% change when previous period was 0 and current > 0', async () => {
    mockFetchOk({
      rows: [
        { metricValues: [
          { value: '500' }, { value: '600' }, { value: '1000' },
          { value: '90' }, { value: '0.4' }, { value: '100' },
        ]},
        { metricValues: [
          { value: '0' }, { value: '0' }, { value: '0' },
          { value: '0' }, { value: '0' }, { value: '0' },
        ]},
      ],
    });

    const result = await getGA4PeriodComparison('prop123', 28, {
      startDate: '2025-01-01',
      endDate: '2025-01-28',
    });

    expect(result.changePercent.users).toBe(100);
    expect(result.changePercent.sessions).toBe(100);
    expect(result.changePercent.pageviews).toBe(100);
  });

  it('returns 0% change when both current and previous are 0', async () => {
    mockFetchOk({
      rows: [
        { metricValues: [
          { value: '0' }, { value: '0' }, { value: '0' },
          { value: '0' }, { value: '0' }, { value: '0' },
        ]},
        { metricValues: [
          { value: '0' }, { value: '0' }, { value: '0' },
          { value: '0' }, { value: '0' }, { value: '0' },
        ]},
      ],
    });

    const result = await getGA4PeriodComparison('prop123', 28, {
      startDate: '2025-01-01',
      endDate: '2025-01-28',
    });

    expect(result.changePercent.users).toBe(0);
  });

  it('attaches correct dateRange to current and previous', async () => {
    mockFetchOk({
      rows: [
        { metricValues: Array(6).fill({ value: '100' }) },
        { metricValues: Array(6).fill({ value: '80' }) },
      ],
    });

    const result = await getGA4PeriodComparison('prop123', 28, {
      startDate: '2025-02-01',
      endDate: '2025-02-28',
    });

    expect(result.current.dateRange.start).toBe('2025-02-01');
    expect(result.current.dateRange.end).toBe('2025-02-28');
    // Previous should end the day before curStart
    expect(result.previous.dateRange.end).toBe('2025-01-31');
  });
});

// ─── getGA4NewVsReturning ─────────────────────────────────────────────────────

describe('getGA4NewVsReturning', () => {
  it('parses segment data correctly', async () => {
    mockFetchOk({
      rows: [
        makeRow(['new'], ['600', '700', '0.4', '0.6', '42000']),
        makeRow(['returning'], ['400', '500', '0.3', '0.7', '40000']),
      ],
    });

    const result = await getGA4NewVsReturning('prop123');
    expect(result).toHaveLength(2);
    expect(result[0].segment).toBe('new');
    expect(result[0].users).toBe(600);
    expect(result[0].sessions).toBe(700);
    expect(result[1].segment).toBe('returning');
    expect(result[1].users).toBe(400);
  });

  it('computes percentage based on users within segment', async () => {
    mockFetchOk({
      rows: [
        makeRow(['new'], ['600', '700', '0.4', '0.6', '42000']),      // 60%
        makeRow(['returning'], ['400', '500', '0.3', '0.7', '40000']), // 40%
      ],
    });

    const result = await getGA4NewVsReturning('prop123');
    const total = 1000;
    expect(result[0].percentage).toBeCloseTo((600 / total) * 100, 1);
    expect(result[1].percentage).toBeCloseTo((400 / total) * 100, 1);
  });

  it('computes avgEngagementTime as duration / sessions', async () => {
    mockFetchOk({
      rows: [
        makeRow(['new'], ['600', '700', '0.4', '0.6', '42000']),
      ],
    });

    const result = await getGA4NewVsReturning('prop123');
    expect(result[0].avgEngagementTime).toBeCloseTo(42000 / 700, 5);
  });

  it('sets avgEngagementTime to 0 when sessions is 0', async () => {
    mockFetchOk({
      rows: [makeRow(['new'], ['600', '0', '0.4', '0.6', '42000'])],
    });

    const result = await getGA4NewVsReturning('prop123');
    expect(result[0].avgEngagementTime).toBe(0);
  });

  it('sets percentage to 0 when totalUsers is 0', async () => {
    mockFetchOk({
      rows: [makeRow(['new'], ['0', '0', '0', '0', '0'])],
    });

    const result = await getGA4NewVsReturning('prop123');
    expect(result[0].percentage).toBe(0);
  });

  it('returns empty array when no rows', async () => {
    mockFetchOk({});
    const result = await getGA4NewVsReturning('prop123');
    expect(result).toEqual([]);
  });
});

// ─── getGA4Countries ──────────────────────────────────────────────────────────

describe('getGA4Countries', () => {
  it('parses country, users, sessions', async () => {
    mockFetchOk({
      rows: [
        makeRow(['United States'], ['5000', '6000']),
        makeRow(['United Kingdom'], ['1000', '1200']),
        makeRow(['Canada'], ['800', '900']),
      ],
    });

    const result = await getGA4Countries('prop123');
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ country: 'United States', users: 5000, sessions: 6000 });
    expect(result[1]).toEqual({ country: 'United Kingdom', users: 1000, sessions: 1200 });
    expect(result[2]).toEqual({ country: 'Canada', users: 800, sessions: 900 });
  });

  it('returns empty array when no rows', async () => {
    mockFetchOk({});
    const result = await getGA4Countries('prop123');
    expect(result).toEqual([]);
  });
});

// ─── getTopDroppedGA4Page ─────────────────────────────────────────────────────

describe('getTopDroppedGA4Page', () => {
  it('returns null when current data is empty', async () => {
    mocks.fetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ rows: [] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ rows: [] }) });

    const result = await getTopDroppedGA4Page('prop123');
    expect(result).toBeNull();
  });

  it('returns null when previous data is empty', async () => {
    mocks.fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          rows: [makeRow(['/page-a'], ['500'])],
        }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ rows: [] }) });

    const result = await getTopDroppedGA4Page('prop123');
    expect(result).toBeNull();
  });

  it('identifies the page with the largest absolute user drop', async () => {
    mocks.fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          rows: [
            makeRow(['/page-a'], ['200']),  // was 500 → drop of 300
            makeRow(['/page-b'], ['100']),  // was 150 → drop of 50
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          rows: [
            makeRow(['/page-a'], ['500']),
            makeRow(['/page-b'], ['150']),
          ],
        }),
      });

    const result = await getTopDroppedGA4Page('prop123');
    expect(result).toBe('/page-a');
  });

  it('considers pages that disappeared entirely (dropped to 0)', async () => {
    // page-c was in prev (800 users) but not in cur → full drop
    mocks.fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          rows: [makeRow(['/page-a'], ['200'])],  // drop of 300 from 500
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          rows: [
            makeRow(['/page-a'], ['500']),
            makeRow(['/page-c'], ['800']),  // vanished completely
          ],
        }),
      });

    const result = await getTopDroppedGA4Page('prop123');
    expect(result).toBe('/page-c');
  });

  it('normalizes full HTTP URLs to pathname only', async () => {
    mocks.fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          rows: [makeRow(['https://example.com/blog/post'], ['100'])],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          rows: [makeRow(['https://example.com/blog/post'], ['500'])],
        }),
      });

    const result = await getTopDroppedGA4Page('prop123');
    expect(result).toBe('/blog/post');
  });

  it('strips query strings from path-only URLs', async () => {
    mocks.fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          rows: [makeRow(['/page?utm_source=google'], ['100'])],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          rows: [makeRow(['/page?utm_source=google'], ['500'])],
        }),
      });

    const result = await getTopDroppedGA4Page('prop123');
    expect(result).toBe('/page');
  });

  it('strips query strings from full URLs', async () => {
    mocks.fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          rows: [makeRow(['https://site.com/article?ref=1'], ['100'])],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          rows: [makeRow(['https://site.com/article?ref=1'], ['500'])],
        }),
      });

    const result = await getTopDroppedGA4Page('prop123');
    expect(result).toBe('/article');
  });

  it('returns null when no page has a drop (all pages increased)', async () => {
    mocks.fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          rows: [makeRow(['/page-a'], ['600'])],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          rows: [makeRow(['/page-a'], ['400'])],
        }),
      });

    const result = await getTopDroppedGA4Page('prop123');
    expect(result).toBeNull();
  });

  it('returns the raw string for non-http paths that do not start with / (no normalization)', async () => {
    // Bug note: the code only handles 'http*' or paths starting with '/'.
    // A bare string like 'not-a-url' falls through to `topPage.split('?')[0]`
    // which returns 'not-a-url' as-is instead of null.
    // The catch block's null guard only runs if new URL() throws (http* case).
    mocks.fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          rows: [makeRow(['not-a-url'], ['100'])],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          rows: [makeRow(['not-a-url'], ['500'])],
        }),
      });

    // Actual behavior: returns 'not-a-url' (not null) — this is a known edge case
    const result = await getTopDroppedGA4Page('prop123');
    expect(result).toBe('not-a-url');
  });
});

// ─── getTopSpikedGA4Page ──────────────────────────────────────────────────────

describe('getTopSpikedGA4Page', () => {
  it('returns null when current data is empty', async () => {
    mocks.fetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ rows: [] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ rows: [] }) });

    const result = await getTopSpikedGA4Page('prop123');
    expect(result).toBeNull();
  });

  it('identifies the page with the largest user spike', async () => {
    mocks.fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          rows: [
            makeRow(['/viral-post'], ['2000']),  // was 200 → spike of 1800
            makeRow(['/page-b'], ['500']),        // was 400 → spike of 100
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          rows: [
            makeRow(['/viral-post'], ['200']),
            makeRow(['/page-b'], ['400']),
          ],
        }),
      });

    const result = await getTopSpikedGA4Page('prop123');
    expect(result).toBe('/viral-post');
  });

  it('handles new pages with no previous data (spike from 0)', async () => {
    mocks.fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          rows: [
            makeRow(['/new-page'], ['1000']),  // no prev data → spike of 1000
            makeRow(['/page-b'], ['800']),      // was 850 → actually a drop
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          rows: [makeRow(['/page-b'], ['850'])],
        }),
      });

    const result = await getTopSpikedGA4Page('prop123');
    expect(result).toBe('/new-page');
  });

  it('returns null when no page has a spike', async () => {
    mocks.fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          rows: [makeRow(['/page-a'], ['200'])],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          rows: [makeRow(['/page-a'], ['500'])],
        }),
      });

    const result = await getTopSpikedGA4Page('prop123');
    expect(result).toBeNull();
  });

  it('normalizes full HTTP URLs to pathname only', async () => {
    mocks.fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          rows: [makeRow(['https://example.com/new/article'], ['5000'])],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          rows: [makeRow(['https://example.com/new/article'], ['100'])],
        }),
      });

    const result = await getTopSpikedGA4Page('prop123');
    expect(result).toBe('/new/article');
  });

  it('strips query strings from spike URL', async () => {
    mocks.fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          rows: [makeRow(['/article?campaign=spring'], ['5000'])],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          rows: [makeRow(['/article?campaign=spring'], ['100'])],
        }),
      });

    const result = await getTopSpikedGA4Page('prop123');
    expect(result).toBe('/article');
  });

  it('handles empty previous data gracefully (prevByPage stays empty)', async () => {
    mocks.fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          rows: [makeRow(['/page-a'], ['500'])],
        }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ rows: [] }) });

    // With no prev data, spike = 500 - 0 = 500, should find /page-a
    const result = await getTopSpikedGA4Page('prop123');
    expect(result).toBe('/page-a');
  });
});
