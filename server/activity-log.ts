/**
 * Activity Log — per-workspace activity feed with a per-workspace entry cap.
 * Entries are broadcast in real time via WebSocket.
 */

import { createHash, randomUUID } from 'node:crypto';
import db from './db/index.js';
import { createStmtCache } from './db/stmt-cache.js';
import { parseJsonFallback } from './db/json-validation.js';
import { getMcpToolExecutionContext } from './mcp/tool-execution-context.js';
import { WS_EVENTS } from './ws-events.js';

type WorkspaceBroadcastFn = (workspaceId: string, event: string, data: unknown) => void;
let _broadcastFn: WorkspaceBroadcastFn | null = null;

/** Register a workspace-scoped broadcast function (called from index.ts). */
export function initActivityBroadcast(fn: WorkspaceBroadcastFn) {
  _broadcastFn = fn;
}

export type ActivityType =
  | 'audit_completed'
  | 'audit_suppression_updated'
  | 'request_resolved'
  | 'approval_sent'
  | 'approval_deleted'
  | 'approval_applied'
  | 'approval_reverted'
  | 'seo_updated'
  | 'images_optimized'
  | 'links_fixed'
  | 'content_updated'
  | 'content_requested'
  | 'content_request_deleted'
  | 'content_declined'
  | 'content_request_commented'
  | 'brief_generated'
  | 'brief_approved'
  | 'changes_requested'
  | 'briefing_generated'      // admin: cron wrote a new draft (admin review queue)
  | 'briefing_published'      // CLIENT-VISIBLE: admin manually published a briefing
  | 'briefing_skipped'        // admin: a draft was skipped with note
  | 'briefing_auto_published' // CLIENT-VISIBLE: cron auto-published a briefing (no admin review). Clients see this OR briefing_published per event — never both.
  | 'content_upgraded'
  | 'schema_generated'
  | 'schema_published'
  | 'schema_mapping_updated'
  | 'schema_plan_generated'
  | 'schema_plan_sent'
  | 'redirects_scanned'
  | 'strategy_generated'
  | 'keyword_added'
  | 'rank_tracking_updated'
  | 'recommendations_generated'
  | 'rank_snapshot'
  | 'chat_session'
  | 'payment_received'
  | 'payment_failed'
  | 'fix_completed'
  | 'work_order_commented'
  | 'order_closed'
  | 'anomaly_detected'
  | 'anomaly_positive'
  | 'anomaly_dismissed'
  | 'anomaly_acknowledged'
  | 'post_generated'
  | 'post_reverted'
  | 'post_ai_review'   // admin-only: AI review verdicts persisted (C4) — NOT client-visible
  | 'brief_sent_for_review'
  | 'post_sent_for_review'
  | 'content_published'
  | 'content_publish_failed'
  | 'aeo_review'
  | 'content_subscription'
  | 'subscription_issue'
  | 'subscription_cancelled'
  | 'invoice_paid'
  | 'invoice_failed'
  | 'page_analysis'
  | 'insight_resolved'
  | 'outcome_scored'
  | 'external_action_detected'
  | 'playbook_suggested'
  | 'learnings_updated'
  | 'schema_plan_deleted'
  | 'client_signal'
  | 'note'
  | 'mcp_key_created'   // ADMIN-ONLY infra audit — operator minted a per-workspace MCP API key. NOT in CLIENT_VISIBLE_TYPES.
  | 'mcp_key_revoked'   // ADMIN-ONLY infra audit — operator revoked a per-workspace MCP API key. NOT in CLIENT_VISIBLE_TYPES.
  | 'client_profile_updated'
  | 'client_onboarding_submitted'
  | 'client_keyword_feedback'
  | 'client_keyword_tracked'
  | 'client_keyword_removed'
  | 'client_priorities_updated'
  | 'client_content_gap_vote'
  | 'client_action_sent'
  | 'client_action_approved'
  | 'client_action_changes_requested'
  | 'client_action_completed'
  | 'deliverable_sent'
  | 'deliverable_responded'
  | 'deliverable_reminded'   // operator: admin re-nudged the client about a pending deliverable (NOT client-visible)
  | 'meeting_brief_generated'
  | 'strategy_pov_generated'   // The Issue (Lane B): admin generated/regenerated/edited the curated POV
  | 'strategy_issue_pushed'    // The Issue (Phase 3): the weekly cron pre-baked the POV + rang the operator doorbell (OPERATOR-only, never client-visible)
  | 'strategy_autosent'        // The Issue (Phase 4): the trust-ladder cron auto-sent N low-risk moves (OPERATOR-only, never client-visible)
  | 'brandscript_created'
  | 'brandscript_deleted'
  | 'brandscript_imported'
  | 'brandscript_completed'
  | 'brandscript_sections_updated'
  | 'discovery_source_added'
  | 'discovery_source_deleted'
  | 'discovery_processed'
  | 'voice_sample_added'
  | 'voice_sample_deleted'
  | 'voice_calibrated'
  | 'voice_refined'
  | 'voice_profile_created'
  | 'voice_profile_updated'
  | 'brand_generation_started'          // admin-only: durable B2 run created
  | 'brand_generation_resumed'          // admin-only: exact finalized voice unlocked dependents
  | 'brand_generation_revision_started' // admin-only: review-directed revision job created
  | 'brand_generation_completed'        // admin-only: automatic gates reached a truthful terminal outcome
  | 'brand_deliverable_generated'
  | 'brand_deliverable_refined'
  | 'brand_deliverable_approved'
  | 'brand_deliverable_reverted'
  | 'brand_intake_submitted'
  | 'brand_intake_evidence_resolved'
  | 'blueprint_created'
  | 'blueprint_updated'
  | 'blueprint_deleted'
  | 'blueprint_generated'
  | 'blueprint_entry_added'
  | 'blueprint_entry_updated'
  | 'blueprint_entry_deleted'
  | 'copy_generated'
  | 'copy_approved'
  | 'copy_batch_started'
  | 'copy_batch_complete'
  | 'copy_exported'
  | 'copy_suggestion_added'
  | 'copy_section_edited'
  | 'copy_sent_to_client'
  | 'copy_pattern_removed'
  | 'diagnostic_completed'
  | 'local_seo_updated'
  | 'eeat_asset_created'
  | 'eeat_asset_updated'
  | 'eeat_asset_deleted'
  | 'portal_session'
  | 'action_backlog_alert'
  | 'post_approved'
  | 'post_changes_requested'
  | 'post_client_edit'
  | 'llms_txt_generated'
  // rec_status_updated / rec_dismissed are deliberately NOT in CLIENT_VISIBLE_TYPES:
  // recommendation triage is an internal admin-facing audit trail, not a client deliverable.
  | 'rec_status_updated'   // client triage: pending/in_progress/completed
  | 'rec_dismissed'        // client dismissed a recommendation
  // Strategy v3 curation lifecycle (spec §7.5). rec_sent + rec_approved are CLIENT-VISIBLE
  // (real client-facing milestones); rec_struck + rec_throttled are ADMIN-ONLY (internal
  // curation hygiene the client must never see — a struck rec read as activity would leak
  // "we decided not to do this").
  | 'rec_sent'             // CLIENT-VISIBLE: operator sent a curated rec to the client
  | 'rec_approved'         // CLIENT-VISIBLE: client approved a sent rec
  | 'rec_struck'           // admin-only: operator permanently suppressed a rec
  | 'rec_throttled'        // admin-only: operator throttled a rec for 7/30/90 days
  // Strategy v3 P3 — admin-only staleness nudge (a sent rec waiting >14d with no client
  // response, or superseded by a newer rec). Internal curation hygiene; deliberately NOT
  // in CLIENT_VISIBLE_TYPES — a stale-rec nudge must never surface in the client activity feed.
  | 'rec_nudge_stale'      // admin-only: a sent rec is stale (waiting >14d) or superseded
  | 'suggested_brief_accepted'   // admin accepted a suggested brief (AI-generated)
  | 'suggested_brief_dismissed'  // admin dismissed a suggested brief
  | 'suggested_brief_snoozed'    // admin snoozed a suggested brief
  | 'post_voice_scored'          // admin-only: voice score persisted for a post
  | 'workspace_archived'         // admin-only: workspace hidden from default operator lists
  | 'workspace_unarchived'       // admin-only: workspace restored to default operator lists
  // Strategy redesign P2 pre-commit (consumed in P3 Lane A) — managed keyword working-set
  // mutations (strategy_keyword_set table). Admin-only curation hygiene; deliberately NOT
  // in CLIENT_VISIBLE_TYPES — keyword-set add/remove/keep is an internal operator audit
  // trail, never a client-facing milestone. The matching `tracked_actions` keep markers
  // (topic_cluster_keep / content_gap_keep) live in shared/types/outcome-tracking.ts
  // (ActionType), a SEPARATE union — do not conflate.
  | 'strategy_keyword_kept'      // admin-only: operator explicitly kept a keyword (survives regen)
  | 'strategy_keyword_removed'   // admin-only: operator removed a keyword from the managed set
  | 'strategy_keyword_added'     // admin-only: keyword added to the managed set (client_request / manual_add)
  // The Issue — Lane 1E: cannibalization keeper-override (operator sets the canonical page).
  | 'cannibalization_keeper_set' // admin-only: operator set the keeper page for a cannibalization URL set
  // The Issue (Client) P1a: a Webflow named lead was captured via the daily Data-API poller.
  // ADMIN-ONLY — deliberately NOT in CLIENT_VISIBLE_TYPES (the capture is an internal operator
  // signal, not a client deliverable) and its metadata omits PII (D7): only { formId, outcomeType }.
  | 'form_submission_captured'
  // The Issue (Client) P1a: the operator saved the tracked-Webflow-forms mapping (PUT form-sources),
  // which can flip the D6 provenance marker (confirmed setup) — audit trail for a config mutation.
  // ADMIN-ONLY — deliberately NOT in CLIENT_VISIBLE_TYPES; PII-free metadata: only { formCount }.
  | 'form_capture_configured'
  // The Issue (Client) P1c: the weekly return-hook cron sent the client their "what came in" digest.
  // ADMIN-ONLY (operator audit trail) — deliberately NOT in CLIENT_VISIBLE_TYPES; PII-free metadata:
  // only counts/flags ({ weekOf, leadCount, hasMoney, pendingCount }), never lead identity.
  | 'client_return_hook_sent'
  // Strategy trust-ladder: the operator enabled/disabled auto-send for an archetype — the opt-in that
  // lets recommendations auto-send to the client WITHOUT per-item review (the single most audit-worthy
  // operation in the trust-ladder). ADMIN-ONLY — deliberately NOT in CLIENT_VISIBLE_TYPES; PII-free
  // metadata: only { archetype, enabled }.
  | 'autosend_policy_changed';

