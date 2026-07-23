import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../server/workspaces.js', () => ({
  getWorkspace: vi.fn(),
}));
vi.mock('../../server/google-auth.js', () => ({
  isGlobalConnected: vi.fn(),
}));
vi.mock('../../server/analytics-data.js', () => ({
  fetchSearchOverview: vi.fn(),
  fetchPerformanceTrend: vi.fn(),
  fetchSearchComparison: vi.fn(),
}));
vi.mock('../../server/google-analytics.js', () => ({
  runClientGa4CampaignReport: vi.fn(),
  runClientGa4ComparisonReport: vi.fn(),
  runClientGa4TrafficSourcesReport: vi.fn(),
  runClientGa4KeyEventsReport: vi.fn(),
  runClientGa4PageContentReport: vi.fn(),
  runClientGa4LandingContentReport: vi.fn(),
}));

import { getWorkspace } from '../../server/workspaces.js';
import { isGlobalConnected } from '../../server/google-auth.js';
import {
  fetchSearchOverview,
  fetchPerformanceTrend,
  fetchSearchComparison,
} from '../../server/analytics-data.js';
import {
  runClientGa4CampaignReport,
  runClientGa4ComparisonReport,
  runClientGa4TrafficSourcesReport,
  runClientGa4KeyEventsReport,
  runClientGa4PageContentReport,
  runClientGa4LandingContentReport,
} from '../../server/google-analytics.js';
import {
  analyticsReadActionTools,
  clientAnalyticsReadTools,
  handleAnalyticsReadActionTool,
  handleClientAnalyticsReadActionTool,
} from '../../server/mcp/tools/analytics-read-actions.js';

type Mock = ReturnType<typeof vi.fn>;

const OVERVIEW = {
  totalClicks: 1200,
  totalImpressions: 50000,
  avgCtr: 2.4,
  avgPosition: 8.3,
  topQueries: [{ query: 'hvac repair', clicks: 100, impressions: 4000, ctr: 2.5, position: 6.1 }],
  topPages: [{ page: '/blog/hvac', clicks: 80, impressions: 3000, ctr: 2.7, position: 5.4 }],
  dateRange: { start: '2026-06-01', end: '2026-06-28' },
};

const TREND = [
  { date: '2026-06-01', clicks: 40, impressions: 1700, ctr: 2.4, position: 8.0 },
  { date: '2026-06-02', clicks: 45, impressions: 1800, ctr: 2.5, position: 7.9 },
];

const COMPARISON = {
  current: { clicks: 1200, impressions: 50000, ctr: 2.4, position: 8.3 },
  previous: { clicks: 1000, impressions: 46000, ctr: 2.2, position: 9.0 },
  change: { clicks: 200, impressions: 4000, ctr: 0.2, position: -0.7 },
  changePercent: { clicks: 20, impressions: 8.7, ctr: 9.1, position: -7.8 },
};

const DATE_ARGS = {
  start_date: '2026-06-01',
  end_date: '2026-06-28',
} as const;
const PROVIDER_RANGE = {
  startDate: DATE_ARGS.start_date,
  endDate: DATE_ARGS.end_date,
};
const PREVIOUS_PROVIDER_RANGE = {
  startDate: '2026-05-04',
  endDate: '2026-05-31',
};
const PROVIDER_METADATA = {
  subjectToThresholding: false,
  dataLossFromOtherRow: true,
  samplingMetadatas: [{
    samplesReadCount: '900',
    samplingSpaceSize: '1000',
  }],
};

function providerReport<T>(
  rows: T[],
  options: {
    rowCount?: number;
    requestedRanges?: Array<{ startDate: string; endDate: string }>;
    metadata?: typeof PROVIDER_METADATA;
  } = {},
) {
  return {
    rows,
    rowCount: options.rowCount ?? rows.length,
    requestedRanges: options.requestedRanges ?? [PROVIDER_RANGE],
    metadata: options.metadata ?? PROVIDER_METADATA,
  };
}

function textOf(result: unknown): string {
  const candidate = result as {
    content?: Array<{ text?: unknown }>;
  };
  const text = candidate.content?.[0]?.text;
  return typeof text === 'string' ? text : '';
}

function errorEnvelope(result: unknown) {
  return JSON.parse(textOf(result)) as { code: string; details?: Record<string, unknown> };
}

