-- 040-insight-resolution-tracking.sql
-- Add resolution tracking to analytics_insights
ALTER TABLE analytics_insights ADD COLUMN resolution_status TEXT;  -- 'unresolved' | 'in_progress' | 'resolved'
ALTER TABLE analytics_insights ADD COLUMN resolution_note TEXT;    -- e.g., "brief created", "content refreshed"
ALTER TABLE analytics_insights ADD COLUMN resolved_at TEXT;        -- ISO timestamp

-- ROI attribution table: links optimizations to metric outcomes
CREATE TABLE IF NOT EXISTS roi_attributions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  action_type TEXT NOT NULL,        -- 'content_refresh' | 'brief_published' | 'seo_fix' | 'schema_added'
  action_date TEXT NOT NULL,        -- ISO timestamp of when the optimization was made
  page_url TEXT NOT NULL,
  description TEXT NOT NULL,        -- "Content refresh on /blog/ai-tools"
  -- Metric snapshots: before and after
  clicks_before INTEGER,
  clicks_after INTEGER,
  impressions_before INTEGER,
  impressions_after INTEGER,
  position_before REAL,
  position_after REAL,
  measured_at TEXT,                  -- ISO timestamp of when the after-measurement was taken
  measurement_window_days INTEGER DEFAULT 14,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_roi_workspace ON roi_attributions(workspace_id);
CREATE INDEX IF NOT EXISTS idx_roi_page ON roi_attributions(workspace_id, page_url);
