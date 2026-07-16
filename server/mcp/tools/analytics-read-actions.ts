import type { Tool } from '@modelcontextprotocol/sdk/types';
import { getSearchPerformanceInputSchema } from '../../../shared/types/mcp-action-schemas.js';
import {
  fetchSearchOverview,
  fetchPerformanceTrend,
  fetchSearchComparison,
  type CustomDateRange,
} from '../../analytics-data.js';
import { isGlobalConnected } from '../../google-auth.js';
import { createLogger } from '../../logger.js';
import { toMcpJsonSchema } from '../json-schema.js';
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

export const analyticsReadActionTools: Tool[] = [
  {
    name: 'get_search_performance',
    description:
      "Get a workspace's Google Search Console performance over an explicit date range: total clicks, impressions, average CTR, average position, the daily click/impression/position trend, and the top queries + pages for the window. Pass `days` for a trailing window (defaults to the last 28 days) OR an explicit `start_date`+`end_date` pair. Set `compare_previous: true` to also get a period-over-period delta vs the immediately preceding window of the same length — this lets an agent compute its own trends instead of guessing. Read-only. Returns an error if the workspace has no GSC property connected.",
    inputSchema: toMcpJsonSchema(getSearchPerformanceInputSchema),
  },
];

async function handleGetSearchPerformance(
  args: Record<string, unknown>,
): Promise<McpToolSuccessResponse | McpToolErrorResponse> {
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

    return mcpSuccess({
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
    });
  } catch (err) {
    log.error({ err, workspaceId }, 'get_search_performance failed');
    return mcpInternalError();
  }
}

export async function handleAnalyticsReadActionTool(
  name: string,
  args: Record<string, unknown>,
): Promise<McpToolSuccessResponse | McpToolErrorResponse> {
  if (name === 'get_search_performance') return handleGetSearchPerformance(args);
  return mcpNotFoundError('Unknown tool: the requested tool does not exist.', { resource_type: 'tool' });
}
