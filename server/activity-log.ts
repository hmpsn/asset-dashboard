/**
 * Activity Log — per-workspace activity feed with 500-entry cap.
 * Entries are broadcast in real time via WebSocket.
 */

import db from './db/index.js';

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
  | 'note';

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
    metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    actorId: row.actor_id ?? undefined,
    actorName: row.actor_name ?? undefined,
    createdAt: row.created_at,
  };
}

// --- Prepared statements (lazily initialized after migrations run) ---

interface Stmts {
  insert: ReturnType<typeof db.prepare>;
  selectByWorkspace: ReturnType<typeof db.prepare>;
  selectAll: ReturnType<typeof db.prepare>;
  selectClientVisible: ReturnType<typeof db.prepare>;
  deleteById: ReturnType<typeof db.prepare>;
  countAll: ReturnType<typeof db.prepare>;
  pruneOldest: ReturnType<typeof db.prepare>;
}

let _stmts: Stmts | null = null;

function stmts(): Stmts {
  if (!_stmts) {
    _stmts = {
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
      deleteById: db.prepare('DELETE FROM activity_log WHERE id = ?'),
      countAll: db.prepare('SELECT COUNT(*) as count FROM activity_log'),
      pruneOldest: db.prepare(`
        DELETE FROM activity_log WHERE id IN (
          SELECT id FROM activity_log ORDER BY created_at ASC LIMIT ?
        )
      `),
    };
  }
  return _stmts;
}

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

/** Activity types visible to clients — real team work only, no system/anomaly/internal entries */
const CLIENT_VISIBLE_TYPES: Set<ActivityType> = new Set([
  'audit_completed', 'request_resolved', 'approval_applied', 'seo_updated',
  'images_optimized', 'links_fixed', 'content_updated', 'content_requested',
  'brief_generated', 'brief_approved', 'content_upgraded', 'fix_completed',
  'content_published',
]);

export function listClientActivity(workspaceId: string, limit = 50): ActivityEntry[] {
  const rows = stmts().selectClientVisible.all(workspaceId, ...CLIENT_VISIBLE_TYPES, limit) as ActivityRow[];
  return rows.map(rowToEntry);
}

export function deleteActivity(id: string): boolean {
  const info = stmts().deleteById.run(id);
  return info.changes > 0;
}
