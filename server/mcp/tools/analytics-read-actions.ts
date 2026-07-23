import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types';
import { getSearchPerformanceInputSchema } from '../../../shared/types/mcp-action-schemas.js';
import {
  MCP_CLIENT_ANALYTICS_LIMITS,
  clientGa4CampaignPerformanceOutputSchema,
  clientGa4ContentPerformanceOutputSchema,
  clientGa4KeyEventsOutputSchema,
  clientGa4PeriodComparisonOutputSchema,
  clientGa4TrafficSourcesOutputSchema,
  clientSearchPerformanceOutputSchema,
  getClientGa4CampaignPerformanceInputSchema,
  getClientGa4ContentPerformanceInputSchema,
  getClientGa4KeyEventsInputSchema,
  getClientGa4PeriodComparisonInputSchema,
  getClientGa4TrafficSourcesInputSchema,
  getClientSearchPerformanceInputSchema,
  getGa4CampaignPerformanceInputSchema,
  getGa4ContentPerformanceInputSchema,
  getGa4KeyEventsInputSchema,
  getGa4PeriodComparisonInputSchema,
  getGa4TrafficSourcesInputSchema,
  type GetClientGa4CampaignPerformanceInput,
  type GetClientGa4ContentPerformanceInput,
  type GetClientGa4KeyEventsInput,
  type GetClientGa4PeriodComparisonInput,
  type GetClientGa4TrafficSourcesInput,
} from '../../../shared/types/mcp-client-analytics.js';
import {
  fetchSearchOverview,
  fetchPerformanceTrend,
  fetchSearchComparison,
  type CustomDateRange,
} from '../../analytics-data.js';
import { isGlobalConnected } from '../../google-auth.js';
import {
  runClientGa4CampaignReport,
  runClientGa4ComparisonReport,
  runClientGa4KeyEventsReport,
  runClientGa4LandingContentReport,
  runClientGa4PageContentReport,
  runClientGa4TrafficSourcesReport,
  type ClientGa4ProviderDateRange,
  type ClientGa4ProviderReport,
} from '../../google-analytics.js';
import { createLogger } from '../../logger.js';
import {
  ClientGa4ProjectionError,
  mapClientGa4Event,
  percentageDelta,
  projectClientGa4DataQuality,
  resolveClientGa4ComparisonRange,
  resolveClientGa4DateRange,
  sanitizeClientGa4PagePath,
  type ClientGa4DateRange,
  type ClientGa4EventConfigEntry,
} from '../client-ga4-projection.js';
import {
  toMcpCompactOutputSchema,
  toMcpJsonSchema,
} from '../json-schema.js';
import {
  buildDashboardUrl,
  isMcpError,
  mcpInternalError,
  mcpNotFoundError,
  mcpPreconditionError,
  mcpSuccess,
  mcpValidationError,
  requireWorkspace,
  zodErrorToMcp,
  type McpToolErrorResponse,
  type McpToolSuccessResponse,
} from '../tool-helpers.js';

const log = createLogger('mcp-tools-analytics-read-actions');

const DEFAULT_WINDOW_DAYS = 28;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const GA4_FRESHNESS_NOTE =
  'Google Analytics 4 data may take 24–48 hours to finalize.';
const DEFAULT_GA4_ROWS = MCP_CLIENT_ANALYTICS_LIMITS.defaultGa4Rows;
const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

