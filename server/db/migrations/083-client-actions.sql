-- client_actions: unified client-facing action/review queue for manual or agency-executed recommendations.

CREATE TABLE IF NOT EXISTS client_actions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending',
  priority TEXT NOT NULL DEFAULT 'medium',
  client_note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_client_actions_workspace_status ON client_actions(workspace_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_client_actions_workspace_source ON client_actions(workspace_id, source_type, source_id);
