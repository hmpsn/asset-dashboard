import type { Tool } from '@modelcontextprotocol/sdk/types';
import {
  applyRecommendationInputSchema,
  listRecommendationsInputSchema,
} from '../../../shared/types/mcp-action-schemas.js';
import type { Recommendation } from '../../../shared/types/recommendations.js';
import { addActivity } from '../../activity-log.js';
import { broadcastToWorkspace } from '../../broadcast.js';
import { isActiveRec, loadRecommendations } from '../../recommendations.js';
import {
  sendRecommendation,
  strikeRecommendation,
  throttleRecommendation,
} from '../../recommendation-lifecycle.js';
import { InvalidTransitionError } from '../../state-machines.js';
import { invalidateIntelligenceCache } from '../../intelligence/cache-invalidation.js';
import { createLogger } from '../../logger.js';
import { WS_EVENTS } from '../../ws-events.js';
import { toMcpJsonSchema } from '../json-schema.js';
import {
  buildDashboardUrl,
  mcpError,
  mcpSuccess,
  requireWorkspace,
  zodErrorToMcp,
  type McpToolErrorResponse,
  type McpToolSuccessResponse,
} from '../tool-helpers.js';

const log = createLogger('mcp-tools-recommendation-actions');

export const recommendationActionTools: Tool[] = [
  {
    name: 'list_recommendations',
    description:
      "List a workspace's recommendations. Defaults to the ACTIVE set (the live, surfaceable recs — not completed/dismissed/struck/throttled and not already sent to the client) so an agent sees exactly what the operator would act on; pass filter:'all' for the full set including curated/sent/struck history. Read-only.",
    inputSchema: toMcpJsonSchema(listRecommendationsInputSchema),
  },
  {
    name: 'apply_recommendation',
    description:
      "Apply a curation lifecycle action to a single recommendation: 'send' (deliver the curated rec to the client), 'throttle' (hide it for 7/30/90 days — requires throttle_days), or 'strike' (permanently suppress it). These map 1:1 to the operator cockpit's single-writer lifecycle actions and NEVER touch the internal admin triage status. An illegal transition (e.g. sending an already-sent rec) is surfaced as an error.",
    inputSchema: toMcpJsonSchema(applyRecommendationInputSchema),
  },
];

function recToSummary(rec: Recommendation): Record<string, unknown> {
  return {
    recommendation_id: rec.id,
    title: rec.title,
    type: rec.type,
    priority: rec.priority,
    impact: rec.impact,
    effort: rec.effort,
    impact_score: rec.impactScore,
    status: rec.status,
    client_status: rec.clientStatus ?? null,
    lifecycle: rec.lifecycle ?? 'active',
    affected_pages: rec.affectedPages,
    estimated_gain: rec.estimatedGain,
    target_keyword: rec.targetKeyword ?? null,
  };
}

async function handleListRecommendations(
  args: Record<string, unknown>,
): Promise<McpToolSuccessResponse | McpToolErrorResponse> {
  const parsed = listRecommendationsInputSchema.safeParse(args);
  if (!parsed.success) return zodErrorToMcp(parsed.error);
  const { workspace_id: workspaceId, filter } = parsed.data;
  const workspace = requireWorkspace(workspaceId);
  if ('isError' in workspace) return workspace;

  const set = loadRecommendations(workspaceId);
  const all = set?.recommendations ?? [];
  // Default to the active set (isActiveRec — the single active-set predicate every reader
  // uses); pass filter:'all' for the full history including sent/struck/throttled recs.
  const rows = (filter === 'all' ? all : all.filter((rec) => isActiveRec(rec))).map(recToSummary);

  return mcpSuccess({
    recommendations: rows,
    filter: filter ?? 'active',
    generated_at: set?.generatedAt ?? null,
    dashboard_url: buildDashboardUrl(workspaceId, 'strategy'),
  });
}

