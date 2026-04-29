-- 078-workspace-site-has-search.sql
-- Adds siteHasSearch flag to workspaces. When true, schema generation emits
-- WebSite.potentialAction (sitelinks SearchAction). Default 0 (false) so
-- existing workspaces don't suddenly emit the action without admin opt-in.
-- Tracked: schema-yoast-parity-fields PR1.

ALTER TABLE workspaces ADD COLUMN site_has_search INTEGER DEFAULT 0;
