-- Migration 014: Content Templates for scalable content planning
-- Templates define reusable page structures with named sections,
-- variable patterns, and CMS field mappings.

CREATE TABLE IF NOT EXISTS content_templates (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  page_type TEXT NOT NULL DEFAULT 'service',
  variables TEXT NOT NULL DEFAULT '[]',          -- JSON array of TemplateVariable
  sections TEXT NOT NULL DEFAULT '[]',           -- JSON array of TemplateSection
  url_pattern TEXT NOT NULL DEFAULT '',          -- e.g. "/services/{city}/{service}"
  keyword_pattern TEXT NOT NULL DEFAULT '',      -- e.g. "{service} in {city}"
  title_pattern TEXT,                            -- e.g. "{service} in {city} | {brand}"
  meta_desc_pattern TEXT,
  cms_field_map TEXT,                            -- JSON Record<string, string>
  tone_and_style TEXT,                           -- optional override of workspace brand voice
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_content_templates_workspace ON content_templates(workspace_id);
