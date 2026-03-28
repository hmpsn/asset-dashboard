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
  });
}
