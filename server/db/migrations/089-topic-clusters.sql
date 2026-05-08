-- Dedicated topic_clusters table — normalizes keywordStrategy.topicClusters[]
-- out of the workspace JSON blob into indexed rows.

CREATE TABLE IF NOT EXISTS topic_clusters (
  workspace_id TEXT NOT NULL,
  topic TEXT NOT NULL,
  keywords TEXT NOT NULL, -- JSON array of strings
  owned_count INTEGER NOT NULL,
  total_count INTEGER NOT NULL,
  coverage_percent REAL NOT NULL,
  avg_position REAL,
  top_competitor TEXT,
  top_competitor_coverage REAL,
  gap_keywords TEXT NOT NULL, -- JSON array of strings
  PRIMARY KEY (workspace_id, topic),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_topic_clusters_workspace ON topic_clusters(workspace_id);
CREATE INDEX IF NOT EXISTS idx_topic_clusters_coverage ON topic_clusters(workspace_id, coverage_percent);
