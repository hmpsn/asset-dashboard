import type { Tool } from '@modelcontextprotocol/sdk/types';
import {
  getAnomaliesInputSchema,
  getInsightsInputSchema,
  getUnresolvedInsightsInputSchema,
} from '../../../shared/types/mcp-action-schemas.js';
import { getInsights, getInsightsByDomain, getUnresolvedInsights } from '../../analytics-insights-store.js';
import { getWorkspace } from '../../workspaces.js';
import type { InsightType } from '../../../shared/types/analytics.js';
import { createLogger } from '../../logger.js';
import { toMcpJsonSchema } from '../json-schema.js';

const log = createLogger('mcp-tools-insights');

export const insightTools: Tool[] = [
  {
    name: 'get_insights',
    description:
      'Get stored insights for a workspace. Optionally filter by insight type. Returns insight title, severity, impact score, and data payload. Insight types include: page_health, ranking_opportunity, content_decay, cannibalization, keyword_cluster, competitor_gap, ranking_mover, ctr_opportunity, anomaly_digest, audit_finding, site_health.',
    inputSchema: toMcpJsonSchema(getInsightsInputSchema),
  },
  {
    name: 'get_anomalies',
    description:
      'Get detected anomalies for a workspace — unusual traffic drops, rank changes, indexation issues. Returns unresolved anomalies by default.',
    inputSchema: toMcpJsonSchema(getAnomaliesInputSchema),
  },
  {
    name: 'get_unresolved_insights',
    description:
      'Get unresolved insight queue entries for a workspace, ordered by impact for operational follow-up.',
    inputSchema: toMcpJsonSchema(getUnresolvedInsightsInputSchema),
  },
];

export async function handleInsightTool(
  name: string,
  args: Record<string, unknown>,
): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
  const workspaceId = args.workspaceId;
  try {
    if (typeof workspaceId !== 'string') {
      return {
        isError: true,
        content: [{ type: 'text' as const, text: 'Missing or invalid workspaceId' }],
      };
    }
    const ws = getWorkspace(workspaceId);
    if (!ws) {
      return {
        isError: true,
        content: [{ type: 'text' as const, text: `Workspace not found: ${workspaceId}` }],
      };
    }

    if (name === 'get_insights') {
      const parsed = getInsightsInputSchema.safeParse(args);
      if (!parsed.success) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: `Validation failed: ${JSON.stringify(parsed.error.issues)}` }],
        };
      }
      const { type, domain, limit } = parsed.data;
      const base = domain
        ? getInsightsByDomain(workspaceId, domain)
        : getInsights(workspaceId, type as InsightType | undefined);
      const insights = type
        ? base.filter(insight => insight.insightType === type)
        : base;
      const clampedLimit = limit ?? 20;
      const items = insights.slice(0, clampedLimit);
      return { content: [{ type: 'text' as const, text: JSON.stringify(items) }] };
    }

    if (name === 'get_unresolved_insights') {
      const parsed = getUnresolvedInsightsInputSchema.safeParse(args);
      if (!parsed.success) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: `Validation failed: ${JSON.stringify(parsed.error.issues)}` }],
        };
      }
      const { limit } = parsed.data;
      const items = getUnresolvedInsights(workspaceId).slice(0, limit ?? 100);
      return { content: [{ type: 'text' as const, text: JSON.stringify(items) }] };
    }

    if (name === 'get_anomalies') {
      const parsed = getAnomaliesInputSchema.safeParse(args);
      if (!parsed.success) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: `Validation failed: ${JSON.stringify(parsed.error.issues)}` }],
        };
      }
      const resolved = parsed.data.resolved === true;
      let anomalies = getInsights(workspaceId, 'anomaly_digest');
      if (!resolved) {
        anomalies = anomalies.filter(a => a.resolutionStatus !== 'resolved');
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(anomalies) }] };
    }

    return {
      isError: true,
      content: [{ type: 'text' as const, text: `Unknown tool: ${name}` }],
    };
  } catch (err) {
    log.error({ err, tool: name, workspaceId }, 'MCP tool error');
    const message = err instanceof Error ? err.message : String(err);
    return {
      isError: true,
      content: [{ type: 'text' as const, text: `Tool error: ${message}` }],
    };
  }
}