async function handleApplyRecommendation(
  args: Record<string, unknown>,
): Promise<McpToolSuccessResponse | McpToolErrorResponse> {
  const parsed = applyRecommendationInputSchema.safeParse(args);
  if (!parsed.success) return zodErrorToMcp(parsed.error);
  const {
    workspace_id: workspaceId,
    recommendation_id: recId,
    action,
    throttle_days: throttleDays,
  } = parsed.data;
  const workspace = requireWorkspace(workspaceId);
  if ('isError' in workspace) return workspace;

  if (action === 'throttle' && throttleDays === undefined) {
    return mcpError("throttle_days is required when action is 'throttle' (must be 7, 30, or 90).");
  }

  // Dispatch to the single-writer lifecycle fn. These mutate ONLY the client-facing curation /
  // suppression axes (clientStatus / lifecycle) inside a txn — they NEVER write RecStatus, and
  // they do NOT broadcast or log internally (the route handler owns that, so this tool does too).
  // They throw InvalidTransitionError on an illegal edge (e.g. sending an already-sent rec) and
  // return null when the rec id is absent.
  let rec: Recommendation | null;
  try {
    if (action === 'send') {
      rec = sendRecommendation(workspaceId, recId);
    } else if (action === 'throttle') {
      rec = throttleRecommendation(workspaceId, recId, throttleDays as 7 | 30 | 90);
    } else {
      rec = strikeRecommendation(workspaceId, recId);
    }
  } catch (err) {
    if (err instanceof InvalidTransitionError) {
      return mcpError(`Cannot ${action} recommendation: ${err.message}`);
    }
    log.error({ err, workspaceId, recId, action }, 'apply_recommendation lifecycle call failed');
    const message = err instanceof Error ? err.message : String(err);
    return mcpError(`Failed to ${action} recommendation: ${message}`);
  }

  if (!rec) return mcpError(`Recommendation not found: ${recId}`);

  // Own the broadcast + activity (the lifecycle fns don't fire them — parity with the route
  // handlers in server/routes/recommendations.ts). Match the route's payload + activity types.
  invalidateIntelligenceCache(workspaceId);
  if (action === 'send') {
    broadcastToWorkspace(workspaceId, WS_EVENTS.RECOMMENDATIONS_UPDATED, { recId, clientStatus: 'sent' });
    addActivity(
      workspaceId,
      'rec_sent',
      `Recommendation sent to client: ${rec.title}`,
      rec.description,
      { source: 'mcp-chat', recId, action: 'mcp_recommendation_sent' },
    );
  } else if (action === 'throttle') {
    broadcastToWorkspace(workspaceId, WS_EVENTS.RECOMMENDATIONS_UPDATED, { recId, lifecycle: 'throttled' });
    addActivity(
      workspaceId,
      'rec_throttled',
      `Recommendation throttled ${throttleDays}d: ${rec.title}`,
      rec.description,
      { source: 'mcp-chat', recId, action: 'mcp_recommendation_throttled', throttleDays },
    );
  } else {
    broadcastToWorkspace(workspaceId, WS_EVENTS.RECOMMENDATIONS_UPDATED, { recId, lifecycle: 'struck' });
    addActivity(
      workspaceId,
      'rec_struck',
      `Recommendation struck: ${rec.title}`,
      rec.description,
      { source: 'mcp-chat', recId, action: 'mcp_recommendation_struck' },
    );
  }

  return mcpSuccess({
    ok: true,
    action,
    recommendation: recToSummary(rec),
    dashboard_url: buildDashboardUrl(workspaceId, 'strategy'),
  });
}

export async function handleRecommendationActionTool(
  name: string,
  args: Record<string, unknown>,
): Promise<McpToolSuccessResponse | McpToolErrorResponse> {
  if (name === 'list_recommendations') return handleListRecommendations(args);
  if (name === 'apply_recommendation') return handleApplyRecommendation(args);
  return mcpError(`Unknown recommendation action tool: ${name}`);
}
