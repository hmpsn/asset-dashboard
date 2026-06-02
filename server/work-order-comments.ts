/**
 * Work-order conversation store — dedicated `work_order_comments` table.
 *
 * Comments are served OUT-OF-BAND from the work-order deliverable payload (owner
 * decision): they are NOT a field on WorkOrder / OrderRow. This module owns its
 * own statement cache + rowToComment mapper, sibling to server/work-orders.ts
 * per platform-organization (bounded-context-local data lives next to its order).
 */
import db from './db/index.js';
import { createStmtCache } from './db/stmt-cache.js';
import { invalidateContentPipelineCache } from './workspace-data.js';
import { invalidateIntelligenceCache } from './workspace-intelligence.js';
import type { WorkOrderComment, WorkOrderCommentAuthor } from '../shared/types/payments.ts';

// ── SQLite row shape ──

interface CommentRow {
  id: string;
  work_order_id: string;
  workspace_id: string;
  author: string;
  content: string;
  created_at: string;
  read_at: string | null;
}

const stmts = createStmtCache(() => ({
  insert: db.prepare(
    `INSERT INTO work_order_comments (id, work_order_id, workspace_id, author, content, created_at, read_at)
         VALUES (@id, @work_order_id, @workspace_id, @author, @content, @created_at, @read_at)`,
  ),
  selectByOrder: db.prepare(
    // Secondary `id ASC` sort makes same-millisecond inserts deterministic. The index
    // idx_work_order_comments_order is on (work_order_id, created_at); the id tiebreak is an
    // in-memory sort over the (tiny) per-order comment set — cheap.
    `SELECT * FROM work_order_comments WHERE workspace_id = ? AND work_order_id = ? ORDER BY created_at ASC, id ASC`,
  ),
  // Confirm the parent order exists + belongs to the workspace before inserting a
  // comment (FK alone would reject a missing order, but we want a clean null return).
  selectOrder: db.prepare(
    `SELECT id FROM work_orders WHERE id = ? AND workspace_id = ?`,
  ),
  // Bump the parent order's updated_at so the conversation surfaces freshness.
  bumpOrder: db.prepare(
    `UPDATE work_orders SET updated_at = @updated_at WHERE id = @id AND workspace_id = @workspace_id`,
  ),
}));

function rowToComment(row: CommentRow): WorkOrderComment {
  return {
    id: row.id,
    workOrderId: row.work_order_id,
    author: row.author as WorkOrderCommentAuthor,
    content: row.content,
    createdAt: row.created_at,
    // Three-state read_at: NULL → undefined (unread).
    readAt: row.read_at ?? undefined,
  };
}

/** List a work order's conversation, oldest-first. Empty array if none / order missing. */
export function listWorkOrderComments(
  workspaceId: string,
  workOrderId: string,
): WorkOrderComment[] {
  const rows = stmts().selectByOrder.all(workspaceId, workOrderId) as CommentRow[];
  return rows.map(rowToComment);
}

/**
 * Append a comment to a work order's conversation. Returns the new comment, or
 * null if the parent order is missing / not in this workspace.
 *
 * The read (parent-exists check) + insert + parent updated_at bump run inside a
 * single BEGIN IMMEDIATE transaction (.immediate()) so the read-then-write on the
 * parent order cannot hit the SQLITE_BUSY_SNAPSHOT race that was just fixed
 * repo-wide. A deferred txn would acquire the write lock lazily AFTER the read
 * snapshot, opening the exact race window; .immediate() takes the write lock up
 * front.
 */
// Process-monotonic counter so same-millisecond inserts get lexicographically increasing
// ids. listWorkOrderComments orders by (created_at ASC, id ASC); the id tiebreak is only a
// true insertion-order tiebreak if the id sorts in insertion order, which a random suffix
// does not. The zero-padded counter (after the ms timestamp) guarantees that.
let commentSeq = 0;

export function addWorkOrderComment(
  workspaceId: string,
  workOrderId: string,
  author: WorkOrderCommentAuthor,
  content: string,
): WorkOrderComment | null {
  const now = new Date().toISOString();
  const seq = (commentSeq++).toString(36).padStart(6, '0');
  const comment: WorkOrderComment = {
    id: `wocmt_${Date.now()}_${seq}_${Math.random().toString(36).slice(2, 6)}`,
    workOrderId,
    author,
    content,
    createdAt: now,
  };

  const insertComment = db.transaction((): WorkOrderComment | null => {
    const order = stmts().selectOrder.get(workOrderId, workspaceId) as { id: string } | undefined;
    if (!order) return null;
    stmts().insert.run({
      id: comment.id,
      work_order_id: workOrderId,
      workspace_id: workspaceId,
      author: comment.author,
      content: comment.content,
      created_at: comment.createdAt,
      read_at: null,
    });
    stmts().bumpOrder.run({ id: workOrderId, workspace_id: workspaceId, updated_at: now });
    return comment;
  });

  const result = insertComment.immediate();
  if (result) invalidateWorkOrderCommentCaches(workspaceId);
  return result;
}

function invalidateWorkOrderCommentCaches(workspaceId: string): void {
  invalidateContentPipelineCache(workspaceId);
  invalidateIntelligenceCache(workspaceId);
}
