/**
 * WebSocket Event Constants — Frontend Mirror
 *
 * Mirrors server/ws-events.ts so frontend code can use typed constants
 * instead of string literals when subscribing to WebSocket events.
 *
 * Keep in sync with server/ws-events.ts — any event added on the server
 * should be added here too.
 */

// --- Workspace-scoped events (sent via broadcastToWorkspace) ---
export const WS_EVENTS = {
  WORKSPACE_UPDATED: 'workspace:updated',
  APPROVAL_UPDATE: 'approval:update',
  APPROVAL_APPLIED: 'approval:applied',
  REQUEST_CREATED: 'request:created',
  REQUEST_UPDATE: 'request:update',
  CONTENT_REQUEST_CREATED: 'content-request:created',
  CONTENT_REQUEST_UPDATE: 'content-request:update',
  ACTIVITY_NEW: 'activity:new',
  AUDIT_COMPLETE: 'audit:complete',
  WORK_ORDER_UPDATE: 'work-order:update',
  ANOMALIES_UPDATE: 'anomalies:update',
  CONTENT_PUBLISHED: 'content:published',
  INSIGHT_RESOLVED: 'insight:resolved',
  INTELLIGENCE_SIGNALS_UPDATED: 'intelligence:signals_updated',
  SCHEMA_PLAN_SENT: 'schema:plan_sent',
  OUTCOME_ACTION_RECORDED: 'outcome:action_recorded',
  OUTCOME_SCORED: 'outcome:scored',
  OUTCOME_EXTERNAL_DETECTED: 'outcome:external',
  OUTCOME_LEARNINGS_UPDATED: 'outcome:learnings_updated',
  OUTCOME_PLAYBOOK_DISCOVERED: 'outcome:playbook',
  SUGGESTED_BRIEF_UPDATED: 'suggested-brief:updated',
  INSIGHT_BRIDGE_UPDATED: 'insight:bridge_updated',
  ANNOTATION_BRIDGE_CREATED: 'annotation:bridge_created',
  INTELLIGENCE_CACHE_UPDATED: 'intelligence:cache_updated',
  MEETING_BRIEF_GENERATED: 'meeting-brief:generated',
} as const;

export type WsEventName = typeof WS_EVENTS[keyof typeof WS_EVENTS];

// --- Admin-global events (broadcast to all admin connections) ---
export const ADMIN_EVENTS = {
  WORKSPACE_CREATED: 'workspace:created',
  WORKSPACE_UPDATED: 'workspace:updated',
  WORKSPACE_DELETED: 'workspace:deleted',
  FILES_UPLOADED: 'files:uploaded',
  REQUEST_CREATED: 'request:created',
  REQUEST_UPDATED: 'request:updated',
  REQUEST_DELETED: 'request:deleted',
  REQUEST_BATCH_CREATED: 'request:batch_created',
  REQUEST_BULK_UPDATED: 'request:bulk_updated',
  QUEUE_UPDATE: 'queue:update',
} as const;

export type AdminEventName = typeof ADMIN_EVENTS[keyof typeof ADMIN_EVENTS];
