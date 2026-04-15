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

  // Insights / action queue
  INSIGHT_RESOLVED: 'insight:resolved',

  // Intelligence signals (keyword strategy + content pipeline)
  INTELLIGENCE_SIGNALS_UPDATED: 'intelligence:signals_updated',

  // Schema
  SCHEMA_PLAN_SENT: 'schema:plan_sent',

  // Outcome tracking
  OUTCOME_ACTION_RECORDED: 'outcome:action_recorded',
  OUTCOME_SCORED: 'outcome:scored',
  OUTCOME_EXTERNAL_DETECTED: 'outcome:external',
  OUTCOME_LEARNINGS_UPDATED: 'outcome:learnings_updated',
  OUTCOME_PLAYBOOK_DISCOVERED: 'outcome:playbook',

  // Intelligence layer cache
  INTELLIGENCE_CACHE_UPDATED: 'intelligence:cache_updated',

  // Bridge events (Phase 2B — event propagation between subsystems)
  SUGGESTED_BRIEF_UPDATED: 'suggested-brief:updated',
  INSIGHT_BRIDGE_UPDATED: 'insight:bridge_updated',
  ANNOTATION_BRIDGE_CREATED: 'annotation:bridge_created',
  // Client signals (PIE Group 1)
  CLIENT_SIGNAL_CREATED: 'client-signal:created',
  CLIENT_SIGNAL_UPDATED: 'client-signal:updated',

  // Meeting Brief
  MEETING_BRIEF_GENERATED: 'meeting-brief:generated',

  // Brand Engine (Phase 1 — brandscript, discovery, voice, identity)
  BRANDSCRIPT_UPDATED: 'brandscript:updated',
  DISCOVERY_UPDATED: 'discovery:updated',
  VOICE_PROFILE_UPDATED: 'voice:updated',
  BRAND_IDENTITY_UPDATED: 'brand-identity:updated',

  // Page Strategy (Phase 2 — blueprints)
  // BLUEPRINT_UPDATED covers create, update, and delete (same consolidation pattern as BRANDSCRIPT_UPDATED).
  // Use a { deleted: true } payload flag to distinguish deletion broadcasts.
  BLUEPRINT_UPDATED: 'blueprint:updated',
  BLUEPRINT_GENERATED: 'blueprint:generated',

  // Copy Pipeline (Phase 3 — copy generation, review, export, intelligence)
  COPY_SECTION_UPDATED: 'copy:section_updated',
  COPY_METADATA_UPDATED: 'copy:metadata_updated',
  COPY_BATCH_PROGRESS: 'copy:batch_progress',
  COPY_BATCH_COMPLETE: 'copy:batch_complete',
  COPY_INTELLIGENCE_UPDATED: 'copy:intelligence_updated',
  COPY_EXPORT_COMPLETE: 'copy:export_complete',

  // Deep Diagnostics
  DIAGNOSTIC_COMPLETE: 'diagnostic:complete',
  DIAGNOSTIC_FAILED: 'diagnostic:failed',

  // Bulk SEO operations (background job progress)
  BULK_OPERATION_PROGRESS: 'bulk-operation:progress',
  BULK_OPERATION_COMPLETE: 'bulk-operation:complete',
  BULK_OPERATION_FAILED: 'bulk-operation:failed',
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
