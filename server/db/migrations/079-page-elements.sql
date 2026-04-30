-- 079-page-elements.sql
-- PageElementCatalog persistence. One row per (workspace, page).
-- catalog_json stores a typed PageElementCatalog blob (validated via Zod
-- on read). Stale-detection: source_published_at is compared against
-- Webflow's lastPublished timestamp at refresh time.
-- Tracked: schema-page-element-catalog-v1 PR1.

CREATE TABLE page_elements (
  workspace_id        TEXT NOT NULL,
  page_path           TEXT NOT NULL,
  catalog_json        TEXT NOT NULL,
  source_published_at TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  PRIMARY KEY (workspace_id, page_path),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE INDEX idx_page_elements_workspace ON page_elements(workspace_id);
