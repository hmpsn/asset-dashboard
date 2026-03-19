-- Migration 018: Pending schemas table for D7 schema pre-generation
-- Stores lightweight schema skeletons generated when matrix cells reach
-- brief_generated or approved status, ready to apply on publish.

CREATE TABLE IF NOT EXISTS pending_schemas (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  matrix_id TEXT NOT NULL,
  cell_id TEXT NOT NULL,
  schema_json TEXT NOT NULL,
  status TEXT DEFAULT 'pending',  -- 'pending' | 'applied' | 'stale'
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pending_schemas_workspace ON pending_schemas(workspace_id);
CREATE INDEX IF NOT EXISTS idx_pending_schemas_cell ON pending_schemas(cell_id);
