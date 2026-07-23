import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getGlobalToken: vi.fn<[], Promise<string | null>>(),
  fetch: vi.fn(),
  loggerError: vi.fn(),
  loggerWarn: vi.fn(),
}));

vi.mock('../../server/google-auth.js', () => ({
  getGlobalToken: mocks.getGlobalToken,
}));

vi.mock('../../server/logger.js', () => ({
  createLogger: () => ({
    error: mocks.loggerError,
    warn: mocks.loggerWarn,
    info: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.stubGlobal('fetch', mocks.fetch);

import {
  runClientGa4CampaignReport,
  runClientGa4ComparisonReport,
  runClientGa4KeyEventsReport,
  runClientGa4LandingContentReport,
  runClientGa4PageContentReport,
  runClientGa4TrafficSourcesReport,
} from '../../server/google-analytics.js';

const RANGE = { startDate: '2026-06-01', endDate: '2026-06-28' };
const COMPARISON_RANGE = { startDate: '2026-05-04', endDate: '2026-05-31' };

function metricType(name: string): 'TYPE_FLOAT' | 'TYPE_INTEGER' | 'TYPE_SECONDS' {
  if (name === 'engagementRate' || name === 'bounceRate' || name === 'keyEvents') {
    return 'TYPE_FLOAT';
  }
  if (name === 'averageSessionDuration' || name === 'userEngagementDuration') {
    return 'TYPE_SECONDS';
  }
  return 'TYPE_INTEGER';
}

function report(options: {
  dimensions: string[];
  metrics: string[];
  rows: Array<{ dimensions: string[]; metrics: string[] }>;
  rowCount?: number;
  metadata?: unknown;
}): unknown {
  return {
    dimensionHeaders: options.dimensions.map(name => ({ name })),
    metricHeaders: options.metrics.map(name => ({ name, type: metricType(name) })),
    rows: options.rows.map(row => ({
      dimensionValues: row.dimensions.map(value => ({ value })),
      metricValues: row.metrics.map(value => ({ value })),
    })),
    rowCount: options.rowCount ?? options.rows.length,
    metadata: options.metadata,
    kind: 'analyticsData#runReport',
  };
}

function mockReports(...responses: unknown[]): void {
  for (const response of responses) {
    mocks.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => response,
      text: async () => JSON.stringify(response),
    });
  }
}

function requestBodies(): Array<Record<string, unknown>> {
  return mocks.fetch.mock.calls.map((call) => {
    const init = call[1] as RequestInit | undefined;
    return JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getGlobalToken.mockResolvedValue('test-token');
});

describe('fixed client GA4 provider reports', () => {
  it('pins session-campaign dimensions, metrics, ordering, range, and limit', async () => {
    mockReports(report({
      dimensions: ['sessionCampaignName'],
      metrics: ['sessions', 'totalUsers', 'engagedSessions', 'engagementRate', 'keyEvents'],
      rows: [{ dimensions: ['Organic Search'], metrics: ['120', '90', '72', '0.6', '4.5'] }],
      rowCount: 8,
      metadata: {
        subjectToThresholding: false,
        dataLossFromOtherRow: true,
        samplingMetadatas: [{ samplesReadCount: '500', samplingSpaceSize: '1000' }],
      },
    }));

    const result = await runClientGa4CampaignReport('prop-1', RANGE, 1);

    expect(requestBodies()).toEqual([{
      dateRanges: [RANGE],
      dimensions: [{ name: 'sessionCampaignName' }],
      metrics: [
        { name: 'sessions' },
        { name: 'totalUsers' },
        { name: 'engagedSessions' },
        { name: 'engagementRate' },
        { name: 'keyEvents' },
      ],
      orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
      limit: 1,
    }]);
    expect(result).toEqual({
      rows: [{
        campaignName: 'Organic Search',
        sessions: 120,
        users: 90,
        engagedSessions: 72,
        engagementRate: 60,
        keyEvents: 4.5,
      }],
      rowCount: 8,
      requestedRanges: [RANGE],
      metadata: {
        subjectToThresholding: false,
        dataLossFromOtherRow: true,
        samplingMetadatas: [{ samplesReadCount: '500', samplingSpaceSize: '1000' }],
      },
    });
  });

  it('accepts a valid empty campaign report only when its exact contract is intact', async () => {
    mockReports(report({
      dimensions: ['sessionCampaignName'],
      metrics: ['sessions', 'totalUsers', 'engagedSessions', 'engagementRate', 'keyEvents'],
      rows: [],
      rowCount: 0,
    }));

    const result = await runClientGa4CampaignReport('prop-1', RANGE, 10);

    expect(result.rows).toEqual([]);
    expect(result.rowCount).toBe(0);
    expect(result.metadata).toEqual({
      subjectToThresholding: null,
      dataLossFromOtherRow: null,
      samplingMetadatas: [],
    });
  });

  it('pins exact named ranges and overview metrics for comparison', async () => {
    mockReports(report({
      dimensions: ['dateRange'],
      metrics: [
        'totalUsers',
        'sessions',
        'screenPageViews',
        'newUsers',
        'averageSessionDuration',
        'bounceRate',
      ],
      rows: [
        { dimensions: ['comparison'], metrics: ['80', '100', '180', '42', '95.5', '0.4'] },
        { dimensions: ['current'], metrics: ['100', '130', '240', '51', '110.25', '0.3'] },
      ],
      metadata: {
        samplingMetadatas: [
          { samplesReadCount: '900', samplingSpaceSize: '1000' },
          { samplesReadCount: '800', samplingSpaceSize: '1000' },
        ],
      },
    }));

    const result = await runClientGa4ComparisonReport('prop-1', RANGE, COMPARISON_RANGE);

    expect(requestBodies()).toEqual([{
      dateRanges: [
        { ...RANGE, name: 'current' },
        { ...COMPARISON_RANGE, name: 'comparison' },
      ],
      metrics: [
        { name: 'totalUsers' },
        { name: 'sessions' },
        { name: 'screenPageViews' },
        { name: 'newUsers' },
        { name: 'averageSessionDuration' },
        { name: 'bounceRate' },
      ],
    }]);
    expect(result.requestedRanges).toEqual([RANGE, COMPARISON_RANGE]);
    expect(result.rows).toEqual([
      {
        range: 'current',
        users: 100,
        sessions: 130,
        pageViews: 240,
        newUsers: 51,
        avgSessionDurationSeconds: 110.25,
        bounceRate: 30,
      },
      {
        range: 'comparison',
        users: 80,
        sessions: 100,
        pageViews: 180,
        newUsers: 42,
        avgSessionDurationSeconds: 95.5,
        bounceRate: 40,
      },
    ]);
  });

  it('pins session-scoped source and medium traffic attribution', async () => {
    mockReports(report({
      dimensions: ['sessionSource', 'sessionMedium'],
      metrics: ['sessions', 'totalUsers', 'engagedSessions', 'engagementRate', 'keyEvents'],
      rows: [{ dimensions: ['google', 'organic'], metrics: ['90', '70', '60', '0.666', '3'] }],
    }));

    const result = await runClientGa4TrafficSourcesReport('prop-1', RANGE, 10);

    expect(requestBodies()).toEqual([{
      dateRanges: [RANGE],
      dimensions: [{ name: 'sessionSource' }, { name: 'sessionMedium' }],
      metrics: [
        { name: 'sessions' },
        { name: 'totalUsers' },
        { name: 'engagedSessions' },
        { name: 'engagementRate' },
        { name: 'keyEvents' },
      ],
      orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
      limit: 10,
    }]);
    expect(result.rows[0]).toEqual({
      source: 'google',
      medium: 'organic',
      sessions: 90,
      users: 70,
      engagedSessions: 60,
      engagementRate: 66.60000000000001,
      keyEvents: 3,
    });
  });

  it('uses actual keyEvents authority, exact isKeyEvent true, and a fixed period-user total', async () => {
    mockReports(
      report({
        dimensions: ['eventName'],
        metrics: ['keyEvents', 'totalUsers'],
        rows: [{ dimensions: ['generate_lead'], metrics: ['12.5', '10'] }],
        metadata: { subjectToThresholding: false, dataLossFromOtherRow: false },
      }),
      report({
        dimensions: [],
        metrics: ['totalUsers'],
        rows: [{ dimensions: [], metrics: ['250'] }],
        metadata: { subjectToThresholding: false, dataLossFromOtherRow: false },
      }),
    );

    const result = await runClientGa4KeyEventsReport('prop-1', RANGE, 20);

    expect(requestBodies()).toEqual([
      {
        dateRanges: [RANGE],
        dimensions: [{ name: 'eventName' }],
        metrics: [{ name: 'keyEvents' }, { name: 'totalUsers' }],
        dimensionFilter: {
          filter: {
            fieldName: 'isKeyEvent',
            stringFilter: { matchType: 'EXACT', value: 'true' },
          },
        },
        orderBys: [{ metric: { metricName: 'keyEvents' }, desc: true }],
        limit: 20,
      },
      {
        dateRanges: [RANGE],
        metrics: [{ name: 'totalUsers' }],
      },
    ]);
    expect(result.rows).toEqual([{ eventName: 'generate_lead', keyEvents: 12.5, users: 10 }]);
    expect(result.periodTotalUsers).toBe(250);
    expect(result.metadata).toEqual({
      subjectToThresholding: false,
      dataLossFromOtherRow: false,
      samplingMetadatas: [],
    });
  });

  it('keeps page-view content in its own fixed report', async () => {
    mockReports(report({
      dimensions: ['pagePath'],
      metrics: ['screenPageViews', 'totalUsers', 'userEngagementDuration'],
      rows: [{ dimensions: ['/services?utm_source=test#form'], metrics: ['50', '10', '1234.5'] }],
    }));

    const result = await runClientGa4PageContentReport('prop-1', RANGE, 15);

    expect(requestBodies()).toEqual([{
      dateRanges: [RANGE],
      dimensions: [{ name: 'pagePath' }],
      metrics: [
        { name: 'screenPageViews' },
        { name: 'totalUsers' },
        { name: 'userEngagementDuration' },
      ],
      orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
      limit: 15,
    }]);
    expect(result.rows).toEqual([{
      path: '/services',
      views: 50,
      users: 10,
      avgEngagementTimeSeconds: 123.45,
    }]);
  });

  it('keeps landing-session content in a separate fixed report', async () => {
    mockReports(report({
      dimensions: ['landingPage'],
      metrics: ['sessions', 'totalUsers', 'engagedSessions', 'engagementRate', 'keyEvents'],
      rows: [{ dimensions: ['/work?campaign=q3'], metrics: ['45', '39', '30', '0.666', '2'] }],
    }));

    const result = await runClientGa4LandingContentReport('prop-1', RANGE, 15);

    expect(requestBodies()).toEqual([{
      dateRanges: [RANGE],
      dimensions: [{ name: 'landingPage' }],
      metrics: [
        { name: 'sessions' },
        { name: 'totalUsers' },
        { name: 'engagedSessions' },
        { name: 'engagementRate' },
        { name: 'keyEvents' },
      ],
      orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
      limit: 15,
    }]);
    expect(result.rows).toEqual([{
      landingPage: '/work',
      sessions: 45,
      users: 39,
      engagedSessions: 30,
      engagementRate: 66.60000000000001,
      keyEvents: 2,
    }]);
  });
});

describe('fixed client GA4 provider failure boundary', () => {
  const incompatibleResponse = {
    dimensionHeaders: [],
    metricHeaders: [],
    rows: [],
    rowCount: 0,
  };

  it.each([
    ['campaign', () => runClientGa4CampaignReport('prop-1', RANGE, 10)],
    ['comparison', () => runClientGa4ComparisonReport('prop-1', RANGE, COMPARISON_RANGE)],
    ['traffic sources', () => runClientGa4TrafficSourcesReport('prop-1', RANGE, 10)],
    ['key events', () => runClientGa4KeyEventsReport('prop-1', RANGE, 10)],
    ['page content', () => runClientGa4PageContentReport('prop-1', RANGE, 10)],
    ['landing content', () => runClientGa4LandingContentReport('prop-1', RANGE, 10)],
  ])('rejects incompatible %s reports instead of returning plausible empty data', async (_name, invoke) => {
    mockReports(incompatibleResponse);
    await expect(invoke()).rejects.toThrow('GA4 provider report incompatible');
  });

  it.each([
    ['wrong header name', {
      dimensionHeaders: [{ name: 'campaignName' }],
      metricHeaders: [
        { name: 'sessions', type: 'TYPE_INTEGER' },
        { name: 'totalUsers', type: 'TYPE_INTEGER' },
        { name: 'engagedSessions', type: 'TYPE_INTEGER' },
        { name: 'engagementRate', type: 'TYPE_FLOAT' },
        { name: 'keyEvents', type: 'TYPE_FLOAT' },
      ],
      rows: [],
      rowCount: 0,
    }],
    ['wrong metric type', {
      dimensionHeaders: [{ name: 'sessionCampaignName' }],
      metricHeaders: [
        { name: 'sessions', type: 'TYPE_FLOAT' },
        { name: 'totalUsers', type: 'TYPE_INTEGER' },
        { name: 'engagedSessions', type: 'TYPE_INTEGER' },
        { name: 'engagementRate', type: 'TYPE_FLOAT' },
        { name: 'keyEvents', type: 'TYPE_FLOAT' },
      ],
      rows: [],
      rowCount: 0,
    }],
    ['row width mismatch', {
      dimensionHeaders: [{ name: 'sessionCampaignName' }],
      metricHeaders: [
        { name: 'sessions', type: 'TYPE_INTEGER' },
        { name: 'totalUsers', type: 'TYPE_INTEGER' },
        { name: 'engagedSessions', type: 'TYPE_INTEGER' },
        { name: 'engagementRate', type: 'TYPE_FLOAT' },
        { name: 'keyEvents', type: 'TYPE_FLOAT' },
      ],
      rows: [{
        dimensionValues: [{ value: 'Campaign' }],
        metricValues: [{ value: '1' }],
      }],
      rowCount: 1,
    }],
    ['rowCount mismatch', {
      dimensionHeaders: [{ name: 'sessionCampaignName' }],
      metricHeaders: [
        { name: 'sessions', type: 'TYPE_INTEGER' },
        { name: 'totalUsers', type: 'TYPE_INTEGER' },
        { name: 'engagedSessions', type: 'TYPE_INTEGER' },
        { name: 'engagementRate', type: 'TYPE_FLOAT' },
        { name: 'keyEvents', type: 'TYPE_FLOAT' },
      ],
      rows: [],
      rowCount: 1,
    }],
  ])('rejects %s', async (_name, response) => {
    mockReports(response);
    await expect(runClientGa4CampaignReport('prop-1', RANGE, 10))
      .rejects.toThrow('GA4 provider report incompatible');
  });

  it.each(['NaN', 'Infinity', '-1'])('rejects non-finite or negative metric value %s', async (value) => {
    mockReports(report({
      dimensions: ['sessionCampaignName'],
      metrics: ['sessions', 'totalUsers', 'engagedSessions', 'engagementRate', 'keyEvents'],
      rows: [{ dimensions: ['Campaign'], metrics: [value, '1', '1', '0.5', '1'] }],
    }));
    await expect(runClientGa4CampaignReport('prop-1', RANGE, 10))
      .rejects.toThrow('GA4 provider report incompatible');
  });

  it('rejects malformed, unbounded, or restricted metadata', async () => {
    mockReports(report({
      dimensions: ['sessionCampaignName'],
      metrics: ['sessions', 'totalUsers', 'engagedSessions', 'engagementRate', 'keyEvents'],
      rows: [{ dimensions: ['Campaign'], metrics: ['1', '1', '1', '0.5', '1'] }],
      metadata: {
        samplingMetadatas: [
          { samplesReadCount: '1', samplingSpaceSize: '2' },
          { samplesReadCount: '1', samplingSpaceSize: '2' },
        ],
        schemaRestrictionResponse: {
          activeMetricRestrictions: [{ metricName: 'totalUsers' }],
        },
      },
    }));
    await expect(runClientGa4CampaignReport('prop-1', RANGE, 10))
      .rejects.toThrow('GA4 provider report incompatible');
  });

  it('redacts property, request, endpoint, response body, and raw error from report logs', async () => {
    mocks.fetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      text: async () => 'provider-body-secret',
    });

    await expect(runClientGa4CampaignReport('property-secret', RANGE, 10))
      .rejects.toThrow('GA4 provider report unavailable');

    expect(mocks.loggerError).toHaveBeenCalledWith({
      reportKind: 'client_campaign',
      failureClassification: 'http',
      status: 403,
      retryable: false,
    }, 'GA4 report failed');
    const serializedLog = JSON.stringify(mocks.loggerError.mock.calls);
    expect(serializedLog).not.toContain('property-secret');
    expect(serializedLog).not.toContain('provider-body-secret');
    expect(serializedLog).not.toContain('analyticsdata.googleapis.com');
    expect(serializedLog).not.toContain('"err"');
  });
});
