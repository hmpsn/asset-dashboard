import type { Tool } from '@modelcontextprotocol/sdk/types';
import { getInsights } from '../../analytics-insights-store.js';
import { getWorkspace } from '../../workspaces.js';
import type { InsightType } from '../../../shared/types/analytics.js';
import { createLogger } from '../../logger.js';

const log = createLogger('mcp-tools-insights');

export const insightTools: Tool[] = [
  {
    name: 'get_insights',
    description:
      'Get stored insights for a workspace. Optionally filter by insight type. Returns insight title, severity, impact score, and data payload. Insight types include: page_health, ranking_opportunity, content_decay, cannibalization, keyword_cluster, competitor_gap, ranking_mover, ctr_opportunity, anomaly_digest, audit_finding, site_health.',
    inputSchema: {
      type: 'object',
      properties: {
        workspaceId: { type: 'string', description: 'The workspace ID' },
        type: {
          type: 'string',
          description: 'Optional: filter to a specific insight type',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of insights to return (default: 20)',
        },
      },
      required: ['workspaceId'],
    },
  },
  {
    name: 'get_anomalies',
    description:
      'Get detected anomalies for a workspace — unusual traffic drops, rank changes, indexation issues. Returns unresolved anomalies by default.',
    inputSchema: {
      type: 'object',
      properties: {
        workspaceId: { type: 'string', description: 'The workspace ID' },
        resolved: {
          type: 'boolean',
          description: 'If true, include resolved anomalies. Default: false (unresolved only)',
        },
      },
      required: ['workspaceId'],
    },
  },
];

export async function handleInsightTool(
  name: string,
  args: Record<string, unknown>,
): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
  const workspaceId = args.workspaceId;
  if (typeof workspaceId !== 'string') {
    return {
      isError: true,
      content: [{ type: 'text' as const, text: 'Missing or invalid workspaceId' }],
    };
  }

  try {
    const ws = getWorkspace(workspaceId);
    if (!ws) {
      return {
        isError: true,
        content: [{ type: 'text' as const, text: `Workspace not found: ${workspaceId}` }],
      };
    }

    if (name === 'get_insights') {
      const type = typeof args.type === 'string' ? (args.type as InsightType) : undefined;
      const limit = typeof args.limit === 'number' ? Math.max(0, Math.floor(args.limit)) : 20;
      const insights = getInsights(workspaceId, type).slice(0, limit);
      return { content: [{ type: 'text' as const, text: JSON.stringify(insights) }] };
    }

    if (name === 'get_anomalies') {
      const resolved = args.resolved === true;
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
