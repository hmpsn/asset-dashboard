import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types';
import { getSearchPerformanceInputSchema } from '../../../shared/types/mcp-action-schemas.js';
import {
  MCP_CLIENT_ANALYTICS_LIMITS,
  clientSearchPerformanceOutputSchema,
  getClientSearchPerformanceInputSchema,
} from '../../../shared/types/mcp-client-analytics.js';
import {
  fetchSearchOverview,
  fetchPerformanceTrend,
  fetchSearchComparison,
  type CustomDateRange,
} from '../../analytics-data.js';
import { isGlobalConnected } from '../../google-auth.js';
import { createLogger } from '../../logger.js';
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

export const analyticsReadActionTools: Tool[] = [
  {
    name: 'get_search_performance',
    description:
      "Get a workspace's Google Search Console performance over an explicit date range: total clicks, impressions, average CTR, average position, the daily click/impression/position trend, and the top queries + pages for the window. Pass `days` for a trailing window (defaults to the last 28 days) OR an explicit `start_date`+`end_date` pair. Set `compare_previous: true` to also get a period-over-period delta vs the immediately preceding window of the same length — this lets an agent compute its own trends instead of guessing. Read-only. Returns an error if the workspace has no GSC property connected.",
    inputSchema: toMcpJsonSchema(getSearchPerformanceInputSchema),
  },
];

export const clientSearchPerformanceTool: Tool = {
  name: 'get_search_performance',
  description:
    'Read aggregate Google Search Console performance for the connected workspace. Returns totals, bounded top queries and pages, a daily trend, and an optional previous-period comparison.',
  inputSchema: toMcpJsonSchema(getClientSearchPerformanceInputSchema),
  outputSchema: toMcpCompactOutputSchema(clientSearchPerformanceOutputSchema),
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
};

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

export async function handleAnalyticsReadActionTool(
  name: string,
  args: Record<string, unknown>,
): Promise<McpToolSuccessResponse | McpToolErrorResponse> {
  if (name === 'get_search_performance') return handleGetSearchPerformance(args);
  return mcpNotFoundError('Unknown tool: the requested tool does not exist.', { resource_type: 'tool' });
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
  if (name !== clientSearchPerformanceTool.name) {
    return mcpNotFoundError(
      'Unknown tool: the requested tool does not exist.',
      { resource_type: 'tool' },
    );
  }

  const { workspace_id: workspaceId, ...clientArgs } = args;
  if (typeof workspaceId !== 'string' || workspaceId.length === 0) {
    return mcpInternalError();
  }

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
        tool: name,
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
