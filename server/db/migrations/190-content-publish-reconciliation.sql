CREATE UNIQUE INDEX idx_content_posts_id_workspace
  ON content_posts(id, workspace_id);

CREATE TABLE content_publish_reconciliations (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  post_id TEXT NOT NULL,
  collection_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  external_state TEXT NOT NULL CHECK (external_state IN ('draft', 'published')),
  source_generation_revision INTEGER NOT NULL CHECK (source_generation_revision >= 0),
  first_seen_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  resolved_at TEXT,
  FOREIGN KEY (post_id, workspace_id)
    REFERENCES content_posts(id, workspace_id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX idx_content_publish_reconciliation_unresolved
  ON content_publish_reconciliations(workspace_id, post_id, collection_id)
  WHERE resolved_at IS NULL;

CREATE INDEX idx_content_publish_reconciliation_item
  ON content_publish_reconciliations(workspace_id, post_id, item_id);
