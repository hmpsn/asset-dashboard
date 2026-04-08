import db from './db/index.js';
import { createStmtCache } from './db/stmt-cache.js';
import { parseJsonFallback } from './db/json-validation.js';
import { addActivity } from './activity-log.js';
import { broadcastToWorkspace } from './broadcast.js';

// ── Types ──

export type FeedbackType = 'bug' | 'feature' | 'general';
export type FeedbackStatus = 'new' | 'acknowledged' | 'fixed' | 'wontfix';

export interface FeedbackItem {
  id: string;
  workspaceId: string;
  type: FeedbackType;
  title: string;
  description: string;
  status: FeedbackStatus;
  /** Auto-captured context from client dashboard */
  context?: {
    currentTab?: string;
    browser?: string;
    screenSize?: string;
    url?: string;
    userAgent?: string;
  };
  submittedBy?: string;
  /** Admin replies */
  replies: FeedbackReply[];
  createdAt: string;
  updatedAt: string;
}

export interface FeedbackReply {
  id: string;
  author: 'team' | 'client';
  content: string;
  createdAt: string;
}

// ── SQLite row shape ──

interface FeedbackRow {
  id: string;
  workspace_id: string;
  type: string;
  title: string;
  description: string;
  status: string;
  context: string | null;
  submitted_by: string | null;
  replies: string;
  created_at: string;
  updated_at: string;
}

const stmts = createStmtCache(() => ({
  insert: db.prepare(
    `INSERT INTO feedback (id, workspace_id, type, title, description, status, context, submitted_by, replies, created_at, updated_at)
         VALUES (@id, @workspace_id, @type, @title, @description, @status, @context, @submitted_by, @replies, @created_at, @updated_at)`,
  ),
  selectByWorkspace: db.prepare(
    `SELECT * FROM feedback WHERE workspace_id = ? ORDER BY created_at DESC`,
  ),
  selectById: db.prepare(
    `SELECT * FROM feedback WHERE id = ? AND workspace_id = ?`,
  ),
  update: db.prepare(
    `UPDATE feedback SET status = @status, replies = @replies, updated_at = @updated_at WHERE id = @id`, // status-ok: simple lifecycle, validateTransition planned in Batch 2
  ),
  deleteById: db.prepare(
    `DELETE FROM feedback WHERE id = ? AND workspace_id = ?`,
  ),
  selectAll: db.prepare(
    `SELECT * FROM feedback ORDER BY created_at DESC`,
  ),
}));

function rowToFeedback(row: FeedbackRow): FeedbackItem {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    type: row.type as FeedbackType,
    title: row.title,
    description: row.description,
    status: row.status as FeedbackStatus,
    context: parseJsonFallback(row.context, undefined),
    submittedBy: row.submitted_by ?? undefined,
    replies: parseJsonFallback(row.replies, []),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ── CRUD ──

export function listFeedback(workspaceId: string): FeedbackItem[] {
  const rows = stmts().selectByWorkspace.all(workspaceId) as FeedbackRow[];
  return rows.map(rowToFeedback);
}

export function getFeedbackItem(workspaceId: string, id: string): FeedbackItem | undefined {
  const row = stmts().selectById.get(id, workspaceId) as FeedbackRow | undefined;
  return row ? rowToFeedback(row) : undefined;
}

export function createFeedback(workspaceId: string, data: {
  type: FeedbackType;
  title: string;
  description: string;
  context?: FeedbackItem['context'];
  submittedBy?: string;
}): FeedbackItem {
  const item: FeedbackItem = {
    id: `fb_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    workspaceId,
    type: data.type,
    title: data.title,
    description: data.description,
    status: 'new',
    context: data.context,
    submittedBy: data.submittedBy,
    replies: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  stmts().insert.run({
    id: item.id,
    workspace_id: workspaceId,
    type: item.type,
    title: item.title,
    description: item.description,
    status: item.status,
    context: item.context ? JSON.stringify(item.context) : null,
    submitted_by: item.submittedBy ?? null,
    replies: JSON.stringify(item.replies),
    created_at: item.createdAt,
    updated_at: item.updatedAt,
  });

  // Activity log
  addActivity(workspaceId, 'note', `Feedback: ${data.title}`, `${data.type} — ${data.description.slice(0, 120)}`, {
    feedbackId: item.id,
    feedbackType: data.type,
  });

  // Real-time broadcast to admin
  broadcastToWorkspace(workspaceId, 'feedback:new', item);

  return item;
}

export function updateFeedbackStatus(workspaceId: string, id: string, status: FeedbackStatus): FeedbackItem | null {
  const item = getFeedbackItem(workspaceId, id);
  if (!item) return null;
  item.status = status;
  item.updatedAt = new Date().toISOString();
  stmts().update.run({
    id: item.id,
    status: item.status,
    replies: JSON.stringify(item.replies),
    updated_at: item.updatedAt,
  });
  broadcastToWorkspace(workspaceId, 'feedback:update', item);
  return item;
}

export function addFeedbackReply(workspaceId: string, id: string, author: 'team' | 'client', content: string): FeedbackItem | null {
  const item = getFeedbackItem(workspaceId, id);
  if (!item) return null;
  const reply: FeedbackReply = {
    id: `fbr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    author,
    content,
    createdAt: new Date().toISOString(),
  };
  item.replies.push(reply);
  item.updatedAt = new Date().toISOString();
  stmts().update.run({
    id: item.id,
    status: item.status,
    replies: JSON.stringify(item.replies),
    updated_at: item.updatedAt,
  });
  broadcastToWorkspace(workspaceId, 'feedback:update', item);
  return item;
}

export function deleteFeedback(workspaceId: string, id: string): boolean {
  const info = stmts().deleteById.run(id, workspaceId);
  return info.changes > 0;
}

/** List feedback across ALL workspaces (for admin command center) */
export function listAllFeedback(): FeedbackItem[] {
  const rows = stmts().selectAll.all() as FeedbackRow[];
  return rows.map(rowToFeedback);
}