export interface ActivityEntry {
  id: string;
  workspaceId: string;
  type: ActivityType;
  title: string;
  description?: string;
  metadata?: Record<string, unknown>;
  actorId?: string;
  actorName?: string;
  createdAt: string;
}

const MAX_ENTRIES_PER_WORKSPACE = 500;

// --- SQLite row shape ---

interface ActivityRow {
  id: string;
  workspace_id: string;
  type: string;
  title: string;
  description: string | null;
  metadata: string | null;
  actor_id: string | null;
  actor_name: string | null;
  created_at: string;
}

function rowToEntry(row: ActivityRow): ActivityEntry {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    type: row.type as ActivityType,
    title: row.title,
    description: row.description ?? undefined,
    metadata: row.metadata ? parseJsonFallback(row.metadata, undefined) : undefined,
    actorId: row.actor_id ?? undefined,
    actorName: row.actor_name ?? undefined,
    createdAt: row.created_at,
  };
}

/** Remove internal MCP key identity before an activity crosses a client-visible seam. */
function toClientSafeActivityEntry(entry: ActivityEntry): ActivityEntry {
  if (!entry.metadata || !Object.prototype.hasOwnProperty.call(entry.metadata, 'mcpCaller')) {
    return entry;
  }

  const { mcpCaller: _internalMcpCaller, ...clientSafeMetadata } = entry.metadata;
  return {
    ...entry,
    metadata: Object.keys(clientSafeMetadata).length > 0 ? clientSafeMetadata : undefined,
  };
}

