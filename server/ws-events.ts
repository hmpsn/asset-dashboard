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
  // Job lifecycle
  JOB_CREATED: 'job:created',
  JOB_UPDATED: 'job:update',

  // Workspace settings / tier changes
  WORKSPACE_UPDATED: 'workspace:updated',
  PAGE_STATE_UPDATED: 'page-state:updated',

  // Billing / content subscriptions
  CONTENT_SUBSCRIPTION_CREATED: 'content-subscription:created',
  CONTENT_SUBSCRIPTION_UPDATED: 'content-subscription:updated',
  CONTENT_SUBSCRIPTION_RENEWED: 'content-subscription:renewed',

  // Approvals
  APPROVAL_UPDATE: 'approval:update',
  APPROVAL_APPLIED: 'approval:applied',

  // Requests
  REQUEST_CREATED: 'request:created',
  REQUEST_UPDATE: 'request:update',

  // Content requests
  CONTENT_REQUEST_CREATED: 'content-request:created',
  CONTENT_REQUEST_UPDATE: 'content-request:update',

  // Content pipeline / planner
  CONTENT_UPDATED: 'content:updated',
  BRIEF_UPDATED: 'brief:updated',

  // Activity feed (auto-broadcast via initActivityBroadcast)
  ACTIVITY_NEW: 'activity:new',

  // Audit
  AUDIT_COMPLETE: 'audit:complete',

  // Work orders
  WORK_ORDER_UPDATE: 'work-order:update',
  WORK_ORDER_COMMENT: 'work-order:comment',

  // Anomalies (auto-broadcast via initAnomalyBroadcast)
  ANOMALIES_UPDATE: 'anomalies:update',

  // Content publishing
  CONTENT_PUBLISHED: 'content:published',
  POST_UPDATED: 'post:updated',

  // Insights / action queue
  INSIGHT_RESOLVED: 'insight:resolved',

  // Intelligence signals (keyword strategy + content pipeline)
  INTELLIGENCE_SIGNALS_UPDATED: 'intelligence:signals_updated',

  // Schema
  SCHEMA_PLAN_UPDATED: 'schema:plan_updated',
  SCHEMA_PLAN_SENT: 'schema:plan_sent',
  SCHEMA_CMS_MAPPING_UPDATED: 'schema:cms_mapping_updated',
  SCHEMA_SNAPSHOT_UPDATED: 'schema:snapshot_updated',

  // Outcome tracking
  OUTCOME_ACTION_RECORDED: 'outcome:action_recorded',
  OUTCOME_SCORED: 'outcome:scored',
  OUTCOME_EXTERNAL_DETECTED: 'outcome:external',
  OUTCOME_LEARNINGS_UPDATED: 'outcome:learnings_updated',
  OUTCOME_PLAYBOOK_DISCOVERED: 'outcome:playbook',
  // The Issue (Client) P1a — Webflow named-lead captured via the forms Data API poller.
  // Broadcast by the conversion-tracking poller on a NEW (non-duplicate) insert; the
  // admin conversion-tracking-status query handler (useConversionTrackingStatus) invalidates so the
  // verification readout's last-lead/connected state refreshes without a poll. PII is never in the
  // payload (D7) — only { workspaceId, outcomeType }.
  FORM_SUBMISSION_CAPTURED: 'outcome:form_captured',
  // The Issue (Client) P1a — operator saved the tracked Webflow form-source mapping. This can flip
  // the measured_action provenance basis before the next poller capture, so admin setup readouts and
  // client ROI/provenance caches refresh immediately.
  FORM_CAPTURE_CONFIG_UPDATED: 'outcome:form_capture_config_updated',

  // Intelligence layer cache
  INTELLIGENCE_CACHE_UPDATED: 'intelligence:cache_updated',

  // Bridge events (Phase 2B — event propagation between subsystems)
  SUGGESTED_BRIEF_UPDATED: 'suggested-brief:updated',
  INSIGHT_BRIDGE_UPDATED: 'insight:bridge_updated',
  ANNOTATION_BRIDGE_CREATED: 'annotation:bridge_created',
  // Client signals (PIE Group 1)
  CLIENT_SIGNAL_CREATED: 'client-signal:created',
  CLIENT_SIGNAL_UPDATED: 'client-signal:updated',

  // Client action queue
  CLIENT_ACTION_UPDATE: 'client-action:update',

  // Unified Send-to-Client deliverables (Phase 0, dark until the unified-deliverables-* flags flip)
  DELIVERABLE_SENT: 'deliverable:sent',
  DELIVERABLE_UPDATED: 'deliverable:updated',

  // Meeting Brief
  MEETING_BRIEF_GENERATED: 'meeting-brief:generated',

  // The Issue — strategy POV (Lane B). Broadcast on generate/regenerate and on every operator
  // edit (PATCH bumps the version) so the cockpit's useStrategyPov handler invalidates its cache.
  STRATEGY_POV_GENERATED: 'strategy:pov-generated',

  // The Issue — trust ladder (Phase 4). Broadcast when an operator toggles a per-archetype
  // auto-send policy; handled locally by src/hooks/admin/useAutoSendPolicy.ts via
  // useWorkspaceEvents (invalidates queryKeys.admin.autoSendPolicy).
  STRATEGY_AUTOSEND_POLICY_UPDATED: 'strategy:autosend-policy-updated',

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

  // Client Briefing (weekly editorial)
  BRIEFING_GENERATED: 'briefing:generated',
  BRIEFING_PUBLISHED: 'briefing:published',

  // Deep Diagnostics
  DIAGNOSTIC_COMPLETE: 'diagnostic:complete',
  DIAGNOSTIC_FAILED: 'diagnostic:failed',

  // Bulk SEO operations (background job progress)
  BULK_OPERATION_PROGRESS: 'bulk-operation:progress',
  BULK_OPERATION_COMPLETE: 'bulk-operation:complete',
  BULK_OPERATION_FAILED: 'bulk-operation:failed',

  // Recommendations
  RECOMMENDATIONS_UPDATED: 'recommendations:updated',
  RECOMMENDATIONS_DISCUSSION_UPDATED: 'recommendations:discussion_updated',

  // Keyword Strategy
  STRATEGY_UPDATED: 'strategy:updated',
  // Strategy redesign P2 pre-commit (consumed in P3) — broadcast on every managed
  // keyword working-set mutation (add/remove/keep/reconcile). Hyphen-in-segment form is
  // canonical (execution-map §1.4), matching the STRATEGY_SIGNAL_FOLD_UPDATED sibling.
  STRATEGY_KEYWORD_SET_UPDATED: 'strategy:keyword-set-updated',
  RANK_TRACKING_UPDATED: 'rank-tracking:updated',
  // National SERP rank tracking (SEO Decision Engine P6 / national-serp-tracking) —
  // fired after a national_serp_refresh job upserts a fresh batch of serp_snapshots.
  SERP_SNAPSHOTS_REFRESHED: 'serp:snapshots_refreshed',

  // Local SEO
  LOCAL_SEO_UPDATED: 'local-seo:updated',
  // GBP + reviews (SEO Decision Engine P7 / local-gbp) — fired after a local-gbp-refresh
  // job upserts business_listing_snapshots; refreshes the local-SEO panel + command center.
  LOCAL_GBP_SNAPSHOTS_REFRESHED: 'local-gbp:snapshots_refreshed',
  // Authenticated Google Business Profile connection + workspace-location mapping (Phase 2A).
  GBP_CONNECTION_UPDATED: 'gbp:connection_updated',
  // Authenticated Google Business Profile review sync + read model (Phase 2B).
  GBP_REVIEWS_UPDATED: 'gbp:reviews_updated',
  // Authenticated Google Business Profile review response draft/approval/publish workflow (Phase 2C).
  GBP_REVIEW_RESPONSES_UPDATED: 'gbp:review_responses_updated',
  // AI visibility (SEO Decision Engine P8 / ai-visibility) — fired after a llm-mentions-refresh
  // job upserts a llm_mention_snapshots row; refreshes the AI-visibility KPI + intelligence.
  LLM_MENTIONS_SNAPSHOTS_REFRESHED: 'llm-mentions:snapshots_refreshed',

  // E-E-A-T asset inventory
  EEAT_ASSETS_UPDATED: 'eeat-assets:updated',
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
