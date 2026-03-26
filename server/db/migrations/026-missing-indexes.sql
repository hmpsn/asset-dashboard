-- Missing composite indexes for common filter + sort patterns
CREATE INDEX IF NOT EXISTS idx_anomalies_ws_dismissed ON anomalies(workspace_id, dismissed_at);
CREATE INDEX IF NOT EXISTS idx_approval_batches_ws_status ON approval_batches(workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_content_posts_ws_status ON content_posts(workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_content_topic_requests_ws_status ON content_topic_requests(workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_churn_signals_ws_dismissed ON churn_signals(workspace_id, dismissed_at);
CREATE INDEX IF NOT EXISTS idx_content_subscriptions_ws_status ON content_subscriptions(workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_feedback_ws_status ON feedback(workspace_id, status);
