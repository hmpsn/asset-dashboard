-- Migration 012: Schema site template for unified Organization/WebSite nodes
-- Stores the canonical Organization + WebSite schema nodes per site,
-- extracted from homepage generation and reused across all subpages.

CREATE TABLE IF NOT EXISTS schema_site_templates (
  site_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  organization_node TEXT NOT NULL,   -- JSON: full Organization @graph node
  website_node TEXT NOT NULL,        -- JSON: full WebSite @graph node
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
