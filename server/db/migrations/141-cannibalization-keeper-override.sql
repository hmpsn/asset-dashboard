-- Migration 141: Cannibalization keeper-override table.
--
-- Stores operator-chosen keeper page for a cannibalization URL set.
-- Keyed on the ORDER-INDEPENDENT cannibalizationUrlSetKey (NOT the
-- cannibalization_issues row id), so the override survives the
-- delete-then-reinsert regen clobber of cannibalization_issues.
--
-- See: server/cannibalization-keeper-override.ts
CREATE TABLE IF NOT EXISTS cannibalization_keeper_override (
  workspace_id TEXT NOT NULL,
  url_set_key  TEXT NOT NULL,
  keeper_path  TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  PRIMARY KEY (workspace_id, url_set_key)
);
