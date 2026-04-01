-- 044-insight-bridge-source.sql
-- Add bridge_source column so bridge-generated insights survive stale cleanup
-- without abusing resolution_status. When non-null, deleteStaleInsightsByType skips the row.
ALTER TABLE analytics_insights ADD COLUMN bridge_source TEXT;