/**
 * Client and admin subscribers share the workspace channel. Only activities
 * exposed by the client activity read boundary may include their entry data on
 * that channel. Admin-only activity events are invalidation signals; operators
 * can refetch the durable activity log through the admin read boundary.
 */
function toWorkspaceBroadcastActivityPayload(entry: ActivityEntry): ActivityEntry | Record<string, never> {
  if (CLIENT_VISIBLE_TYPES.has(entry.type)) {
    return toClientSafeActivityEntry(entry);
  }

  return {};
}

/** Activity types visible to clients — real team work only, no system/anomaly/internal entries */
const CLIENT_VISIBLE_TYPES: Set<ActivityType> = new Set([
  'audit_completed', 'request_resolved', 'approval_sent', 'approval_applied', 'approval_reverted', 'seo_updated',
  'images_optimized', 'links_fixed', 'content_updated', 'content_requested',
  'content_declined', 'content_request_commented', 'brief_generated', 'brief_approved',
  'changes_requested', 'briefing_published', 'briefing_auto_published', 'content_upgraded', 'fix_completed',
  'work_order_commented', 'order_closed',
  'content_published', 'copy_sent_to_client', 'post_approved', 'post_changes_requested',
  'post_client_edit', 'brief_sent_for_review', 'post_sent_for_review', 'client_action_sent', 'client_action_approved',
  'client_action_changes_requested', 'client_action_completed',
  'deliverable_sent', 'deliverable_responded',
  'rec_sent', 'rec_approved',
]);

