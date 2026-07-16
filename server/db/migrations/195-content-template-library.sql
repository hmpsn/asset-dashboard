-- Immutable studio-owned template snapshots. Workspace instances are copied
-- into content_templates; no library row is referenced at generation time.

CREATE TABLE content_template_library (
  id TEXT PRIMARY KEY,
  vertical TEXT NOT NULL CHECK (
    length(vertical) BETWEEN 1 AND 64
    AND vertical NOT GLOB '*[^a-z0-9-]*'
    AND vertical NOT LIKE '-%'
    AND vertical NOT LIKE '%-'
    AND vertical NOT LIKE '%--%'
  ),
  name TEXT NOT NULL CHECK (length(name) > 0),
  page_type TEXT NOT NULL CHECK (length(page_type) > 0),
  snapshot TEXT NOT NULL CHECK (length(snapshot) > 0),
  source_workspace_id TEXT NOT NULL CHECK (length(source_workspace_id) > 0),
  source_template_id TEXT NOT NULL CHECK (length(source_template_id) > 0),
  source_template_revision INTEGER NOT NULL CHECK (
    typeof(source_template_revision) = 'integer'
    AND source_template_revision >= 0
  ),
  created_at TEXT NOT NULL CHECK (length(created_at) > 0),
  UNIQUE (source_workspace_id, source_template_id, source_template_revision)
);

CREATE INDEX idx_content_template_library_vertical_created
  ON content_template_library(vertical, created_at DESC, id);
