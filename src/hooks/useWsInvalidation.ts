/**
 * Centralized WebSocket → React Query cache invalidation hook.
 *
 * Call this hook once at the top of the admin workspace dashboard so that
 * any real-time WS event from the server automatically invalidates the
 * right query cache entries — no manual invalidation needed in components.
 *
 * Uses useWorkspaceEvents (workspace-scoped subscription) so the server
 * only pushes events for the currently-viewed workspace.
 */

import { useQueryClient } from '@tanstack/react-query';
import { useWorkspaceEvents } from './useWorkspaceEvents';
import { queryKeys } from '../lib/queryKeys';
import { WS_EVENTS } from '../lib/wsEvents';

export function useWsInvalidation(workspaceId: string | undefined) {
  const qc = useQueryClient();

  useWorkspaceEvents(workspaceId, {
    [WS_EVENTS.APPROVAL_UPDATE]: () => {
      if (!workspaceId) return;
      qc.invalidateQueries({ queryKey: queryKeys.client.approvals(workspaceId) });
      qc.invalidateQueries({ queryKey: queryKeys.admin.workspaceHome(workspaceId) });
    },
    [WS_EVENTS.APPROVAL_APPLIED]: () => {
      if (!workspaceId) return;
      qc.invalidateQueries({ queryKey: queryKeys.client.approvals(workspaceId) });
      qc.invalidateQueries({ queryKey: queryKeys.admin.workspaceHome(workspaceId) });
    },
    [WS_EVENTS.REQUEST_CREATED]: () => {
      if (!workspaceId) return;
      qc.invalidateQueries({ queryKey: queryKeys.client.requests(workspaceId) });
      qc.invalidateQueries({ queryKey: queryKeys.admin.requests(workspaceId) });
      qc.invalidateQueries({ queryKey: queryKeys.admin.workspaceHome(workspaceId) });
    },
    [WS_EVENTS.REQUEST_UPDATE]: () => {
      if (!workspaceId) return;
      qc.invalidateQueries({ queryKey: queryKeys.client.requests(workspaceId) });
      qc.invalidateQueries({ queryKey: queryKeys.admin.requests(workspaceId) });
      qc.invalidateQueries({ queryKey: queryKeys.admin.workspaceHome(workspaceId) });
    },
    [WS_EVENTS.CONTENT_REQUEST_CREATED]: () => {
      if (!workspaceId) return;
      qc.invalidateQueries({ queryKey: queryKeys.client.contentRequests(workspaceId) });
      qc.invalidateQueries({ queryKey: queryKeys.admin.workspaceHome(workspaceId) });
    },
    [WS_EVENTS.CONTENT_REQUEST_UPDATE]: () => {
      if (!workspaceId) return;
      qc.invalidateQueries({ queryKey: queryKeys.client.contentRequests(workspaceId) });
      qc.invalidateQueries({ queryKey: queryKeys.admin.workspaceHome(workspaceId) });
    },
    [WS_EVENTS.ACTIVITY_NEW]: () => {
      if (!workspaceId) return;
      qc.invalidateQueries({ queryKey: queryKeys.admin.workspaceHome(workspaceId) });
      qc.invalidateQueries({ queryKey: queryKeys.client.activity(workspaceId) });
    },
    [WS_EVENTS.AUDIT_COMPLETE]: () => {
      if (!workspaceId) return;
      qc.invalidateQueries({ queryKey: queryKeys.shared.auditSummary(workspaceId) });
      qc.invalidateQueries({ queryKey: queryKeys.client.auditSummary(workspaceId) });
      qc.invalidateQueries({ queryKey: queryKeys.admin.workspaceHome(workspaceId) });
    },
    [WS_EVENTS.ANOMALIES_UPDATE]: () => {
      if (!workspaceId) return;
      qc.invalidateQueries({ queryKey: queryKeys.admin.anomalyAlerts(workspaceId) });
      qc.invalidateQueries({ queryKey: queryKeys.client.anomalies(workspaceId) });
    },
    [WS_EVENTS.WORKSPACE_UPDATED]: () => {
      if (!workspaceId) return;
      qc.invalidateQueries({ queryKey: queryKeys.admin.workspaceHome(workspaceId) });
    },
    [WS_EVENTS.CONTENT_PUBLISHED]: () => {
      if (!workspaceId) return;
      qc.invalidateQueries({ queryKey: queryKeys.admin.posts(workspaceId) });
      qc.invalidateQueries({ queryKey: queryKeys.admin.workspaceHome(workspaceId) });
    },
    [WS_EVENTS.WORK_ORDER_UPDATE]: () => {
      if (!workspaceId) return;
      qc.invalidateQueries({ queryKey: queryKeys.admin.workspaceHome(workspaceId) });
    },
    [WS_EVENTS.INSIGHT_RESOLVED]: () => {
      if (!workspaceId) return;
      qc.invalidateQueries({ queryKey: queryKeys.admin.actionQueue(workspaceId) });
      qc.invalidateQueries({ queryKey: queryKeys.client.clientInsights(workspaceId) });
    },
    [WS_EVENTS.INTELLIGENCE_SIGNALS_UPDATED]: () => {
      if (!workspaceId) return;
      qc.invalidateQueries({ queryKey: queryKeys.admin.intelligenceSignals(workspaceId) });
      qc.invalidateQueries({ queryKey: queryKeys.admin.aiSuggestedBriefs(workspaceId) });
    },
    [WS_EVENTS.OUTCOME_ACTION_RECORDED]: () => {
      if (!workspaceId) return;
      qc.invalidateQueries({ queryKey: queryKeys.admin.outcomeActions(workspaceId) });
      qc.invalidateQueries({ queryKey: queryKeys.admin.outcomeScorecard(workspaceId) });
    },
    [WS_EVENTS.OUTCOME_SCORED]: () => {
      if (!workspaceId) return;
      qc.invalidateQueries({ queryKey: queryKeys.admin.outcomeActions(workspaceId) });
      qc.invalidateQueries({ queryKey: queryKeys.admin.outcomeScorecard(workspaceId) });
      qc.invalidateQueries({ queryKey: queryKeys.admin.outcomeTimeline(workspaceId) });
      qc.invalidateQueries({ queryKey: queryKeys.admin.outcomeTopWins(workspaceId) });
      qc.invalidateQueries({ queryKey: queryKeys.client.outcomeSummary(workspaceId) });
      qc.invalidateQueries({ queryKey: queryKeys.client.outcomeWins(workspaceId) });
    },
    [WS_EVENTS.OUTCOME_EXTERNAL_DETECTED]: () => {
      if (!workspaceId) return;
      qc.invalidateQueries({ queryKey: queryKeys.admin.outcomeActions(workspaceId) });
      qc.invalidateQueries({ queryKey: queryKeys.client.outcomeWins(workspaceId) });
    },
    [WS_EVENTS.OUTCOME_LEARNINGS_UPDATED]: () => {
      if (!workspaceId) return;
      qc.invalidateQueries({ queryKey: queryKeys.admin.outcomeLearnings(workspaceId) });
    },
    [WS_EVENTS.OUTCOME_PLAYBOOK_DISCOVERED]: () => {
      if (!workspaceId) return;
      qc.invalidateQueries({ queryKey: queryKeys.admin.outcomePlaybooks(workspaceId) });
    },
    [WS_EVENTS.SUGGESTED_BRIEF_UPDATED]: () => {
      if (!workspaceId) return;
      qc.invalidateQueries({ queryKey: queryKeys.admin.aiSuggestedBriefs(workspaceId) });
    },
    [WS_EVENTS.INSIGHT_BRIDGE_UPDATED]: () => {
      if (!workspaceId) return;
      qc.invalidateQueries({ queryKey: queryKeys.admin.actionQueue(workspaceId) });
      qc.invalidateQueries({ queryKey: queryKeys.admin.intelligenceAll(workspaceId) });
      qc.invalidateQueries({ queryKey: queryKeys.client.clientInsights(workspaceId) });
    },
    [WS_EVENTS.ANNOTATION_BRIDGE_CREATED]: () => {
      if (!workspaceId) return;
      qc.invalidateQueries({ queryKey: queryKeys.admin.analyticsAnnotations(workspaceId) });
      qc.invalidateQueries({ queryKey: queryKeys.client.annotations(workspaceId) });
    },
    [WS_EVENTS.INTELLIGENCE_CACHE_UPDATED]: () => {
      if (!workspaceId) return;
      qc.invalidateQueries({ queryKey: queryKeys.admin.intelligence(workspaceId) });
      qc.invalidateQueries({ queryKey: queryKeys.admin.intelligenceAll(workspaceId) });
    },
    [WS_EVENTS.CLIENT_SIGNAL_CREATED]: () => {
      if (!workspaceId) return;
      qc.invalidateQueries({ queryKey: queryKeys.admin.clientSignals(workspaceId) });
      // Also refresh the notification bell — signals.new count lives in workspace overview
      qc.invalidateQueries({ queryKey: queryKeys.admin.notifications() });
    },
    [WS_EVENTS.CLIENT_SIGNAL_UPDATED]: () => {
      if (!workspaceId) return;
      qc.invalidateQueries({ queryKey: queryKeys.admin.clientSignals(workspaceId) });
      qc.invalidateQueries({ queryKey: queryKeys.admin.notifications() });
    },
    [WS_EVENTS.MEETING_BRIEF_GENERATED]: () => {
      if (!workspaceId) return;
      qc.invalidateQueries({ queryKey: queryKeys.admin.meetingBrief(workspaceId) });
    },
    [WS_EVENTS.COPY_SECTION_UPDATED]: () => {
      if (!workspaceId) return;
      qc.invalidateQueries({ queryKey: queryKeys.admin.copySectionsAll(workspaceId) });
      qc.invalidateQueries({ queryKey: queryKeys.admin.copyStatusAll(workspaceId) });
    },
    [WS_EVENTS.COPY_METADATA_UPDATED]: () => {
      if (!workspaceId) return;
      qc.invalidateQueries({ queryKey: queryKeys.admin.copyMetadataAll(workspaceId) });
    },
    [WS_EVENTS.COPY_BATCH_PROGRESS]: () => {
      if (!workspaceId) return;
      qc.invalidateQueries({ queryKey: queryKeys.admin.copyBatchAll(workspaceId) });
    },
    [WS_EVENTS.COPY_BATCH_COMPLETE]: () => {
      if (!workspaceId) return;
      qc.invalidateQueries({ queryKey: queryKeys.admin.copyBatchAll(workspaceId) });
      qc.invalidateQueries({ queryKey: queryKeys.admin.copySectionsAll(workspaceId) });
      qc.invalidateQueries({ queryKey: queryKeys.admin.copyStatusAll(workspaceId) });
    },
    [WS_EVENTS.COPY_INTELLIGENCE_UPDATED]: () => {
      if (!workspaceId) return;
      qc.invalidateQueries({ queryKey: queryKeys.admin.copyIntelligence(workspaceId) });
      qc.invalidateQueries({ queryKey: queryKeys.admin.copyPromotable(workspaceId) });
    },
    [WS_EVENTS.DIAGNOSTIC_COMPLETE]: () => {
      if (!workspaceId) return;
      qc.invalidateQueries({ queryKey: queryKeys.admin.diagnosticForInsightAll(workspaceId) });
      qc.invalidateQueries({ queryKey: queryKeys.admin.diagnostics(workspaceId) });
      // BUG FIX: prior code invalidated ['admin-insights', workspaceId] which matches no
      // registered query. The real insight feed key is queryKeys.admin.insightFeed(),
      // so diagnostic completion now correctly refreshes the feed.
      qc.invalidateQueries({ queryKey: queryKeys.admin.insightFeed(workspaceId) });
    },
    [WS_EVENTS.DIAGNOSTIC_FAILED]: () => {
      if (!workspaceId) return;
      qc.invalidateQueries({ queryKey: queryKeys.admin.diagnosticForInsightAll(workspaceId) });
      qc.invalidateQueries({ queryKey: queryKeys.admin.diagnostics(workspaceId) });
    },
  });
}