const CLIENT_ENGAGEMENT_TYPES: ActivityType[] = [
  'portal_session',
  'client_profile_updated',
  'client_onboarding_submitted',
  'client_keyword_feedback',
  'client_keyword_tracked',
  'client_keyword_removed',
  'client_priorities_updated',
  'client_content_gap_vote',
  'client_action_approved',
  'client_action_changes_requested',
  'copy_approved',
  'copy_suggestion_added',
  'post_approved',
  'post_changes_requested',
  'post_client_edit',
];

// --- Prepared statements (lazily initialized after migrations run) ---

const stmts = createStmtCache(() => ({
  insert: db.prepare(`
        INSERT INTO activity_log (id, workspace_id, type, title, description, metadata,
          actor_id, actor_name, created_at)
        VALUES (@id, @workspace_id, @type, @title, @description, @metadata,
          @actor_id, @actor_name, @created_at)
      `),
  insertIgnore: db.prepare(`
        INSERT OR IGNORE INTO activity_log (
          id, workspace_id, type, title, description, metadata,
          actor_id, actor_name, created_at
        ) VALUES (
          @id, @workspace_id, @type, @title, @description, @metadata,
          @actor_id, @actor_name, @created_at
        )
      `),
  selectById: db.prepare('SELECT * FROM activity_log WHERE id = ?'),
  selectByWorkspace: db.prepare(
    'SELECT * FROM activity_log WHERE workspace_id = ? ORDER BY created_at DESC LIMIT ?',
  ),
  selectByWorkspaceAndType: db.prepare(
    'SELECT * FROM activity_log WHERE workspace_id = ? AND type = ? ORDER BY created_at DESC LIMIT ?',
  ),
  selectAll: db.prepare(
    'SELECT * FROM activity_log ORDER BY created_at DESC LIMIT ?',
  ),
  selectClientVisible: db.prepare(
    `SELECT * FROM activity_log WHERE workspace_id = ? AND type IN (${[...CLIENT_VISIBLE_TYPES].map(() => '?').join(',')}) ORDER BY created_at DESC LIMIT ? OFFSET ?`,
  ),
  hasRecent: db.prepare(
    `SELECT 1 FROM activity_log WHERE workspace_id = ? AND created_at > datetime('now', ? || ' days') LIMIT 1`,
  ),
  countByType: db.prepare(
    `SELECT COUNT(*) as count FROM activity_log WHERE workspace_id = ? AND type = ? AND created_at > datetime('now', ? || ' days')`,
  ),
  clientActivitySummary: db.prepare(`
    SELECT
      COUNT(DISTINCT date(created_at)) AS distinct_days,
      MAX(created_at) AS last_active
    FROM activity_log
    WHERE workspace_id = ?
      AND type IN (${CLIENT_ENGAGEMENT_TYPES.map(() => '?').join(',')})
      AND created_at > datetime('now', ? || ' days')
  `),
  pruneRetention: db.prepare(`
        DELETE FROM activity_log
        WHERE rowid IN (
          SELECT rowid
          FROM (
            SELECT
              rowid,
              ROW_NUMBER() OVER (
                PARTITION BY workspace_id
                ORDER BY created_at DESC, rowid DESC
              ) AS retention_rank
            FROM activity_log
          )
          WHERE retention_rank > ?
        )
      `),
}));

