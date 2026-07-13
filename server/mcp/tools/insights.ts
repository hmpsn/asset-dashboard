import type { Tool } from '@modelcontextprotocol/sdk/types';
import {
  getAnomaliesInputSchema,
  getInsightsInputSchema,
  getUnresolvedInsightsInputSchema,
  resolveInsightInputSchema,
  bulkResolveInsightsInputSchema,
} from '../../../shared/types/mcp-action-schemas.js';
import { getInsights, getInsightsByDomain, getUnresolvedInsights, resolveInsight } from '../../analytics-insights-store.js';
import { recordInsightResolutionOutcome } from '../../outcome-tracking.js';
import { InvalidTransitionError } from '../../state-machines.js';
import { getWorkspace } from '../../workspaces.js';
import { addActivity } from '../../activity-log.js';
import { broadcastToWorkspace } from '../../broadcast.js';
import { WS_EVENTS } from '../../ws-events.js';
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
  {
    name: 'resolve_insight',
    description:
      "Close the loop on an insight: mark it 'resolved' (done) or 'in_progress' (being worked) with an optional note. Use after you have acted on an insight returned by get_unresolved_insights/get_insights so it stops re-surfacing. Resolving records an outcome baseline for the learning system. Returns the updated insight; errors if the insight id is not in this workspace.",
    inputSchema: toMcpJsonSchema(resolveInsightInputSchema),
  },
  {
    name: 'bulk_resolve_insights',
    description:
      "Mark multiple insights 'resolved' or 'in_progress' in one call (give an array of insightIds, max 100). Returns { updatedCount, updated, notFound } — which ids were updated vs not found in this workspace. Use to triage a batch of insights after acting on them.",
    inputSchema: toMcpJsonSchema(bulkResolveInsightsInputSchema),
  },
];

export const INSIGHT_HANDLED_TOOL_NAMES = Object.freeze([
  'get_insights',
  'get_anomalies',
  'get_unresolved_insights',
  'resolve_insight',
  'bulk_resolve_insights',
] as const);

type InsightHandledToolName = (typeof INSIGHT_HANDLED_TOOL_NAMES)[number];

function isInsightHandledToolName(name: string): name is InsightHandledToolName {
  return INSIGHT_HANDLED_TOOL_NAMES.includes(name as InsightHandledToolName);
}

export async function handleInsightTool(
  name: string,
  args: Record<string, unknown>,
): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
  if (!isInsightHandledToolName(name)) {
    return {
      isError: true,
      content: [{ type: 'text' as const, text: `Unknown tool: ${name}` }],
    };
  }

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
      // Bound the payload (mirrors get_unresolved_insights) so a large anomaly
      // backlog can't blow the response size; raise `limit` for the full set.
      const bounded = anomalies.slice(0, parsed.data.limit ?? 100);
      return { content: [{ type: 'text' as const, text: JSON.stringify(bounded) }] };
    }

    if (name === 'resolve_insight') {
      const parsed = resolveInsightInputSchema.safeParse(args);
      if (!parsed.success) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: `Validation failed: ${JSON.stringify(parsed.error.issues)}` }],
        };
      }
      const { insightId, status, note } = parsed.data;
      let updated;
      try {
        updated = resolveInsight(insightId, workspaceId, status, note, 'mcp-chat');
      } catch (err) {
        if (err instanceof InvalidTransitionError) {
          return {
            isError: true,
            content: [{ type: 'text' as const, text: `Illegal insight resolution transition: ${err.message}` }],
          };
        }
        throw err;
      }
      if (!updated) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: `Insight not found: ${insightId}` }],
        };
      }
      if (status === 'resolved') recordInsightResolutionOutcome(workspaceId, updated);
      addActivity(
        workspaceId,
        'insight_resolved',
        `Insight ${status}${note ? ': ' + note : ''} via MCP`,
        undefined,
        { source: 'mcp-chat', insightId, status }
      );
      broadcastToWorkspace(workspaceId, WS_EVENTS.INSIGHT_RESOLVED, { insightId, status });
      return { content: [{ type: 'text' as const, text: JSON.stringify(updated) }] };
    }

    if (name === 'bulk_resolve_insights') {
      const parsed = bulkResolveInsightsInputSchema.safeParse(args);
      if (!parsed.success) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: `Validation failed: ${JSON.stringify(parsed.error.issues)}` }],
        };
      }
      const { insightIds, status, note } = parsed.data;
      // `status` may be 'resolved' OR 'in_progress', so the accumulator holds "updated"
      // ids, not strictly "resolved" ones.
      const updatedIds: string[] = [];
      const notFound: string[] = [];
      // Skip-and-report: an illegal transition on ONE insight must never crash the
      // whole batch. Guard rejections are collected per-item and returned alongside
      // notFound so the agent can see which ids were skipped and why.
      const rejected: Array<{ insightId: string; reason: string }> = [];
      for (const insightId of insightIds) {
        let updated;
        try {
          updated = resolveInsight(insightId, workspaceId, status, note, 'mcp-chat');
        } catch (err) {
          if (err instanceof InvalidTransitionError) {
            rejected.push({ insightId, reason: err.message });
            continue;
          }
          throw err;
        }
        if (!updated) { notFound.push(insightId); continue; }
        if (status === 'resolved') recordInsightResolutionOutcome(workspaceId, updated);
        updatedIds.push(insightId);
      }
      // One activity + one broadcast for the batch (only if anything actually changed).
      if (updatedIds.length > 0) {
        addActivity(
          workspaceId,
          'insight_resolved',
          `${updatedIds.length} insight(s) ${status}${note ? ': ' + note : ''} via MCP`,
          undefined,
          { source: 'mcp-chat', insightIds: updatedIds, status }
        );
        broadcastToWorkspace(workspaceId, WS_EVENTS.INSIGHT_RESOLVED, { insightIds: updatedIds, status });
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ updatedCount: updatedIds.length, updated: updatedIds, notFound, rejected }) }],
      };
    }

    const unhandledName: never = name;
    return {
      isError: true,
      content: [{ type: 'text' as const, text: `Unknown tool: ${unhandledName}` }],
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
