-- 007: Content publish tracking columns
-- Tracks Webflow CMS publish state for generated content posts.
-- NOTE: Uses ALTER TABLE ADD COLUMN. The migration runner executes each
-- statement individually and ignores "duplicate column" errors so this
-- is safe for concurrent test workers and re-runs.

ALTER TABLE content_posts ADD COLUMN webflow_item_id TEXT;
ALTER TABLE content_posts ADD COLUMN webflow_collection_id TEXT;
ALTER TABLE content_posts ADD COLUMN published_at TEXT;
ALTER TABLE content_posts ADD COLUMN published_slug TEXT;

-- Workspace-level publish target configuration (stored as JSON)
ALTER TABLE workspaces ADD COLUMN publish_target TEXT;
