-- Persistent SEO title/description suggestions with 3 variations per page
CREATE TABLE IF NOT EXISTS seo_suggestions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  page_id TEXT NOT NULL,
  page_title TEXT NOT NULL DEFAULT '',
  page_slug TEXT NOT NULL DEFAULT '',
  field TEXT NOT NULL CHECK(field IN ('title', 'description')),
  current_value TEXT NOT NULL DEFAULT '',
  variations TEXT NOT NULL DEFAULT '[]',  -- JSON array of 3 strings
  selected_index INTEGER,                 -- null = not yet selected
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'applied', 'dismissed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_seo_suggestions_workspace ON seo_suggestions(workspace_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_seo_suggestions_page_field ON seo_suggestions(workspace_id, page_id, field);
