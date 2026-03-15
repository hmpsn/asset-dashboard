/**
 * WebSocket Event Constants
 *
 * Single source of truth for all real-time event names used across the platform.
 * Import these constants instead of using string literals to prevent typos and
 * ensure consistency between server broadcasts and frontend handlers.
 *
 * RULE: Every new feature that writes data visible to both admin and client
 * MUST define its events here and use broadcastToWorkspace() on BOTH sides.
 */

// --- Workspace-scoped events (broadcastToWorkspace) ---

export const WS_EVENTS = {
  // Workspace settings / tier changes
  WORKSPACE_UPDATED: 'workspace:updated',

  // Approvals
  APPROVAL_UPDATE: 'approval:update',
  APPROVAL_APPLIED: 'approval:applied',

  // Requests
  REQUEST_CREATED: 'request:created',
  REQUEST_UPDATE: 'request:update',

  // Content requests
  CONTENT_REQUEST_CREATED: 'content-request:created',
  CONTENT_REQUEST_UPDATE: 'content-request:update',

  // Activity feed (auto-broadcast via initActivityBroadcast)
  ACTIVITY_NEW: 'activity:new',

  // Audit
  AUDIT_COMPLETE: 'audit:complete',

  // Work orders
  WORK_ORDER_UPDATE: 'work-order:update',

  // Anomalies (auto-broadcast via initAnomalyBroadcast)
  ANOMALIES_UPDATE: 'anomalies:update',

  // Content publishing
  CONTENT_PUBLISHED: 'content:published',
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
} as const;

export type AdminEventName = typeof ADMIN_EVENTS[keyof typeof ADMIN_EVENTS];
