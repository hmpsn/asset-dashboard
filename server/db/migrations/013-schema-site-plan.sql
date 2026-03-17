-- Migration 013: Schema site plan for site-aware schema generation
-- Stores the AI-generated plan that assigns roles to pages and defines
-- canonical entities before bulk schema generation begins.

CREATE TABLE IF NOT EXISTS schema_site_plans (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  site_url TEXT NOT NULL,
  canonical_entities TEXT NOT NULL,    -- JSON array of CanonicalEntity
  page_roles TEXT NOT NULL,            -- JSON array of PageRoleAssignment
  status TEXT NOT NULL DEFAULT 'draft',
  client_preview_batch_id TEXT,
  generated_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_schema_site_plans_site ON schema_site_plans(site_id);
CREATE INDEX IF NOT EXISTS idx_schema_site_plans_workspace ON schema_site_plans(workspace_id);