function dataOf(result: unknown) {
  const candidate = result as { structuredContent?: Record<string, unknown> };
  const legacy = JSON.parse(textOf(result)) as unknown;
  expect(candidate.structuredContent).toEqual({ data: legacy });
  return legacy as Record<string, unknown>;
}

describe('mcp analytics read action tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getWorkspace as Mock).mockReturnValue({
      id: 'ws-1',
      name: 'Workspace',
      webflowSiteId: 'site-123',
      gscPropertyUrl: 'sc-domain:example.com',
      ga4PropertyId: 'property-secret-123',
      eventConfig: [
        { eventName: 'submit_form', displayName: 'Qualified form', pinned: true },
        { eventName: 'click', displayName: 'Tracked click', pinned: true },
        { eventName: 'purchase', displayName: 'Purchase', pinned: false },
        { eventName: 'duplicate_event', displayName: 'First label', pinned: true },
        { eventName: 'duplicate_event', displayName: 'Second label', pinned: true },
      ],
    });
    (isGlobalConnected as Mock).mockReturnValue(true);
    (fetchSearchOverview as Mock).mockResolvedValue(OVERVIEW);
    (fetchPerformanceTrend as Mock).mockResolvedValue(TREND);
    (fetchSearchComparison as Mock).mockResolvedValue(COMPARISON);
    (runClientGa4CampaignReport as Mock).mockResolvedValue(providerReport([{
      campaignName: 'Summer Search',
      sessions: 120,
      users: 95,
      engagedSessions: 80,
      engagementRate: 66.7,
      keyEvents: 12.5,
    }]));
    (runClientGa4TrafficSourcesReport as Mock).mockResolvedValue(providerReport([{
      source: 'google',
      medium: 'organic',
      sessions: 200,
      users: 160,
      engagedSessions: 140,
      engagementRate: 70,
      keyEvents: 20,
    }]));
    (runClientGa4KeyEventsReport as Mock).mockResolvedValue({
      ...providerReport([
        { eventName: 'submit_form', keyEvents: 12, users: 10 },
        { eventName: 'click', keyEvents: 8, users: 7 },
        { eventName: 'purchase', keyEvents: 4, users: 4 },
        { eventName: 'duplicate_event', keyEvents: 2, users: 2 },
      ]),
      periodTotalUsers: 200,
    });
    (runClientGa4ComparisonReport as Mock).mockResolvedValue(providerReport([
      {
        range: 'current',
        users: 200,
        sessions: 250,
        pageViews: 500,
        newUsers: 80,
        avgSessionDurationSeconds: 90,
        bounceRate: 30,
      },
      {
        range: 'comparison',
        users: 100,
        sessions: 200,
        pageViews: 0,
        newUsers: 100,
        avgSessionDurationSeconds: 60,
        bounceRate: 40,
      },
    ], {
      requestedRanges: [PROVIDER_RANGE, PREVIOUS_PROVIDER_RANGE],
      metadata: {
        subjectToThresholding: false,
        dataLossFromOtherRow: true,
        samplingMetadatas: [],
      },
    }));
    (runClientGa4PageContentReport as Mock).mockResolvedValue(providerReport([{
      path: '/guide?private=query#section',
      views: 300,
      users: 220,
      avgEngagementTimeSeconds: 42.5,
    }]));
    (runClientGa4LandingContentReport as Mock).mockResolvedValue(providerReport([{
      landingPage: '/landing?campaign=secret#hero',
      sessions: 180,
      users: 150,
      engagedSessions: 120,
      engagementRate: 66.7,
      keyEvents: 15,
    }]));
  });

  it('registers all canonical and client analytics projections in fixed order', () => {
    const expected = [
      'get_search_performance',
      'get_ga4_campaign_performance',
      'get_ga4_period_comparison',
      'get_ga4_traffic_sources',
      'get_ga4_key_events',
      'get_ga4_content_performance',
    ];
    expect(analyticsReadActionTools.map(t => t.name)).toEqual(expected);
    expect(clientAnalyticsReadTools.map(t => t.name)).toEqual(expected);
    for (const tool of clientAnalyticsReadTools) {
      expect(tool.inputSchema.properties).not.toHaveProperty('workspace_id');
      expect(tool.outputSchema).toMatchObject({
        type: 'object',
        required: ['data'],
      });
      expect(tool.annotations).toEqual({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      });
    }
  });

  it('returns Unknown tool for an unrecognized name', async () => {
    const result = await handleAnalyticsReadActionTool('nope', { workspace_id: 'ws-1' });
    expect(result.isError).toBe(true);
    expect(errorEnvelope(result as { content: Array<{ text: string }> })).toMatchObject({
      code: 'not_found',
      details: { resource_type: 'tool' },
    });
  });

  it('reads with the default 28-day window when no range is given', async () => {
    const result = await handleAnalyticsReadActionTool('get_search_performance', { workspace_id: 'ws-1' });

    expect(result.isError).toBeUndefined();
    // siteId + gscSiteUrl resolved from workspace; default window = 28; no dateRange.
    expect(fetchSearchOverview).toHaveBeenCalledWith('site-123', 'sc-domain:example.com', 28, undefined);
    expect(fetchPerformanceTrend).toHaveBeenCalledWith('site-123', 'sc-domain:example.com', 28, undefined);
    // compare_previous not set → comparison fetch is skipped.
    expect(fetchSearchComparison).not.toHaveBeenCalled();

    const payload = JSON.parse(textOf(result as { content: Array<{ text: string }> }));
    expect(payload.totals).toEqual({ clicks: 1200, impressions: 50000, ctr: 2.4, position: 8.3 });
    expect(payload.daily_trend).toEqual(TREND);
    expect(payload.top_queries).toEqual(OVERVIEW.topQueries);
    expect(payload.period_comparison).toBeNull();
  });

  it('passes a custom days window through to the search-console reads', async () => {
    await handleAnalyticsReadActionTool('get_search_performance', { workspace_id: 'ws-1', days: 90 });
    expect(fetchSearchOverview).toHaveBeenCalledWith('site-123', 'sc-domain:example.com', 90, undefined);
    expect(fetchPerformanceTrend).toHaveBeenCalledWith('site-123', 'sc-domain:example.com', 90, undefined);
  });

  it('passes an explicit start/end date range through as a dateRange', async () => {
    await handleAnalyticsReadActionTool('get_search_performance', {
      workspace_id: 'ws-1',
      start_date: '2026-05-01',
      end_date: '2026-05-31',
    });
    const expectedRange = { startDate: '2026-05-01', endDate: '2026-05-31' };
    expect(fetchSearchOverview).toHaveBeenCalledWith('site-123', 'sc-domain:example.com', 28, expectedRange);
    expect(fetchPerformanceTrend).toHaveBeenCalledWith('site-123', 'sc-domain:example.com', 28, expectedRange);
  });

  it('includes a period comparison when compare_previous is true', async () => {
    const result = await handleAnalyticsReadActionTool('get_search_performance', {
      workspace_id: 'ws-1',
      compare_previous: true,
    });
    expect(fetchSearchComparison).toHaveBeenCalledWith('site-123', 'sc-domain:example.com', 28, undefined);
    const payload = JSON.parse(textOf(result as { content: Array<{ text: string }> }));
    expect(payload.period_comparison).toEqual(COMPARISON);
  });

  it('rejects a lone start_date without end_date', async () => {
    const result = await handleAnalyticsReadActionTool('get_search_performance', {
      workspace_id: 'ws-1',
      start_date: '2026-05-01',
    });
    expect(result.isError).toBe(true);
    expect(textOf(result as { content: Array<{ text: string }> })).toContain('must be provided together');
    expect(fetchSearchOverview).not.toHaveBeenCalled();
  });

  it('rejects an end_date earlier than start_date', async () => {
    const result = await handleAnalyticsReadActionTool('get_search_performance', {
      workspace_id: 'ws-1',
      start_date: '2026-05-31',
      end_date: '2026-05-01',
    });
    expect(result.isError).toBe(true);
    expect(textOf(result as { content: Array<{ text: string }> })).toContain('on or after start_date');
    expect(fetchSearchOverview).not.toHaveBeenCalled();
  });

  it('errors when the workspace has no GSC property configured', async () => {
    (getWorkspace as Mock).mockReturnValue({ id: 'ws-1', name: 'Workspace', webflowSiteId: 'site-123' });
    const result = await handleAnalyticsReadActionTool('get_search_performance', { workspace_id: 'ws-1' });
    expect(result.isError).toBe(true);
    expect(textOf(result as { content: Array<{ text: string }> })).toContain('No Google Search Console property is connected');
    expect(fetchSearchOverview).not.toHaveBeenCalled();
  });

  it('errors when Google is not globally connected', async () => {
    (isGlobalConnected as Mock).mockReturnValue(false);
    const result = await handleAnalyticsReadActionTool('get_search_performance', { workspace_id: 'ws-1' });
    expect(result.isError).toBe(true);
    expect(textOf(result as { content: Array<{ text: string }> })).toContain('Google is not connected');
    expect(fetchSearchOverview).not.toHaveBeenCalled();
  });

  it('errors when the workspace does not exist', async () => {
    (getWorkspace as Mock).mockReturnValue(undefined);
    const result = await handleAnalyticsReadActionTool('get_search_performance', { workspace_id: 'ghost' });
    expect(result.isError).toBe(true);
    expect(textOf(result as { content: Array<{ text: string }> })).toContain('Workspace not found');
  });

  it('surfaces a search-console failure as an mcpError', async () => {
    (fetchSearchOverview as Mock).mockRejectedValue(new Error('GSC API error (429)'));
    const result = await handleAnalyticsReadActionTool('get_search_performance', { workspace_id: 'ws-1' });
    expect(result.isError).toBe(true);
    expect(errorEnvelope(result as { content: Array<{ text: string }> })).toMatchObject({
      code: 'internal_error',
    });
    expect(textOf(result as { content: Array<{ text: string }> })).not.toContain('GSC API error');
  });

  it('uses the same bounded campaign implementation for full and client names', async () => {
    const full = await handleAnalyticsReadActionTool(
      'get_ga4_campaign_performance',
      { workspace_id: 'ws-1', ...DATE_ARGS, limit: 1 },
    );
    const client = await handleClientAnalyticsReadActionTool(
      'get_ga4_campaign_performance',
      { workspace_id: 'ws-1', ...DATE_ARGS, limit: 1 },
    );

    expect(full.isError).not.toBe(true);
    expect(client.isError).not.toBe(true);
    expect(JSON.parse(textOf(full))).toEqual(JSON.parse(textOf(client)));
    expect(runClientGa4CampaignReport).toHaveBeenNthCalledWith(
      1,
      'property-secret-123',
      PROVIDER_RANGE,
      1,
    );
    expect(runClientGa4CampaignReport).toHaveBeenNthCalledWith(
      2,
      'property-secret-123',
      PROVIDER_RANGE,
      1,
    );

    const data = dataOf(client);
    expect(data).toMatchObject({
      source: 'google_analytics_4',
      attribution_scope: 'session_campaign',
      date_range: { start: '2026-06-01', end: '2026-06-28' },
      campaigns: [{
        campaign_name: 'Summer Search',
        sessions: 120,
        engagement_rate: 66.7,
      }],
    });
    expect(textOf(client)).not.toContain('property-secret-123');
    expect(textOf(client)).not.toContain('dashboard_url');
  });

  it('projects session-scoped traffic sources through the fixed provider adapter', async () => {
    const result = await handleClientAnalyticsReadActionTool(
      'get_ga4_traffic_sources',
      { workspace_id: 'ws-1', ...DATE_ARGS },
    );
    const data = dataOf(result);

    expect(runClientGa4TrafficSourcesReport).toHaveBeenCalledWith(
      'property-secret-123',
      PROVIDER_RANGE,
      10,
    );
    expect(data).toMatchObject({
      attribution_scope: 'session_source_medium',
      traffic_sources: [{
        source_name: 'google',
        medium: 'organic',
        sessions: 200,
        engaged_sessions: 140,
      }],
    });
  });

  it('returns exact comparison ranges, percentage-point change, and null zero-baseline deltas', async () => {
    const result = await handleClientAnalyticsReadActionTool(
      'get_ga4_period_comparison',
      { workspace_id: 'ws-1', ...DATE_ARGS },
    );
    const data = dataOf(result);

    expect(runClientGa4ComparisonReport).toHaveBeenCalledWith(
      'property-secret-123',
      PROVIDER_RANGE,
      PREVIOUS_PROVIDER_RANGE,
    );
    expect(data).toMatchObject({
      comparison_mode: 'previous_period',
      current_range: { start: '2026-06-01', end: '2026-06-28' },
      comparison_range: { start: '2026-05-04', end: '2026-05-31' },
      change: {
        users: 100,
        sessions: 50,
        page_views: 500,
        bounce_rate_percentage_points: -10,
      },
      change_percent: {
        users: 100,
        sessions: 25,
        page_views: null,
        new_users: -20,
        avg_session_duration_seconds: 50,
        bounce_rate: -25,
      },
    });
  });

  it('uses only exact unique pinned labels and keeps generic click ambiguous', async () => {
    const result = await handleClientAnalyticsReadActionTool(
      'get_ga4_key_events',
      { workspace_id: 'ws-1', ...DATE_ARGS },
    );
    const data = dataOf(result);
    const events = data.events as Array<Record<string, unknown>>;

    expect(runClientGa4KeyEventsReport).toHaveBeenCalledWith(
      'property-secret-123',
      PROVIDER_RANGE,
      10,
    );
    expect(events[0]).toMatchObject({
      mapping: {
        event_name: 'submit_form',
        display_name: 'Qualified form',
        mapping_status: 'configured',
      },
      user_rate: 5,
    });
    expect(events[1]).toMatchObject({
      mapping: {
        event_name: 'click',
        display_name: null,
        mapping_status: 'needs_attention',
        attention: { code: 'generic_click_requires_url_filter' },
      },
    });
    expect(events[2]).toMatchObject({
      mapping: {
        event_name: 'purchase',
        display_name: null,
        mapping_status: 'unmapped',
      },
    });
    expect(events[3]).toMatchObject({
      mapping: {
        event_name: 'duplicate_event',
        display_name: null,
        mapping_status: 'unmapped',
      },
    });
  });

  it('keeps page-view and landing-page scopes separate and sanitizes both paths', async () => {
    const result = await handleClientAnalyticsReadActionTool(
      'get_ga4_content_performance',
      { workspace_id: 'ws-1', ...DATE_ARGS },
    );
    const data = dataOf(result);

    expect(runClientGa4PageContentReport).toHaveBeenCalledWith(
      'property-secret-123',
      PROVIDER_RANGE,
      10,
    );
    expect(runClientGa4LandingContentReport).toHaveBeenCalledWith(
      'property-secret-123',
      PROVIDER_RANGE,
      10,
    );
    expect(data.pages_by_views).toEqual([{
      page_path: '/guide',
      views: 300,
      users: 220,
      avg_engagement_time_seconds: 42.5,
    }]);
    expect(data.landing_pages_by_sessions).toEqual([{
      landing_page: '/landing',
      sessions: 180,
      users: 150,
      engaged_sessions: 120,
      engagement_rate: 66.7,
      key_events: 15,
    }]);
    expect(data.pages_by_views).not.toEqual(data.landing_pages_by_sessions);
  });

  it('rejects invalid calendar dates, mixed date authority, and unequal custom comparisons', async () => {
    const invalidCalendar = await handleClientAnalyticsReadActionTool(
      'get_ga4_campaign_performance',
      {
        workspace_id: 'ws-1',
        start_date: '2026-02-30',
        end_date: '2026-03-01',
      },
    );
    expect(errorEnvelope(invalidCalendar)).toMatchObject({
      code: 'validation_failed',
      details: { failure_class: 'invalid_date_range' },
    });

    const mixedAuthority = await handleClientAnalyticsReadActionTool(
      'get_ga4_traffic_sources',
      { workspace_id: 'ws-1', days: 7, ...DATE_ARGS },
    );
    expect(errorEnvelope(mixedAuthority)).toMatchObject({
      code: 'validation_failed',
      details: { failure_class: 'invalid_date_range' },
    });

    const unequalCustom = await handleClientAnalyticsReadActionTool(
      'get_ga4_period_comparison',
      {
        workspace_id: 'ws-1',
        ...DATE_ARGS,
        comparison_mode: 'custom',
        comparison_start_date: '2026-05-01',
        comparison_end_date: '2026-05-07',
      },
    );
    expect(errorEnvelope(unequalCustom)).toMatchObject({
      code: 'validation_failed',
      details: { failure_class: 'invalid_comparison_range' },
    });
    expect(runClientGa4CampaignReport).not.toHaveBeenCalled();
    expect(runClientGa4TrafficSourcesReport).not.toHaveBeenCalled();
    expect(runClientGa4ComparisonReport).not.toHaveBeenCalled();
  });

  it('strictly rejects caller-controlled report fields before provider dispatch', async () => {
    const result = await handleClientAnalyticsReadActionTool(
      'get_ga4_campaign_performance',
      {
        workspace_id: 'ws-1',
        ...DATE_ARGS,
        dimensions: ['userId'],
        property_id: 'forged-property',
      },
    );

    expect(errorEnvelope(result)).toMatchObject({ code: 'validation_failed' });
    expect(runClientGa4CampaignReport).not.toHaveBeenCalled();
  });

  it('fails safely when GA4 configuration or the Google connection is missing', async () => {
    (getWorkspace as Mock).mockReturnValueOnce({
      id: 'ws-1',
      name: 'Workspace',
      eventConfig: [],
    });
    const missingProperty = await handleClientAnalyticsReadActionTool(
      'get_ga4_campaign_performance',
      { workspace_id: 'ws-1', ...DATE_ARGS },
    );
    expect(errorEnvelope(missingProperty)).toMatchObject({
      code: 'precondition_failed',
    });
    expect(textOf(missingProperty)).not.toContain('property');

    (isGlobalConnected as Mock).mockReturnValue(false);
    const disconnected = await handleClientAnalyticsReadActionTool(
      'get_ga4_campaign_performance',
      { workspace_id: 'ws-1', ...DATE_ARGS },
    );
    expect(errorEnvelope(disconnected)).toMatchObject({
      code: 'precondition_failed',
    });
    expect(runClientGa4CampaignReport).not.toHaveBeenCalled();
  });

  it('turns provider failures into a generic internal error without leaking raw details', async () => {
    (runClientGa4CampaignReport as Mock).mockRejectedValue(
      new Error(
        'GA4 raw response https://analyticsdata.googleapis.test/properties/property-secret-123 token=secret',
      ),
    );
    const result = await handleClientAnalyticsReadActionTool(
      'get_ga4_campaign_performance',
      { workspace_id: 'ws-1', ...DATE_ARGS },
    );
    const serialized = textOf(result);

    expect(errorEnvelope(result)).toMatchObject({ code: 'internal_error' });
    expect(serialized).not.toContain('analyticsdata');
    expect(serialized).not.toContain('property-secret-123');
    expect(serialized).not.toContain('token');
  });

  it('reports bounded quality, sampling, freshness, and factual truncation metadata', async () => {
    (runClientGa4CampaignReport as Mock).mockResolvedValue(providerReport([{
      campaignName: 'Only returned row',
      sessions: 10,
      users: 8,
      engagedSessions: 7,
      engagementRate: 70,
      keyEvents: 1,
    }], { rowCount: 4 }));
    const result = await handleClientAnalyticsReadActionTool(
      'get_ga4_campaign_performance',
      { workspace_id: 'ws-1', ...DATE_ARGS, limit: 1 },
    );
    const data = dataOf(result);

    expect(data.data_quality).toEqual({
      requested_ranges: [{ start: '2026-06-01', end: '2026-06-28' }],
      returned_rows: 1,
      results_truncated: true,
      subject_to_thresholding: false,
      data_loss_from_other_row: true,
      sampling: [{
        samples_read_count: '900',
        sampling_space_size: '1000',
      }],
      freshness_note: 'Google Analytics 4 data may take 24–48 hours to finalize.',
    });
  });

  it('keeps legacy text and structuredContent.data identical for every client tool', async () => {
    const requests = [
      ['get_search_performance', { workspace_id: 'ws-1', ...DATE_ARGS }],
      ['get_ga4_campaign_performance', { workspace_id: 'ws-1', ...DATE_ARGS }],
      ['get_ga4_period_comparison', { workspace_id: 'ws-1', ...DATE_ARGS }],
      ['get_ga4_traffic_sources', { workspace_id: 'ws-1', ...DATE_ARGS }],
      ['get_ga4_key_events', { workspace_id: 'ws-1', ...DATE_ARGS }],
      ['get_ga4_content_performance', { workspace_id: 'ws-1', ...DATE_ARGS }],
    ] as const;

    for (const [name, args] of requests) {
      const result = await handleClientAnalyticsReadActionTool(name, args);
      expect(result.isError, name).not.toBe(true);
      const data = dataOf(result);
      expect(JSON.stringify(data), name).not.toContain('property-secret-123');
      expect(data, name).not.toHaveProperty('dashboard_url');
    }
  });
});
