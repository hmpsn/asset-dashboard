-- 113-work-order-comments.sql
-- Work-order conversation (client ↔ team) + explicit `closed` state.
--
-- Comments live in a DEDICATED table, served out-of-band from the work-order
-- deliverable payload (owner decision). Author is 'client' | 'team'. read_at is
-- a three-state (NULL = unread). ON DELETE CASCADE on BOTH parents (work order +
-- workspace) — foreign keys are ON (WAL mode), so removing either parent removes
-- the comments (the workspace-delete cascade in migration 111 reaches these too).
--
-- The trailing ALTER adds the companion `closed_at` column to work_orders for the
-- operator-only `completed → closed` close-out. The migration runner detects
-- `ALTER TABLE ... ADD COLUMN` and switches to per-statement exec with
-- duplicate-column tolerance, so mixing CREATE + ALTER in one file is safe.
-- Append-only ALTER, NO table rebuild.
CREATE TABLE IF NOT EXISTS work_order_comments (
  id            TEXT PRIMARY KEY,
  work_order_id TEXT NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  author        TEXT NOT NULL,
  content       TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  read_at       TEXT
);
CREATE INDEX IF NOT EXISTS idx_work_order_comments_order ON work_order_comments(work_order_id, created_at);
CREATE INDEX IF NOT EXISTS idx_work_order_comments_workspace ON work_order_comments(workspace_id);
ALTER TABLE work_orders ADD COLUMN closed_at TEXT;
