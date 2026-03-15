-- Content post version history — snapshots before regeneration or manual edits
CREATE TABLE IF NOT EXISTS content_post_versions (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  version_number INTEGER NOT NULL,
  trigger TEXT NOT NULL,            -- 'regenerate_section', 'manual_edit', 'unification', 'bulk_regenerate'
  trigger_detail TEXT,              -- e.g. 'section:2' or 'field:introduction'
  title TEXT NOT NULL,
  meta_description TEXT NOT NULL,
  introduction TEXT NOT NULL,
  sections TEXT NOT NULL,           -- JSON array of PostSection
  conclusion TEXT NOT NULL,
  seo_title TEXT,
  seo_meta_description TEXT,
  total_word_count INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_content_post_versions_post ON content_post_versions(post_id);
CREATE INDEX IF NOT EXISTS idx_content_post_versions_workspace ON content_post_versions(workspace_id);