export const analyticsReadActionTools: Tool[] = [
  {
    name: 'get_search_performance',
    description:
      "Get a workspace's Google Search Console performance over an explicit date range: total clicks, impressions, average CTR, average position, the daily click/impression/position trend, and the top queries + pages for the window. Pass `days` for a trailing window (defaults to the last 28 days) OR an explicit `start_date`+`end_date` pair. Set `compare_previous: true` to also get a period-over-period delta vs the immediately preceding window of the same length — this lets an agent compute its own trends instead of guessing. Read-only. Returns an error if the workspace has no GSC property connected.",
    inputSchema: toMcpJsonSchema(getSearchPerformanceInputSchema),
  },
  {
    name: 'get_ga4_campaign_performance',
    description:
      'Get bounded GA4 campaign performance for a workspace using session-scoped campaign attribution. Read-only.',
    inputSchema: toMcpJsonSchema(getGa4CampaignPerformanceInputSchema),
    annotations: READ_ONLY_ANNOTATIONS,
  },
  {
    name: 'get_ga4_period_comparison',
    description:
      'Compare exact GA4 overview periods for a workspace using previous-period, year-over-year, or equal-length custom comparison authority. Read-only.',
    inputSchema: toMcpJsonSchema(getGa4PeriodComparisonInputSchema),
    annotations: READ_ONLY_ANNOTATIONS,
  },
  {
    name: 'get_ga4_traffic_sources',
    description:
      'Get bounded GA4 traffic-source performance for a workspace using session-scoped source and medium attribution. Read-only.',
    inputSchema: toMcpJsonSchema(getGa4TrafficSourcesInputSchema),
    annotations: READ_ONLY_ANNOTATIONS,
  },
  {
    name: 'get_ga4_key_events',
    description:
      'Get bounded GA4 key-event performance for a workspace with exact pinned event labels where configured. Read-only.',
    inputSchema: toMcpJsonSchema(getGa4KeyEventsInputSchema),
    annotations: READ_ONLY_ANNOTATIONS,
  },
  {
    name: 'get_ga4_content_performance',
    description:
      'Get bounded GA4 content performance for a workspace as separate page-view and landing-page rankings. Read-only.',
    inputSchema: toMcpJsonSchema(getGa4ContentPerformanceInputSchema),
    annotations: READ_ONLY_ANNOTATIONS,
  },
];

export const clientAnalyticsReadTools: Tool[] = [
  {
    name: 'get_search_performance',
    description:
      'Read aggregate Google Search Console performance for the connected workspace. Returns totals, bounded top queries and pages, a daily trend, and an optional previous-period comparison.',
    inputSchema: toMcpJsonSchema(getClientSearchPerformanceInputSchema),
    outputSchema: toMcpCompactOutputSchema(clientSearchPerformanceOutputSchema),
    annotations: READ_ONLY_ANNOTATIONS,
  },
  {
    name: 'get_ga4_campaign_performance',
    description:
      'Read bounded GA4 campaign performance for the connected workspace. Attribution is session-scoped.',
    inputSchema: toMcpJsonSchema(getClientGa4CampaignPerformanceInputSchema),
    outputSchema: toMcpCompactOutputSchema(clientGa4CampaignPerformanceOutputSchema),
    annotations: READ_ONLY_ANNOTATIONS,
  },
  {
    name: 'get_ga4_period_comparison',
    description:
      'Compare an exact GA4 period with a previous, year-over-year, or equal-length custom period for the connected workspace.',
    inputSchema: toMcpJsonSchema(getClientGa4PeriodComparisonInputSchema),
    outputSchema: toMcpCompactOutputSchema(clientGa4PeriodComparisonOutputSchema),
    annotations: READ_ONLY_ANNOTATIONS,
  },
  {
    name: 'get_ga4_traffic_sources',
    description:
      'Read bounded GA4 traffic-source performance for the connected workspace using session source and medium.',
    inputSchema: toMcpJsonSchema(getClientGa4TrafficSourcesInputSchema),
    outputSchema: toMcpCompactOutputSchema(clientGa4TrafficSourcesOutputSchema),
    annotations: READ_ONLY_ANNOTATIONS,
  },
  {
    name: 'get_ga4_key_events',
    description:
      'Read bounded GA4 key events for the connected workspace with exact configured labels and explicit ambiguous-click attention.',
    inputSchema: toMcpJsonSchema(getClientGa4KeyEventsInputSchema),
    outputSchema: toMcpCompactOutputSchema(clientGa4KeyEventsOutputSchema),
    annotations: READ_ONLY_ANNOTATIONS,
  },
  {
    name: 'get_ga4_content_performance',
    description:
      'Read separate bounded GA4 page-view and landing-page rankings for the connected workspace.',
    inputSchema: toMcpJsonSchema(getClientGa4ContentPerformanceInputSchema),
    outputSchema: toMcpCompactOutputSchema(clientGa4ContentPerformanceOutputSchema),
    annotations: READ_ONLY_ANNOTATIONS,
  },
];

function exactUtcDate(value: string): Date | null {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10) === value ? parsed : null;
}

