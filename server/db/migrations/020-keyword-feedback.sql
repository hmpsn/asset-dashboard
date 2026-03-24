-- Migration 020: Client keyword feedback
-- Stores client approve/decline decisions on strategy keywords.
-- Declined keywords are injected into the AI prompt on next strategy generation
-- so similar keywords don't resurface.

CREATE TABLE IF NOT EXISTS keyword_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL,
  keyword TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('approved', 'declined')),
  reason TEXT,                        -- optional client reason for declining
  source TEXT DEFAULT 'content_gap',  -- where the keyword appeared: content_gap, page_map, opportunity, topic_cluster
  declined_by TEXT,                   -- client user email or name
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(workspace_id, keyword)
);

CREATE INDEX IF NOT EXISTS idx_keyword_feedback_ws ON keyword_feedback(workspace_id);
CREATE INDEX IF NOT EXISTS idx_keyword_feedback_ws_status ON keyword_feedback(workspace_id, status);
