-- Migration 016: Content matrices — bulk content planning grids
-- Each matrix links to a template and stores cells as JSON for flexible variable combos.

CREATE TABLE IF NOT EXISTS content_matrices (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  template_id TEXT NOT NULL,
  dimensions TEXT NOT NULL DEFAULT '[]',
  url_pattern TEXT NOT NULL DEFAULT '',
  keyword_pattern TEXT NOT NULL DEFAULT '',
  cells TEXT NOT NULL DEFAULT '[]',
  stats TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_content_matrices_workspace ON content_matrices(workspace_id);
CREATE INDEX IF NOT EXISTS idx_content_matrices_template ON content_matrices(template_id);
