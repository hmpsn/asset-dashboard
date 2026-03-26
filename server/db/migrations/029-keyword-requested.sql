-- Migration 029: Add 'requested' status to keyword feedback
-- Allows clients to submit keyword ideas, not just approve/decline AI suggestions.

-- SQLite doesn't support ALTER CHECK, so we drop and recreate the constraint
-- by creating a new table with the expanded check
CREATE TABLE IF NOT EXISTS keyword_feedback_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL,
  keyword TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('approved', 'declined', 'requested')),
  reason TEXT,
  source TEXT DEFAULT 'content_gap',
  declined_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(workspace_id, keyword)
);

INSERT OR IGNORE INTO keyword_feedback_new SELECT * FROM keyword_feedback;
DROP TABLE keyword_feedback;
ALTER TABLE keyword_feedback_new RENAME TO keyword_feedback;

CREATE INDEX IF NOT EXISTS idx_keyword_feedback_ws ON keyword_feedback(workspace_id);
CREATE INDEX IF NOT EXISTS idx_keyword_feedback_ws_status ON keyword_feedback(workspace_id, status);
