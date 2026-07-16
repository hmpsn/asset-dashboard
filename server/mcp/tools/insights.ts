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
import {
  mcpConflictError,
  mcpInternalError,
  mcpNotFoundError,
  mcpValidationError,
  zodErrorToMcp,
} from '../tool-helpers.js';

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
    return mcpNotFoundError('Unknown tool: the requested tool does not exist.', { resource_type: 'tool' });
  }

  const workspaceId = args.workspaceId;
  try {
    if (typeof workspaceId !== 'string') {
      return mcpValidationError('Invalid tool input at workspaceId: Expected a workspace ID.', {
        field_path: 'workspaceId',
        constraint: 'Expected a non-empty workspace ID.',
      });
    }
    const ws = getWorkspace(workspaceId);
    if (!ws) {
      return mcpNotFoundError('Workspace not found.', { resource_type: 'workspace' });
    }

    if (name === 'get_insights') {
      const parsed = getInsightsInputSchema.safeParse(args);
      if (!parsed.success) {
        return zodErrorToMcp(parsed.error);
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
        return zodErrorToMcp(parsed.error);
      }
      const { limit } = parsed.data;
      const items = getUnresolvedInsights(workspaceId).slice(0, limit ?? 100);
      return { content: [{ type: 'text' as const, text: JSON.stringify(items) }] };
    }

    if (name === 'get_anomalies') {
      const parsed = getAnomaliesInputSchema.safeParse(args);
      if (!parsed.success) {
        return zodErrorToMcp(parsed.error);
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
        return zodErrorToMcp(parsed.error);
      }
      const { insightId, status, note } = parsed.data;
      let updated;
      try {
        updated = resolveInsight(insightId, workspaceId, status, note, 'mcp-chat');
      } catch (err) {
        if (err instanceof InvalidTransitionError) {
          return mcpConflictError(
            'The insight cannot move to the requested resolution status. Re-read it before retrying.',
          );
        }
        throw err;
      }
      if (!updated) {
        return mcpNotFoundError('The insight was not found.', { resource_type: 'insight' });
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
        return zodErrorToMcp(parsed.error);
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
            rejected.push({ insightId, reason: 'invalid_transition' });
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

    return mcpNotFoundError('Unknown tool: the requested tool does not exist.', { resource_type: 'tool' });
  } catch (err) {
    log.error({ err, tool: name, workspaceId }, 'MCP tool error');
    return mcpInternalError();
  }
}
