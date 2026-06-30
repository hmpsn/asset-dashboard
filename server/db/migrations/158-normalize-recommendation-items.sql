-- Normalize recommendation_sets.recommendations[] into addressable rows.
--
-- recommendation_sets remains the per-workspace metadata table for generated_at
-- and summary. recommendation_items is authoritative when rows exist; the legacy
-- recommendations TEXT column is retained as fallback/seed data during cutover.

CREATE TABLE IF NOT EXISTS recommendation_items (
  workspace_id TEXT NOT NULL,
  id TEXT NOT NULL,
  rank_order INTEGER NOT NULL,
  type TEXT NOT NULL,
  priority TEXT NOT NULL,
  status TEXT NOT NULL,
  source TEXT NOT NULL,
  impact TEXT NOT NULL,
  impact_score REAL NOT NULL,
  client_status TEXT,
  lifecycle TEXT,
  target_keyword TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  payload TEXT NOT NULL,
  PRIMARY KEY (workspace_id, id),
  FOREIGN KEY (workspace_id) REFERENCES recommendation_sets(workspace_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_recommendation_items_workspace_rank
  ON recommendation_items(workspace_id, rank_order);
CREATE INDEX IF NOT EXISTS idx_recommendation_items_status
  ON recommendation_items(workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_recommendation_items_priority
  ON recommendation_items(workspace_id, priority);
CREATE INDEX IF NOT EXISTS idx_recommendation_items_source
  ON recommendation_items(workspace_id, source);
CREATE INDEX IF NOT EXISTS idx_recommendation_items_impact
  ON recommendation_items(workspace_id, impact);
CREATE INDEX IF NOT EXISTS idx_recommendation_items_type
  ON recommendation_items(workspace_id, type);
CREATE INDEX IF NOT EXISTS idx_recommendation_items_client_status
  ON recommendation_items(workspace_id, client_status);
CREATE INDEX IF NOT EXISTS idx_recommendation_items_lifecycle
  ON recommendation_items(workspace_id, lifecycle);

CREATE TRIGGER IF NOT EXISTS trg_recommendation_sets_delete_items
AFTER DELETE ON recommendation_sets
FOR EACH ROW
BEGIN
  DELETE FROM recommendation_items WHERE workspace_id = OLD.workspace_id;
END;
