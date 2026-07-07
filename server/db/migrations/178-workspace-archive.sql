-- 178-workspace-archive.sql
-- SB-043 (UI rebuild W6 global-ops) — soft archive workspaces without
-- deleting client/operator history.
ALTER TABLE workspaces ADD COLUMN archived_at TEXT;

CREATE INDEX IF NOT EXISTS idx_workspaces_archived_at
  ON workspaces (archived_at);
