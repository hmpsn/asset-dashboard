-- Recreate client_signals with the correct snake_case column schema.
-- The original table (from a dev migration) used camelCase columns.
-- This migration drops and recreates it with the canonical schema from 047.
-- Safe: no production data exists in this table yet.

DROP TABLE IF EXISTS client_signals;

CREATE TABLE IF NOT EXISTS client_signals (
  id              TEXT NOT NULL PRIMARY KEY,
  workspace_id    TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  workspace_name  TEXT NOT NULL,
  type            TEXT NOT NULL CHECK(type IN ('content_interest', 'service_interest')),
  status          TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new', 'reviewed', 'actioned')),
  chat_context    TEXT NOT NULL DEFAULT '[]',
  trigger_message TEXT NOT NULL DEFAULT '',
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_client_signals_workspace ON client_signals(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_client_signals_status    ON client_signals(status, created_at DESC);
