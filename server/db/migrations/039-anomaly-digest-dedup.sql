-- Unique index for anomaly digest deduplication
-- Key: (workspace_id, insight_type, page_id) where insight_type = 'anomaly_digest'
CREATE UNIQUE INDEX IF NOT EXISTS idx_anomaly_digest_dedup
  ON analytics_insights(workspace_id, insight_type, page_id)
  WHERE insight_type = 'anomaly_digest';
