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
import { WS_EVENTS } from '../lib/wsEvents';
import { invalidateWorkspaceEventQueries } from '../lib/wsInvalidation';

export function useWsInvalidation(workspaceId: string | undefined) {
  const qc = useQueryClient();
  const invalidateRegistry = (eventName: typeof WS_EVENTS[keyof typeof WS_EVENTS], data?: unknown) => {
    invalidateWorkspaceEventQueries(qc, eventName, workspaceId, data, 'admin');
  };

  useWorkspaceEvents(workspaceId, {
    [WS_EVENTS.APPROVAL_UPDATE]: () => invalidateRegistry(WS_EVENTS.APPROVAL_UPDATE),
    [WS_EVENTS.APPROVAL_APPLIED]: () => invalidateRegistry(WS_EVENTS.APPROVAL_APPLIED),
    [WS_EVENTS.REQUEST_CREATED]: () => invalidateRegistry(WS_EVENTS.REQUEST_CREATED),
    [WS_EVENTS.REQUEST_UPDATE]: () => invalidateRegistry(WS_EVENTS.REQUEST_UPDATE),
    [WS_EVENTS.CONTENT_REQUEST_CREATED]: () => invalidateRegistry(WS_EVENTS.CONTENT_REQUEST_CREATED),
    [WS_EVENTS.CONTENT_REQUEST_UPDATE]: () => invalidateRegistry(WS_EVENTS.CONTENT_REQUEST_UPDATE),
    [WS_EVENTS.BRIEF_UPDATED]: () => invalidateRegistry(WS_EVENTS.BRIEF_UPDATED),
    [WS_EVENTS.CONTENT_UPDATED]: () => invalidateRegistry(WS_EVENTS.CONTENT_UPDATED),
    [WS_EVENTS.ACTIVITY_NEW]: () => invalidateRegistry(WS_EVENTS.ACTIVITY_NEW),
    [WS_EVENTS.AUDIT_COMPLETE]: () => invalidateRegistry(WS_EVENTS.AUDIT_COMPLETE),
    [WS_EVENTS.ANOMALIES_UPDATE]: () => invalidateRegistry(WS_EVENTS.ANOMALIES_UPDATE),
    [WS_EVENTS.WORKSPACE_UPDATED]: () => invalidateRegistry(WS_EVENTS.WORKSPACE_UPDATED),
    [WS_EVENTS.PAGE_STATE_UPDATED]: () => invalidateRegistry(WS_EVENTS.PAGE_STATE_UPDATED),
    [WS_EVENTS.CONTENT_PUBLISHED]: () => invalidateRegistry(WS_EVENTS.CONTENT_PUBLISHED),
    [WS_EVENTS.CONTENT_SUBSCRIPTION_CREATED]: () => invalidateRegistry(WS_EVENTS.CONTENT_SUBSCRIPTION_CREATED),
    [WS_EVENTS.CONTENT_SUBSCRIPTION_UPDATED]: () => invalidateRegistry(WS_EVENTS.CONTENT_SUBSCRIPTION_UPDATED),
    [WS_EVENTS.CONTENT_SUBSCRIPTION_RENEWED]: () => invalidateRegistry(WS_EVENTS.CONTENT_SUBSCRIPTION_RENEWED),
    [WS_EVENTS.DELIVERABLE_SENT]: () => invalidateRegistry(WS_EVENTS.DELIVERABLE_SENT),
    [WS_EVENTS.DELIVERABLE_UPDATED]: () => invalidateRegistry(WS_EVENTS.DELIVERABLE_UPDATED),
    [WS_EVENTS.WORK_ORDER_UPDATE]: () => invalidateRegistry(WS_EVENTS.WORK_ORDER_UPDATE),
    [WS_EVENTS.WORK_ORDER_COMMENT]: (data: unknown) => invalidateRegistry(WS_EVENTS.WORK_ORDER_COMMENT, data),
    [WS_EVENTS.INSIGHT_RESOLVED]: () => invalidateRegistry(WS_EVENTS.INSIGHT_RESOLVED),
    [WS_EVENTS.INTELLIGENCE_SIGNALS_UPDATED]: () => invalidateRegistry(WS_EVENTS.INTELLIGENCE_SIGNALS_UPDATED),
    [WS_EVENTS.SCHEMA_CMS_MAPPING_UPDATED]: (data: unknown) =>
      invalidateRegistry(WS_EVENTS.SCHEMA_CMS_MAPPING_UPDATED, data),
    [WS_EVENTS.SCHEMA_PLAN_UPDATED]: (data: unknown) => invalidateRegistry(WS_EVENTS.SCHEMA_PLAN_UPDATED, data),
    [WS_EVENTS.SCHEMA_SNAPSHOT_UPDATED]: (data: unknown) =>
      invalidateRegistry(WS_EVENTS.SCHEMA_SNAPSHOT_UPDATED, data),
    [WS_EVENTS.OUTCOME_ACTION_RECORDED]: () => invalidateRegistry(WS_EVENTS.OUTCOME_ACTION_RECORDED),
    [WS_EVENTS.OUTCOME_SCORED]: () => invalidateRegistry(WS_EVENTS.OUTCOME_SCORED),
    [WS_EVENTS.OUTCOME_EXTERNAL_DETECTED]: () => invalidateRegistry(WS_EVENTS.OUTCOME_EXTERNAL_DETECTED),
    [WS_EVENTS.OUTCOME_LEARNINGS_UPDATED]: () => invalidateRegistry(WS_EVENTS.OUTCOME_LEARNINGS_UPDATED),
    [WS_EVENTS.OUTCOME_PLAYBOOK_DISCOVERED]: () => invalidateRegistry(WS_EVENTS.OUTCOME_PLAYBOOK_DISCOVERED),
    [WS_EVENTS.SUGGESTED_BRIEF_UPDATED]: () => invalidateRegistry(WS_EVENTS.SUGGESTED_BRIEF_UPDATED),
    [WS_EVENTS.INSIGHT_BRIDGE_UPDATED]: () => invalidateRegistry(WS_EVENTS.INSIGHT_BRIDGE_UPDATED),
    [WS_EVENTS.ANNOTATION_BRIDGE_CREATED]: () => invalidateRegistry(WS_EVENTS.ANNOTATION_BRIDGE_CREATED),
    [WS_EVENTS.INTELLIGENCE_CACHE_UPDATED]: () => invalidateRegistry(WS_EVENTS.INTELLIGENCE_CACHE_UPDATED),
    [WS_EVENTS.CLIENT_SIGNAL_CREATED]: () => invalidateRegistry(WS_EVENTS.CLIENT_SIGNAL_CREATED),
    [WS_EVENTS.CLIENT_SIGNAL_UPDATED]: () => invalidateRegistry(WS_EVENTS.CLIENT_SIGNAL_UPDATED),
    [WS_EVENTS.CLIENT_ACTION_UPDATE]: () => invalidateRegistry(WS_EVENTS.CLIENT_ACTION_UPDATE),
    [WS_EVENTS.MEETING_BRIEF_GENERATED]: () => invalidateRegistry(WS_EVENTS.MEETING_BRIEF_GENERATED),
    [WS_EVENTS.COPY_SECTION_UPDATED]: () => invalidateRegistry(WS_EVENTS.COPY_SECTION_UPDATED),
    [WS_EVENTS.COPY_METADATA_UPDATED]: () => invalidateRegistry(WS_EVENTS.COPY_METADATA_UPDATED),
    [WS_EVENTS.COPY_BATCH_PROGRESS]: () => invalidateRegistry(WS_EVENTS.COPY_BATCH_PROGRESS),
    [WS_EVENTS.COPY_BATCH_COMPLETE]: () => invalidateRegistry(WS_EVENTS.COPY_BATCH_COMPLETE),
    [WS_EVENTS.COPY_INTELLIGENCE_UPDATED]: () => invalidateRegistry(WS_EVENTS.COPY_INTELLIGENCE_UPDATED),
    [WS_EVENTS.DIAGNOSTIC_COMPLETE]: () => invalidateRegistry(WS_EVENTS.DIAGNOSTIC_COMPLETE),
    [WS_EVENTS.DIAGNOSTIC_FAILED]: () => invalidateRegistry(WS_EVENTS.DIAGNOSTIC_FAILED),
    [WS_EVENTS.BULK_OPERATION_COMPLETE]: (data: unknown) =>
      invalidateRegistry(WS_EVENTS.BULK_OPERATION_COMPLETE, data),
    [WS_EVENTS.RECOMMENDATIONS_UPDATED]: () => invalidateRegistry(WS_EVENTS.RECOMMENDATIONS_UPDATED),
    [WS_EVENTS.RECOMMENDATIONS_DISCUSSION_UPDATED]: () => invalidateRegistry(WS_EVENTS.RECOMMENDATIONS_DISCUSSION_UPDATED),
    [WS_EVENTS.STRATEGY_UPDATED]: () => invalidateRegistry(WS_EVENTS.STRATEGY_UPDATED),
    [WS_EVENTS.RANK_TRACKING_UPDATED]: () => invalidateRegistry(WS_EVENTS.RANK_TRACKING_UPDATED),
    [WS_EVENTS.LOCAL_SEO_UPDATED]: () => invalidateRegistry(WS_EVENTS.LOCAL_SEO_UPDATED),
    [WS_EVENTS.EEAT_ASSETS_UPDATED]: () => invalidateRegistry(WS_EVENTS.EEAT_ASSETS_UPDATED),
    [WS_EVENTS.BRANDSCRIPT_UPDATED]: () => invalidateRegistry(WS_EVENTS.BRANDSCRIPT_UPDATED),
    [WS_EVENTS.DISCOVERY_UPDATED]: () => invalidateRegistry(WS_EVENTS.DISCOVERY_UPDATED),
    [WS_EVENTS.VOICE_PROFILE_UPDATED]: () => invalidateRegistry(WS_EVENTS.VOICE_PROFILE_UPDATED),
    [WS_EVENTS.BRAND_IDENTITY_UPDATED]: () => invalidateRegistry(WS_EVENTS.BRAND_IDENTITY_UPDATED),
    [WS_EVENTS.BLUEPRINT_UPDATED]: () => invalidateRegistry(WS_EVENTS.BLUEPRINT_UPDATED),
    [WS_EVENTS.BLUEPRINT_GENERATED]: () => invalidateRegistry(WS_EVENTS.BLUEPRINT_GENERATED),
    [WS_EVENTS.COPY_EXPORT_COMPLETE]: () => invalidateRegistry(WS_EVENTS.COPY_EXPORT_COMPLETE),
    [WS_EVENTS.POST_UPDATED]: (data: unknown) => invalidateRegistry(WS_EVENTS.POST_UPDATED, data),
    [WS_EVENTS.BRIEFING_GENERATED]: () => invalidateRegistry(WS_EVENTS.BRIEFING_GENERATED),
    [WS_EVENTS.BRIEFING_PUBLISHED]: () => invalidateRegistry(WS_EVENTS.BRIEFING_PUBLISHED),
  });
}