// ── Public API ──

export function addActivity(workspaceId: string, type: ActivityType, title: string, description?: string, metadata?: Record<string, unknown>, actor?: { id?: string; name?: string }): ActivityEntry {
  const mcpExecutionContext = getMcpToolExecutionContext();
  const entry: ActivityEntry = {
    id: `act_${randomUUID()}`,
    workspaceId,
    type,
    title,
    description,
    metadata: mcpExecutionContext
      ? { ...metadata, mcpCaller: mcpExecutionContext }
      : metadata,
    actorId: actor?.id,
    actorName: actor?.name,
    createdAt: new Date().toISOString(),
  };

  stmts().insert.run({
    id: entry.id,
    workspace_id: entry.workspaceId,
    type: entry.type,
    title: entry.title,
    description: entry.description ?? null,
    metadata: entry.metadata ? JSON.stringify(entry.metadata) : null,
    actor_id: entry.actorId ?? null,
    actor_name: entry.actorName ?? null,
    created_at: entry.createdAt,
  });

  // Workspace broadcasts are shared with client subscribers. Keep every
  // admin-only activity's details behind the admin read boundary.
  _broadcastFn?.(workspaceId, WS_EVENTS.ACTIVITY_NEW, toWorkspaceBroadcastActivityPayload(entry));

  return entry;
}

export interface AddActivityOnceInput {
  effectKey: string;
  workspaceId: string;
  type: ActivityType;
  title: string;
  description?: string;
  metadata?: Record<string, unknown>;
  actor?: { id?: string; name?: string };
  createdAt: string;
}

/**
 * Persist one outbox-backed activity exactly once and broadcast it at least
 * once. Retrying after an insert/broadcast crash reuses the deterministic row
 * while emitting a fresh invalidation signal.
 */
