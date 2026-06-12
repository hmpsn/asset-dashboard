-- Migration 119: Add ON DELETE CASCADE FK to strategy_history.workspace_id
--
-- strategy_history (030) was the lone strategy-path table created WITHOUT a
-- foreign key on workspace_id, so deleting a workspace orphaned its history
-- rows instead of cascading. Every other strategy-path table (the 6 normalized
-- tables + site_keyword_metrics(117) + tracked_keywords(118)) already declares
-- `REFERENCES workspaces(id) ON DELETE CASCADE`. This brings strategy_history
-- in line via the mig-019 table-rebuild pattern.
--
-- SQLite cannot ALTER TABLE … ADD CONSTRAINT, so we recreate the table. Because
-- id is AUTOINCREMENT, the INSERT … SELECT uses an EXPLICIT column list (not
-- SELECT *) so the rowid/id values are preserved exactly — see roi_snapshots /
-- rank_snapshots in migration 019.
--
-- Runs inside runMigrations' foreign_keys=OFF transaction (server/db/index.ts),
-- so the rebuild itself is FK-safe. There is no ALTER ADD/RENAME COLUMN, so the
-- whole file executes as a single db.exec. The _migrations tracker guards reruns.

-- Orphan cleanup FIRST, so orphaned rows (history for already-deleted
-- workspaces) are not copied forward into the FK-constrained table.
DELETE FROM strategy_history WHERE workspace_id NOT IN (SELECT id FROM workspaces);

CREATE TABLE IF NOT EXISTS strategy_history_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  strategy_json TEXT NOT NULL,
  page_map_json TEXT NOT NULL,
  generated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Explicit column list (AUTOINCREMENT-safe): preserves every existing id +
-- generated_at exactly.
INSERT INTO strategy_history_new (id, workspace_id, strategy_json, page_map_json, generated_at)
  SELECT id, workspace_id, strategy_json, page_map_json, generated_at FROM strategy_history;

DROP TABLE IF EXISTS strategy_history;
ALTER TABLE strategy_history_new RENAME TO strategy_history;

CREATE INDEX IF NOT EXISTS idx_strategy_history_ws ON strategy_history(workspace_id);
