-- Add site_intelligence_client_view column to workspaces
-- Controls whether the IntelligenceSummaryCard is shown to the client on OverviewTab.
-- Defaults to NULL (treated as true by frontend — new feature is on by default).
ALTER TABLE workspaces ADD COLUMN site_intelligence_client_view INTEGER;
