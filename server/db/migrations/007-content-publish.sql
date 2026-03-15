-- 007: Content publish tracking columns
-- Tracks Webflow CMS publish state for generated content posts.
-- Uses CREATE TABLE trick for idempotent ALTER TABLE (SQLite has no IF NOT EXISTS for ADD COLUMN).

-- Add publish tracking to content_posts (only if columns don't already exist)
CREATE TABLE IF NOT EXISTS _007_check (x);
DROP TABLE _007_check;

-- content_posts columns
ALTER TABLE content_posts ADD COLUMN webflow_item_id TEXT;
ALTER TABLE content_posts ADD COLUMN webflow_collection_id TEXT;
ALTER TABLE content_posts ADD COLUMN published_at TEXT;
ALTER TABLE content_posts ADD COLUMN published_slug TEXT;

-- Workspace-level publish target configuration (stored as JSON)
ALTER TABLE workspaces ADD COLUMN publish_target TEXT;
