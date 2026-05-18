import { getInsights, resolveInsight } from '../../analytics-insights-store.js';
import {
  getActionByWorkspaceAndSource,
  recordAction,
  updateActionContext,
  updateAttribution,
} from '../../outcome-tracking.js';
import { toInsightPageId } from '../../helpers.js';
import { createLogger } from '../../logger.js';
import type { AnalyticsInsight } from '../../../shared/types/analytics.js';
import type { ClientAction, ClientActionOriginMetadata, ClientActionSourceType } from '../../../shared/types/client-actions.js';
import type { ActionType } from '../../../shared/types/outcome-tracking.js';

const log = createLogger('inbox:client-action-feedback-loop');

const OUTCOME_ACTION_TYPE_BY_SOURCE: Record<ClientActionSourceType, ActionType> = {
  aeo_change: 'content_refreshed',
  internal_link: 'internal_link_added',
  redirect_proposal: 'audit_fix_applied',
  content_decay: 'content_refreshed',
};

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === 'string')
    .map(entry => entry.trim())
    .filter(entry => entry.length > 0);
}

function readOriginMetadata(action: ClientAction): ClientActionOriginMetadata {
  const payload = action.payload ?? {};
  const meta = (payload.metadata ?? {}) as { origin?: Record<string, unknown> };
  const origin = meta.origin ?? {};

  const insightIds = asStringArray(origin.insightIds ?? payload.originInsightIds);
  const pageUrl =
    asString(origin.pageUrl)
    ?? asString(payload.pageUrl)
    ?? asString((payload.page as Record<string, unknown> | undefined)?.page);
  const targetKeyword =
    asString(origin.targetKeyword)
    ?? asString(payload.targetKeyword)
    ?? asString((payload.page as Record<string, unknown> | undefined)?.targetKeyword);
  const trackingSourceId =
    asString(origin.trackingSourceId)
    ?? asString((payload.page as Record<string, unknown> | undefined)?.page);

  return {
    ...(insightIds.length > 0 ? { insightIds } : {}),
    ...(pageUrl ? { pageUrl } : {}),
    ...(targetKeyword ? { targetKeyword } : {}),
    ...(trackingSourceId ? { trackingSourceId } : {}),
  };
}

function resolveByExplicitInsightIds(
  workspaceId: string,
  insights: AnalyticsInsight[],
  insightIds: string[],
  status: 'in_progress' | 'resolved',
  action: ClientAction,
): string[] {
  const byId = new Map(insights.map(insight => [insight.id, insight]));
  const resolved: string[] = [];

  for (const insightId of insightIds) {
    const insight = byId.get(insightId);
    if (!insight) continue;
    if (status === 'in_progress' && insight.resolutionStatus === 'resolved') continue;
    if (insight.resolutionStatus === status) continue;
    const updated = resolveInsight(
      insight.id,
      workspaceId,
      status,
      status === 'resolved'
        ? `Auto-resolved from client action completion: ${action.title}`
        : `Auto-progressed from client action approval: ${action.title}`,
      'client_action_feedback_loop',
    );
    if (updated) resolved.push(insight.id);
  }

  return resolved;
}

function findSingleFallbackInsightId(
  insights: AnalyticsInsight[],
  pageUrl: string | undefined,
  targetKeyword: string | undefined,
): string | null {
  const unresolved = insights.filter(insight => insight.resolutionStatus !== 'resolved');
  const pageId = pageUrl ? toInsightPageId(pageUrl) : null;
  const keywordNeedle = targetKeyword ? targetKeyword.toLowerCase() : null;

  const matches = new Set<string>();
  for (const insight of unresolved) {
    if (pageId && insight.pageId === pageId) {
      matches.add(insight.id);
      continue;
    }
    if (!keywordNeedle) continue;
    const insightData = insight.data as Record<string, unknown>;
    const keywordCandidates = [
      insight.strategyKeyword,
      asString(insightData.keyword),
      asString(insightData.query),
    ]
      .filter((entry): entry is string => typeof entry === 'string')
      .map(entry => entry.toLowerCase());
    if (keywordCandidates.includes(keywordNeedle)) {
      matches.add(insight.id);
    }
  }

  if (matches.size !== 1) return null;
  return Array.from(matches)[0] ?? null;
}

function applyInsightResolutionFeedback(
  workspaceId: string,
  action: ClientAction,
  origin: ClientActionOriginMetadata,
  status: 'in_progress' | 'resolved',
): void {
  const insights = getInsights(workspaceId);
  const resolvedById = resolveByExplicitInsightIds(
    workspaceId,
    insights,
    origin.insightIds ?? [],
    status,
    action,
  );
  if (resolvedById.length > 0) return;

  const fallbackInsightId = findSingleFallbackInsightId(
    insights,
    origin.pageUrl,
    origin.targetKeyword,
  );
  if (!fallbackInsightId) return;

  const updated = resolveInsight(
    fallbackInsightId,
    workspaceId,
    status,
    status === 'resolved'
      ? `Auto-resolved from client action completion: ${action.title}`
      : `Auto-progressed from client action approval: ${action.title}`,
    'client_action_feedback_loop',
  );
  if (!updated) return;
}

function applyOutcomeFeedback(
  workspaceId: string,
  action: ClientAction,
  origin: ClientActionOriginMetadata,
): void {
  if (origin.trackingSourceId) {
    const existingSourceAction = getActionByWorkspaceAndSource(
      workspaceId,
      action.sourceType,
      origin.trackingSourceId,
    );
    if (existingSourceAction) {
      if (existingSourceAction.attribution !== 'platform_executed') {
        updateAttribution(existingSourceAction.id, workspaceId, 'platform_executed');
      }
      const nextContext = {
        ...existingSourceAction.context,
        relatedActions: Array.from(new Set([...(existingSourceAction.context.relatedActions ?? []), action.id])),
      };
      updateActionContext(existingSourceAction.id, workspaceId, nextContext);
    }
  }

  const existingLifecycleAction = getActionByWorkspaceAndSource(workspaceId, 'client_action', action.id);
  if (existingLifecycleAction) {
    if (existingLifecycleAction.attribution !== 'platform_executed') {
      updateAttribution(existingLifecycleAction.id, workspaceId, 'platform_executed');
    }
    return;
  }

  recordAction({
    workspaceId,
    actionType: OUTCOME_ACTION_TYPE_BY_SOURCE[action.sourceType],
    sourceType: 'client_action',
    sourceId: action.id,
    pageUrl: origin.pageUrl ?? null,
    targetKeyword: origin.targetKeyword ?? null,
    baselineSnapshot: {
      captured_at: new Date().toISOString(),
    },
    attribution: 'platform_executed',
    context: {
      notes: `Lifecycle action recorded from client action ${action.status}: ${action.title}`,
      relatedActions: [action.id],
    },
  });
}

export function applyClientActionFeedbackLoop(
  workspaceId: string,
  action: ClientAction,
  status: 'approved' | 'completed',
): void {
  try {
    const origin = readOriginMetadata(action);
    const insightStatus = status === 'completed' ? 'resolved' : 'in_progress';

    applyInsightResolutionFeedback(workspaceId, action, origin, insightStatus);
    applyOutcomeFeedback(workspaceId, action, origin);
  } catch (err) {
    log.warn({ err, workspaceId, actionId: action.id, status }, 'client action feedback loop failed');
  }
}
