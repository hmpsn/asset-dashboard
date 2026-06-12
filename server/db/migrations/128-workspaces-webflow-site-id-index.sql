-- Migration 128: index workspaces.webflow_site_id
-- getWorkspaceBySiteId() / getTokenForSite() look workspaces up by their linked
-- Webflow site id on ~47 request paths (2026-06-09 audit quick-win). Without an
-- index every such lookup is a full table scan; this makes them O(log n) and makes
-- the "indexed single-row helper" contract literally true.
CREATE INDEX IF NOT EXISTS idx_workspaces_webflow_site_id
  ON workspaces (webflow_site_id);