export function addActivityOnce(input: AddActivityOnceInput): ActivityEntry {
  const effectKey = input.effectKey.trim();
  if (!effectKey || new TextEncoder().encode(effectKey).byteLength > 512) {
    throw new Error('activity effect key must be between 1 and 512 UTF-8 bytes');
  }
  const entry: ActivityEntry = {
    id: `act_bge_${createHash('sha256').update(effectKey).digest('hex')}`,
    workspaceId: input.workspaceId,
    type: input.type,
    title: input.title,
    description: input.description,
    metadata: input.metadata,
    actorId: input.actor?.id,
    actorName: input.actor?.name,
    createdAt: input.createdAt,
  };
  stmts().insertIgnore.run({
    id: entry.id,
    workspace_id: entry.workspaceId,
    type: entry.type,
    title: entry.title,
    description: entry.description ?? null,
    metadata: entry.metadata ? JSON.stringify(entry.metadata) : null,
    actor_id: entry.actorId ?? null,
    actor_name: entry.actorName ?? null,
    created_at: entry.createdAt,
  });
  const storedRow = stmts().selectById.get(entry.id) as ActivityRow | undefined;
  if (!storedRow) throw new Error('idempotent activity was not persisted');
  const stored = rowToEntry(storedRow);
  if (stored.workspaceId !== entry.workspaceId
    || stored.type !== entry.type
    || stored.title !== entry.title
    || stored.description !== entry.description
    || stored.actorId !== entry.actorId
    || stored.actorName !== entry.actorName
    || stored.createdAt !== entry.createdAt
    || JSON.stringify(stored.metadata ?? null) !== JSON.stringify(entry.metadata ?? null)) {
    throw new Error('activity effect key is bound to different activity inputs');
  }
  if (!_broadcastFn) throw new Error('activity broadcast is not initialized');
  _broadcastFn(
    input.workspaceId,
    WS_EVENTS.ACTIVITY_NEW,
    toWorkspaceBroadcastActivityPayload(stored),
  );
  return stored;
}

export function pruneActivityLogRetention(): number {
  const result = stmts().pruneRetention.run(MAX_ENTRIES_PER_WORKSPACE);
  return result.changes;
}

export function listActivity(workspaceId?: string, limit = 50): ActivityEntry[] {
  let rows: ActivityRow[];
  if (workspaceId) {
    rows = stmts().selectByWorkspace.all(workspaceId, limit) as ActivityRow[];
  } else {
    rows = stmts().selectAll.all(limit) as ActivityRow[];
  }
  return rows.map(rowToEntry);
}

/**
 * List the most-recent activity entries of a SINGLE type for a workspace.
 * Unlike listActivity (which caps the most-recent N rows across ALL types), the
 * LIMIT here applies only to rows of `type`, so a type-scoped dedup read cannot
 * be pushed past the cap by unrelated high-volume activity (portal_session, etc.).
 */
export function listActivityByType(workspaceId: string, type: ActivityType, limit = 50): ActivityEntry[] {
  const rows = stmts().selectByWorkspaceAndType.all(workspaceId, type, limit) as ActivityRow[];
  return rows.map(rowToEntry);
}

export function listClientActivity(workspaceId: string, limit = 50, offset = 0): ActivityEntry[] {
  const rows = stmts().selectClientVisible.all(workspaceId, ...CLIENT_VISIBLE_TYPES, limit, offset) as ActivityRow[];
  return rows.map(rowToEntry).map(toClientSafeActivityEntry);
}

/** Returns true if the workspace has any activity log entry within the last `withinDays` days. */
export function hasRecentActivity(workspaceId: string, withinDays: number = 30): boolean {
  const row = stmts().hasRecent.get(workspaceId, `-${withinDays}`);
  return row != null;
}

/** Count activity entries of a specific type within the last N days for a workspace. */
export function countActivityByType(workspaceId: string, type: ActivityType, withinDays: number = 30): number {
  const row = stmts().countByType.get(workspaceId, type, `-${withinDays}`) as { count: number };
  return row.count;
}

/**
 * Summarise client-originated portal activity within the last N days.
 * Admin-originated "sent to client" events are intentionally excluded.
 */
export function getClientActivitySummary(
  workspaceId: string,
  withinDays: number = 30,
): { distinctDays: number; lastActive: string } | null {
  const row = stmts().clientActivitySummary.get(workspaceId, ...CLIENT_ENGAGEMENT_TYPES, `-${withinDays}`) as {
    distinct_days: number;
    last_active: string | null;
  };
  if (!row || !row.last_active || row.distinct_days === 0) return null;
  return { distinctDays: row.distinct_days, lastActive: row.last_active };
}