function stripPageQueryAndFragment(page: string): string {
  try {
    const url = new URL(page);
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch (err) {
    log.debug(
      {
        failureClass: err instanceof Error
          ? 'relative_or_invalid_page_value'
          : 'relative_or_invalid_page_non_error',
      },
      'Client search page is not an absolute URL; stripping suffix as a path',
    );
    return page.split(/[?#]/u, 1)[0] ?? '';
  }
}

function clientDateRangeError(
  startDate: string | undefined,
  endDate: string | undefined,
): McpToolErrorResponse | null {
  if ((startDate && !endDate) || (!startDate && endDate)) {
    return mcpValidationError(
      'Invalid tool input at start_date/end_date: provide both dates or neither.',
      {
        field_path: 'start_date,end_date',
        constraint: 'start_date and end_date must be provided together.',
      },
    );
  }
  if (!startDate || !endDate) return null;

  const start = exactUtcDate(startDate);
  const end = exactUtcDate(endDate);
  if (!start || !end) {
    return mcpValidationError(
      'Invalid tool input at start_date/end_date: dates must be valid calendar dates.',
      {
        field_path: 'start_date,end_date',
        constraint: 'Must be valid calendar dates in YYYY-MM-DD format.',
      },
    );
  }
  if (end.getTime() < start.getTime()) {
    return mcpValidationError(
      'Invalid tool input at end_date: end_date must be on or after start_date.',
      {
        field_path: 'end_date',
        constraint: 'Must be on or after start_date.',
      },
    );
  }

  const inclusiveDays = Math.floor((end.getTime() - start.getTime()) / MS_PER_DAY) + 1;
  if (inclusiveDays > MCP_CLIENT_ANALYTICS_LIMITS.maxDays) {
    return mcpValidationError(
      'Invalid tool input at start_date/end_date: date range exceeds 366 days.',
      {
        field_path: 'start_date,end_date',
        constraint: 'Inclusive date range must not exceed 366 days.',
      },
    );
  }
  return null;
}

type ScopedGa4CampaignInput =
  GetClientGa4CampaignPerformanceInput & { workspace_id: string };
type ScopedGa4ComparisonInput =
  GetClientGa4PeriodComparisonInput & { workspace_id: string };
type ScopedGa4TrafficSourcesInput =
  GetClientGa4TrafficSourcesInput & { workspace_id: string };
type ScopedGa4KeyEventsInput =
  GetClientGa4KeyEventsInput & { workspace_id: string };
type ScopedGa4ContentInput =
  GetClientGa4ContentPerformanceInput & { workspace_id: string };

interface RootOutputSchema<T> {
  safeParse(value: unknown):
    | { success: true; data: { data: T } }
    | { success: false };
}

interface Ga4WorkspaceReadTarget {
  propertyId: string;
  eventConfig: ClientGa4EventConfigEntry[];
}

function requireGa4WorkspaceReadTarget(
  workspaceId: string,
): Ga4WorkspaceReadTarget | McpToolErrorResponse {
  const workspace = requireWorkspace(workspaceId);
  if (isMcpError(workspace)) return workspace;
  if (!workspace.ga4PropertyId) {
    return mcpPreconditionError(
      'Google Analytics 4 is not configured for this workspace.',
    );
  }
  if (!isGlobalConnected()) {
    return mcpPreconditionError(
      'Google is not connected. Reconnect Google Analytics before requesting analytics.',
    );
  }
  return {
    propertyId: workspace.ga4PropertyId,
    eventConfig: (workspace.eventConfig ?? []).map(config => ({
      eventName: config.eventName,
      displayName: config.displayName,
      pinned: config.pinned,
    })),
  };
}

function providerRange(range: ClientGa4DateRange): ClientGa4ProviderDateRange {
  return { startDate: range.start, endDate: range.end };
}

function reportMatchesRanges(
  report: ClientGa4ProviderReport<unknown>,
  ranges: readonly ClientGa4DateRange[],
): boolean {
  return report.requestedRanges.length === ranges.length
    && report.requestedRanges.every((range, index) => (
      range.startDate === ranges[index]?.start
      && range.endDate === ranges[index]?.end
    ));
}

function projectReportQuality(
  report: ClientGa4ProviderReport<unknown>,
  ranges: readonly ClientGa4DateRange[],
  requestedLimit: number,
) {
  if (!reportMatchesRanges(report, ranges)) {
    throw new ClientGa4ProjectionError(
      'invalid_data_quality',
      'GA4 provider ranges did not match the resolved request.',
    );
  }
  return projectClientGa4DataQuality({
    requestedRanges: ranges,
    returnedRowCount: report.sourceReturnedRowCount ?? report.rows.length,
    providerRowCount: report.rowCount,
    requestedLimit,
    reportMetadata: report.metadata,
    freshnessNote: GA4_FRESHNESS_NOTE,
  });
}

function validateGa4Output<T>(
  tool: string,
  schema: RootOutputSchema<T>,
  data: T,
): T | McpToolErrorResponse {
  const output = schema.safeParse({ data });
  if (output.success) return output.data.data;
  log.error(
    { tool, failureClass: 'client_output_contract' },
    'GA4 analytics output failed its declared contract',
  );
  return mcpInternalError();
}

async function executeGa4Read<T>(
  workspaceId: string,
  tool: string,
  read: (target: Ga4WorkspaceReadTarget) => Promise<T | McpToolErrorResponse>,
): Promise<T | McpToolErrorResponse> {
  const target = requireGa4WorkspaceReadTarget(workspaceId);
  if (isMcpError(target)) return target;

  try {
    return await read(target);
  } catch (err) {
    if (
      err instanceof ClientGa4ProjectionError
      && (
        err.code === 'invalid_date_range'
        || err.code === 'invalid_comparison_range'
      )
    ) {
      log.warn(
        { tool, failureClass: err.code },
        'GA4 analytics request failed date validation',
      );
      return mcpValidationError(
        'Invalid GA4 date or comparison range.',
        { failure_class: err.code },
      );
    }
    log.error(
      {
        tool,
        failureClass: err instanceof ClientGa4ProjectionError
          ? err.code
          : 'provider_or_projection_failure',
      },
      'GA4 analytics read failed',
    );
    return mcpInternalError();
  }
}

interface SearchPerformancePayload {
  date_range: { start: string; end: string };
  totals: {
    clicks: number;
    impressions: number;
    ctr: number;
    position: number;
  };
  top_queries: Array<{
    query: string;
    clicks: number;
    impressions: number;
    ctr: number;
    position: number;
  }>;
  top_pages: Array<{
    page: string;
    clicks: number;
    impressions: number;
    ctr: number;
    position: number;
  }>;
  daily_trend: Array<{
    date: string;
    clicks: number;
    impressions: number;
    ctr: number;
    position: number;
  }>;
  period_comparison: Awaited<ReturnType<typeof fetchSearchComparison>> | null;
  dashboard_url: string;
}

async function buildSearchPerformancePayload(
  args: Record<string, unknown>,
): Promise<SearchPerformancePayload | McpToolErrorResponse> {
  const parsed = getSearchPerformanceInputSchema.safeParse(args);
  if (!parsed.success) return zodErrorToMcp(parsed.error);

  const {
    workspace_id: workspaceId,
    days,
    start_date: startDate,
    end_date: endDate,
    compare_previous: comparePrevious,
  } = parsed.data;

  const workspace = requireWorkspace(workspaceId);
  if (isMcpError(workspace)) return workspace;

  // Resolve the GSC read target the same way admin-chat-context does:
  //   siteId = workspace.webflowSiteId, gscSiteUrl = workspace.gscPropertyUrl,
  // and require a live Google connection. Reading GSC needs all three.
  const siteId = workspace.webflowSiteId;
  const gscSiteUrl = workspace.gscPropertyUrl;
  if (!siteId || !gscSiteUrl) {
    return mcpPreconditionError(
      'No Google Search Console property is connected for this workspace. Connect GSC (and a Webflow site) before requesting search performance.',
    );
  }
  if (!isGlobalConnected()) {
    return mcpPreconditionError(
      'Google is not connected on this server. Reconnect Google Search Console to read search performance.',
    );
  }

  // start_date/end_date must be supplied together; when both are present they
  // override `days`. A lone bound is ambiguous, so reject it explicitly.
  if ((startDate && !endDate) || (!startDate && endDate)) {
    return mcpValidationError('Invalid tool input at start_date/end_date: provide both dates or neither.', {
      field_path: 'start_date,end_date',
      constraint: 'start_date and end_date must be provided together.',
    });
  }

  let dateRange: CustomDateRange | undefined;
  if (startDate && endDate) {
    if (endDate < startDate) {
      return mcpValidationError('Invalid tool input at end_date: end_date must be on or after start_date.', {
        field_path: 'end_date',
        constraint: 'Must be on or after start_date.',
      });
    }
    dateRange = { startDate, endDate };
  }

  // `days` is only used when no explicit range is given. The underlying
  // search-console functions ignore `days` when a valid dateRange is passed.
  const windowDays = days ?? DEFAULT_WINDOW_DAYS;

  try {
    const [overview, trend, comparison] = await Promise.all([
      fetchSearchOverview(siteId, gscSiteUrl, windowDays, dateRange),
      fetchPerformanceTrend(siteId, gscSiteUrl, windowDays, dateRange),
      comparePrevious
        ? fetchSearchComparison(siteId, gscSiteUrl, windowDays, dateRange)
        : Promise.resolve(null),
    ]);

    return {
      date_range: overview.dateRange,
      totals: {
        clicks: overview.totalClicks,
        impressions: overview.totalImpressions,
        ctr: overview.avgCtr,
        position: overview.avgPosition,
      },
      top_queries: overview.topQueries,
      top_pages: overview.topPages,
      daily_trend: trend,
      period_comparison: comparison,
      dashboard_url: buildDashboardUrl(workspaceId, 'analytics'),
    };
  } catch (err) {
    log.error(
      {
        tool: 'get_search_performance',
        failureClass: err instanceof Error
          ? 'provider_or_projection_error'
          : 'provider_or_projection_non_error',
      },
      'get_search_performance failed',
    );
    return mcpInternalError();
  }
}

async function handleGetSearchPerformance(
  args: Record<string, unknown>,
): Promise<McpToolSuccessResponse | McpToolErrorResponse> {
  const result = await buildSearchPerformancePayload(args);
  return isMcpError(result) ? result : mcpSuccess(result);
}

async function buildGa4CampaignPerformance(
  input: ScopedGa4CampaignInput,
) {
  return executeGa4Read(
    input.workspace_id,
    'get_ga4_campaign_performance',
    async (target) => {
      const range = resolveClientGa4DateRange(input);
      const limit = input.limit ?? DEFAULT_GA4_ROWS;
      const report = await runClientGa4CampaignReport(
        target.propertyId,
        providerRange(range),
        limit,
      );
      const data = {
        source: 'google_analytics_4' as const,
        attribution_scope: 'session_campaign' as const,
        date_range: range,
        campaigns: report.rows.map(row => ({
          campaign_name: row.campaignName,
          sessions: row.sessions,
          users: row.users,
          engaged_sessions: row.engagedSessions,
          engagement_rate: row.engagementRate,
          key_events: row.keyEvents,
        })),
        data_quality: projectReportQuality(report, [range], limit),
      };
      return validateGa4Output(
        'get_ga4_campaign_performance',
        clientGa4CampaignPerformanceOutputSchema,
        data,
      );
    },
  );
}

async function buildGa4TrafficSources(
  input: ScopedGa4TrafficSourcesInput,
) {
  return executeGa4Read(
    input.workspace_id,
    'get_ga4_traffic_sources',
    async (target) => {
      const range = resolveClientGa4DateRange(input);
      const limit = input.limit ?? DEFAULT_GA4_ROWS;
      const report = await runClientGa4TrafficSourcesReport(
        target.propertyId,
        providerRange(range),
        limit,
      );
      const data = {
        source: 'google_analytics_4' as const,
        attribution_scope: 'session_source_medium' as const,
        date_range: range,
        traffic_sources: report.rows.map(row => ({
          source_name: row.source,
          medium: row.medium,
          sessions: row.sessions,
          users: row.users,
          engaged_sessions: row.engagedSessions,
          engagement_rate: row.engagementRate,
          key_events: row.keyEvents,
        })),
        data_quality: projectReportQuality(report, [range], limit),
      };
      return validateGa4Output(
        'get_ga4_traffic_sources',
        clientGa4TrafficSourcesOutputSchema,
        data,
      );
    },
  );
}

async function buildGa4PeriodComparison(
  input: ScopedGa4ComparisonInput,
) {
  return executeGa4Read(
    input.workspace_id,
    'get_ga4_period_comparison',
    async (target) => {
      const currentRange = resolveClientGa4DateRange(input);
      const { comparisonMode, comparisonRange } =
        resolveClientGa4ComparisonRange(input, currentRange);
      const report = await runClientGa4ComparisonReport(
        target.propertyId,
        providerRange(currentRange),
        providerRange(comparisonRange),
      );
      const current = report.rows.find(row => row.range === 'current');
      const comparison = report.rows.find(row => row.range === 'comparison');
      if (!current || !comparison) {
        throw new ClientGa4ProjectionError(
          'invalid_data_quality',
          'GA4 comparison rows were incomplete.',
        );
      }
      const currentMetrics = {
        users: current.users,
        sessions: current.sessions,
        page_views: current.pageViews,
        new_users: current.newUsers,
        avg_session_duration_seconds: current.avgSessionDurationSeconds,
        bounce_rate: current.bounceRate,
      };
      const comparisonMetrics = {
        users: comparison.users,
        sessions: comparison.sessions,
        page_views: comparison.pageViews,
        new_users: comparison.newUsers,
        avg_session_duration_seconds: comparison.avgSessionDurationSeconds,
        bounce_rate: comparison.bounceRate,
      };
      const data = {
        source: 'google_analytics_4' as const,
        comparison_mode: comparisonMode,
        current_range: currentRange,
        comparison_range: comparisonRange,
        current: currentMetrics,
        comparison: comparisonMetrics,
        change: {
          users: current.users - comparison.users,
          sessions: current.sessions - comparison.sessions,
          page_views: current.pageViews - comparison.pageViews,
          new_users: current.newUsers - comparison.newUsers,
          avg_session_duration_seconds:
            current.avgSessionDurationSeconds - comparison.avgSessionDurationSeconds,
          bounce_rate_percentage_points: current.bounceRate - comparison.bounceRate,
        },
        change_percent: {
          users: percentageDelta(current.users, comparison.users),
          sessions: percentageDelta(current.sessions, comparison.sessions),
          page_views: percentageDelta(current.pageViews, comparison.pageViews),
          new_users: percentageDelta(current.newUsers, comparison.newUsers),
          avg_session_duration_seconds: percentageDelta(
            current.avgSessionDurationSeconds,
            comparison.avgSessionDurationSeconds,
          ),
          bounce_rate: percentageDelta(current.bounceRate, comparison.bounceRate),
        },
        data_quality: projectReportQuality(
          report,
          [currentRange, comparisonRange],
          2,
        ),
      };
      return validateGa4Output(
        'get_ga4_period_comparison',
        clientGa4PeriodComparisonOutputSchema,
        data,
      );
    },
  );
}

async function buildGa4KeyEvents(
  input: ScopedGa4KeyEventsInput,
) {
  return executeGa4Read(
    input.workspace_id,
    'get_ga4_key_events',
    async (target) => {
      const range = resolveClientGa4DateRange(input);
      const limit = input.limit ?? DEFAULT_GA4_ROWS;
      const report = await runClientGa4KeyEventsReport(
        target.propertyId,
        providerRange(range),
        limit,
      );
      if (
        report.rows.some(row => row.users > report.periodTotalUsers)
      ) {
        throw new ClientGa4ProjectionError(
          'invalid_data_quality',
          'GA4 key-event user totals were inconsistent.',
        );
      }
      const data = {
        source: 'google_analytics_4' as const,
        date_range: range,
        events: report.rows.map(row => ({
          mapping: mapClientGa4Event(row.eventName, target.eventConfig),
          key_events: row.keyEvents,
          users: row.users,
          user_rate: report.periodTotalUsers > 0
            ? (row.users / report.periodTotalUsers) * 100
            : 0,
        })),
        data_quality: projectReportQuality(report, [range], limit),
      };
      return validateGa4Output(
        'get_ga4_key_events',
        clientGa4KeyEventsOutputSchema,
        data,
      );
    },
  );
}

async function buildGa4ContentPerformance(
  input: ScopedGa4ContentInput,
) {
  return executeGa4Read(
    input.workspace_id,
    'get_ga4_content_performance',
    async (target) => {
      const range = resolveClientGa4DateRange(input);
      const limit = input.limit ?? DEFAULT_GA4_ROWS;
      const [pagesReport, landingPagesReport] = await Promise.all([
        runClientGa4PageContentReport(
          target.propertyId,
          providerRange(range),
          limit,
        ),
        runClientGa4LandingContentReport(
          target.propertyId,
          providerRange(range),
          limit,
        ),
      ]);
      const data = {
        source: 'google_analytics_4' as const,
        date_range: range,
        pages_by_views: pagesReport.rows.map(row => ({
          page_path: sanitizeClientGa4PagePath(row.path),
          views: row.views,
          users: row.users,
          avg_engagement_time_seconds: row.avgEngagementTimeSeconds,
        })),
        landing_pages_by_sessions: landingPagesReport.rows.map(row => ({
          landing_page: sanitizeClientGa4PagePath(row.landingPage),
          sessions: row.sessions,
          users: row.users,
          engaged_sessions: row.engagedSessions,
          engagement_rate: row.engagementRate,
          key_events: row.keyEvents,
        })),
        data_quality: {
          pages_by_views: projectReportQuality(pagesReport, [range], limit),
          landing_pages_by_sessions: projectReportQuality(
            landingPagesReport,
            [range],
            limit,
          ),
        },
      };
      return validateGa4Output(
        'get_ga4_content_performance',
        clientGa4ContentPerformanceOutputSchema,
        data,
      );
    },
  );
}

export async function handleAnalyticsReadActionTool(
  name: string,
  args: Record<string, unknown>,
): Promise<McpToolSuccessResponse | McpToolErrorResponse> {
  if (name === 'get_search_performance') return handleGetSearchPerformance(args);

  let result: unknown | McpToolErrorResponse;
  if (name === 'get_ga4_campaign_performance') {
    const parsed = getGa4CampaignPerformanceInputSchema.safeParse(args);
    if (!parsed.success) return zodErrorToMcp(parsed.error);
    result = await buildGa4CampaignPerformance(parsed.data);
  } else if (name === 'get_ga4_period_comparison') {
    const parsed = getGa4PeriodComparisonInputSchema.safeParse(args);
    if (!parsed.success) return zodErrorToMcp(parsed.error);
    result = await buildGa4PeriodComparison(parsed.data);
  } else if (name === 'get_ga4_traffic_sources') {
    const parsed = getGa4TrafficSourcesInputSchema.safeParse(args);
    if (!parsed.success) return zodErrorToMcp(parsed.error);
    result = await buildGa4TrafficSources(parsed.data);
  } else if (name === 'get_ga4_key_events') {
    const parsed = getGa4KeyEventsInputSchema.safeParse(args);
    if (!parsed.success) return zodErrorToMcp(parsed.error);
    result = await buildGa4KeyEvents(parsed.data);
  } else if (name === 'get_ga4_content_performance') {
    const parsed = getGa4ContentPerformanceInputSchema.safeParse(args);
    if (!parsed.success) return zodErrorToMcp(parsed.error);
    result = await buildGa4ContentPerformance(parsed.data);
  } else {
    return mcpNotFoundError(
      'Unknown tool: the requested tool does not exist.',
      { resource_type: 'tool' },
    );
  }

  return isMcpError(result) ? result : mcpSuccess(result);
}

async function handleClientSearchPerformance(
  workspaceId: string,
  clientArgs: Record<string, unknown>,
): Promise<CallToolResult> {
  const parsed = getClientSearchPerformanceInputSchema.safeParse(clientArgs);
  if (!parsed.success) return zodErrorToMcp(parsed.error);

  const rangeError = clientDateRangeError(
    parsed.data.start_date,
    parsed.data.end_date,
  );
  if (rangeError) return rangeError;

  const result = await buildSearchPerformancePayload({
    workspace_id: workspaceId,
    ...parsed.data,
  });
  if (isMcpError(result)) return result;

  const queryLimit = MCP_CLIENT_ANALYTICS_LIMITS.maxSearchRows;
  const dayLimit = MCP_CLIENT_ANALYTICS_LIMITS.maxDays;
  const data = {
    source: 'google_search_console' as const,
    date_range: result.date_range,
    totals: result.totals,
    top_queries: result.top_queries.slice(0, queryLimit),
    top_pages: result.top_pages.slice(0, queryLimit).map(page => ({
      ...page,
      page: stripPageQueryAndFragment(page.page),
    })),
    daily_trend: result.daily_trend.slice(0, dayLimit),
    period_comparison: result.period_comparison,
    data_quality: {
      returned_queries: Math.min(result.top_queries.length, queryLimit),
      returned_pages: Math.min(result.top_pages.length, queryLimit),
      query_results_truncated: result.top_queries.length > queryLimit,
      page_results_truncated: result.top_pages.length > queryLimit,
      freshness_note: 'Google Search Console data typically lags by approximately three days.',
    },
  };
  const output = clientSearchPerformanceOutputSchema.safeParse({ data });
  if (!output.success) {
    log.error(
      {
        tool: 'get_search_performance',
        failureClass: 'client_output_contract',
      },
      'Client search performance output failed its declared contract',
    );
    return mcpInternalError();
  }

  return {
    content: [{ type: 'text', text: JSON.stringify(output.data.data) }],
    structuredContent: output.data,
  };
}

function clientStructuredSuccess(data: unknown): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(data) }],
    structuredContent: { data },
  };
}

