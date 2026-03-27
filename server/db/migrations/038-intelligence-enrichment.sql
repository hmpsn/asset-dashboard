-- 038-intelligence-enrichment.sql
-- Add enrichment columns to analytics_insights
ALTER TABLE analytics_insights ADD COLUMN page_title TEXT;
ALTER TABLE analytics_insights ADD COLUMN strategy_keyword TEXT;
ALTER TABLE analytics_insights ADD COLUMN strategy_alignment TEXT;
ALTER TABLE analytics_insights ADD COLUMN audit_issues TEXT;
ALTER TABLE analytics_insights ADD COLUMN pipeline_status TEXT;
ALTER TABLE analytics_insights ADD COLUMN anomaly_linked INTEGER DEFAULT 0;
ALTER TABLE analytics_insights ADD COLUMN impact_score REAL DEFAULT 0;
ALTER TABLE analytics_insights ADD COLUMN domain TEXT DEFAULT 'cross';

-- Rename quick_win → ranking_opportunity in existing rows
UPDATE analytics_insights SET insight_type = 'ranking_opportunity' WHERE insight_type = 'quick_win';
