/**
 * Activity Log — per-workspace activity feed with 500-entry cap.
 * Entries are broadcast in real time via WebSocket.
 */

import db from './db/index.js';
import { createStmtCache } from './db/stmt-cache.js';
import { parseJsonFallback } from './db/json-validation.js';

type WorkspaceBroadcastFn = (workspaceId: string, event: string, data: unknown) => void;
let _broadcastFn: WorkspaceBroadcastFn | null = null;

/** Register a workspace-scoped broadcast function (called from index.ts). */
export function initActivityBroadcast(fn: WorkspaceBroadcastFn) {
  _broadcastFn = fn;
}

export type ActivityType =
  | 'audit_completed'
  | 'request_resolved'
  | 'approval_applied'
  | 'approval_reverted'
  | 'seo_updated'
  | 'images_optimized'
  | 'links_fixed'
  | 'content_updated'
  | 'content_requested'
  | 'content_declined'
  | 'brief_generated'
  | 'brief_approved'
  | 'changes_requested'
  | 'content_upgraded'
  | 'schema_generated'
  | 'schema_published'
  | 'schema_plan_generated'
  | 'schema_plan_sent'
  | 'redirects_scanned'
  | 'strategy_generated'
  | 'rank_snapshot'
  | 'chat_session'
  | 'payment_received'
  | 'payment_failed'
  | 'fix_completed'
  | 'anomaly_detected'
  | 'anomaly_positive'
  | 'post_generated'
  | 'post_reverted'
  | 'content_published'
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
  | 'client_profile_updated'
  | 'client_onboarding_submitted'
  | 'client_keyword_feedback'
  | 'client_priorities_updated'
  | 'client_content_gap_vote'
  | 'meeting_brief_generated'
  | 'brandscript_created'
  | 'brandscript_deleted'
  | 'brandscript_imported'
  | 'brandscript_completed'
  | 'discovery_source_added'
  | 'discovery_source_deleted'
  | 'discovery_processed'
  | 'voice_sample_added'
  | 'voice_sample_deleted'
  | 'voice_calibrated'
  | 'voice_refined'
  | 'voice_profile_updated'
  | 'brand_deliverable_generated'
  | 'brand_deliverable_refined'
  | 'brand_deliverable_approved'
  | 'brand_deliverable_reverted'
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
  | 'copy_pattern_removed'
  | 'diagnostic_completed'
  | 'portal_session';

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

const MAX_ENTRIES = 500;

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

/** Activity types visible to clients — real team work only, no system/anomaly/internal entries */
const CLIENT_VISIBLE_TYPES: Set<ActivityType> = new Set([
  'audit_completed', 'request_resolved', 'approval_applied', 'seo_updated',
  'images_optimized', 'links_fixed', 'content_updated', 'content_requested',
  'brief_generated', 'brief_approved', 'content_upgraded', 'fix_completed',
  'content_published',
]);

// --- Prepared statements (lazily initialized after migrations run) ---

const stmts = createStmtCache(() => ({
  insert: db.prepare(`
        INSERT INTO activity_log (id, workspace_id, type, title, description, metadata,
          actor_id, actor_name, created_at)
        VALUES (@id, @workspace_id, @type, @title, @description, @metadata,
          @actor_id, @actor_name, @created_at)
      `),
  selectByWorkspace: db.prepare(
    'SELECT * FROM activity_log WHERE workspace_id = ? ORDER BY created_at DESC LIMIT ?',
  ),
  selectAll: db.prepare(
    'SELECT * FROM activity_log ORDER BY created_at DESC LIMIT ?',
  ),
  selectClientVisible: db.prepare(
    `SELECT * FROM activity_log WHERE workspace_id = ? AND type IN (${[...CLIENT_VISIBLE_TYPES].map(() => '?').join(',')}) ORDER BY created_at DESC LIMIT ?`,
  ),
  hasRecent: db.prepare(
    `SELECT 1 FROM activity_log WHERE workspace_id = ? AND created_at > datetime('now', ? || ' days') LIMIT 1`,
  ),
  countByType: db.prepare(
    `SELECT COUNT(*) as count FROM activity_log WHERE workspace_id = ? AND type = ? AND created_at > datetime('now', ? || ' days')`,
  ),
  countAll: db.prepare('SELECT COUNT(*) as count FROM activity_log'),
  clientActivitySummary: db.prepare(`
    SELECT
      COUNT(DISTINCT date(created_at)) AS distinct_days,
      MAX(created_at) AS last_active
    FROM activity_log
    WHERE workspace_id = ?
      AND type LIKE 'client_%'
      AND created_at > datetime('now', ? || ' days')
  `),
  // Global retention policy: prune the N oldest rows across all workspaces
  // to enforce the global activity-log size cap. Scoping to a single workspace
  // here would defeat the purpose of the global cap.
  // ws-scope-ok
  pruneOldest: db.prepare(`
        DELETE FROM activity_log WHERE id IN (
          SELECT id FROM activity_log ORDER BY created_at ASC LIMIT ?
        )
      `),
}));

// ── Public API ──

export function addActivity(workspaceId: string, type: ActivityType, title: string, description?: string, metadata?: Record<string, unknown>, actor?: { id?: string; name?: string }): ActivityEntry {
  const entry: ActivityEntry = {
    id: `act_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    workspaceId,
    type,
    title,
    description,
    metadata,
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

  // Enforce 500-entry cap
  const { count } = stmts().countAll.get() as { count: number };
  if (count > MAX_ENTRIES) {
    stmts().pruneOldest.run(count - MAX_ENTRIES);
  }

  // Broadcast to subscribed workspace clients
  _broadcastFn?.(workspaceId, 'activity:new', entry);

  return entry;
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

export function listClientActivity(workspaceId: string, limit = 50): ActivityEntry[] {
  const rows = stmts().selectClientVisible.all(workspaceId, ...CLIENT_VISIBLE_TYPES, limit) as ActivityRow[];
  return rows.map(rowToEntry);
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
 * Summarise client portal activity (type LIKE 'client_%') within the last N days.
 * Returns the count of distinct calendar days with activity and the most recent
 * activity timestamp, or null if no client activity was found in the window.
 */
export function getClientActivitySummary(
  workspaceId: string,
  withinDays: number = 30,
): { distinctDays: number; lastActive: string } | null {
  const row = stmts().clientActivitySummary.get(workspaceId, `-${withinDays}`) as {
    distinct_days: number;
    last_active: string | null;
  };
  if (!row || !row.last_active || row.distinct_days === 0) return null;
  return { distinctDays: row.distinct_days, lastActive: row.last_active };
}
