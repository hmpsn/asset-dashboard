-- Migration 052: add competitor_last_fetched_at to workspaces
-- Tracks when competitor keyword data was last fetched for a workspace,
-- enabling incremental strategy updates that skip re-fetching fresh data.
ALTER TABLE workspaces ADD COLUMN competitor_last_fetched_at TEXT;