async function handleClientGa4Read(
  name: string,
  workspaceId: string,
  clientArgs: Record<string, unknown>,
): Promise<CallToolResult> {
  let result: unknown | McpToolErrorResponse;
  if (name === 'get_ga4_campaign_performance') {
    const parsed = getClientGa4CampaignPerformanceInputSchema.safeParse(clientArgs);
    if (!parsed.success) return zodErrorToMcp(parsed.error);
    result = await buildGa4CampaignPerformance({
      workspace_id: workspaceId,
      ...parsed.data,
    });
  } else if (name === 'get_ga4_period_comparison') {
    const parsed = getClientGa4PeriodComparisonInputSchema.safeParse(clientArgs);
    if (!parsed.success) return zodErrorToMcp(parsed.error);
    result = await buildGa4PeriodComparison({
      workspace_id: workspaceId,
      ...parsed.data,
    });
  } else if (name === 'get_ga4_traffic_sources') {
    const parsed = getClientGa4TrafficSourcesInputSchema.safeParse(clientArgs);
    if (!parsed.success) return zodErrorToMcp(parsed.error);
    result = await buildGa4TrafficSources({
      workspace_id: workspaceId,
      ...parsed.data,
    });
  } else if (name === 'get_ga4_key_events') {
    const parsed = getClientGa4KeyEventsInputSchema.safeParse(clientArgs);
    if (!parsed.success) return zodErrorToMcp(parsed.error);
    result = await buildGa4KeyEvents({
      workspace_id: workspaceId,
      ...parsed.data,
    });
  } else {
    const parsed = getClientGa4ContentPerformanceInputSchema.safeParse(clientArgs);
    if (!parsed.success) return zodErrorToMcp(parsed.error);
    result = await buildGa4ContentPerformance({
      workspace_id: workspaceId,
      ...parsed.data,
    });
  }

  return isMcpError(result) ? result : clientStructuredSuccess(result);
}

/**
 * Client-profile adapter for the canonical analytics handler.
 *
 * The registry injects workspace_id from the authenticated credential. This
 * adapter validates the workspace-free public input before calling the same
 * underlying full-profile handler, then projects and validates the bounded
 * client-safe result.
 */
export async function handleClientAnalyticsReadActionTool(
  name: string,
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  if (!clientAnalyticsReadTools.some(tool => tool.name === name)) {
    return mcpNotFoundError(
      'Unknown tool: the requested tool does not exist.',
      { resource_type: 'tool' },
    );
  }

  const { workspace_id: workspaceId, ...clientArgs } = args;
  if (typeof workspaceId !== 'string' || workspaceId.length === 0) {
    return mcpInternalError();
  }
  return name === 'get_search_performance'
    ? handleClientSearchPerformance(workspaceId, clientArgs)
    : handleClientGa4Read(name, workspaceId, clientArgs);
}
