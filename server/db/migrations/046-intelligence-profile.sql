-- Add intelligence_profile column for structured business intelligence data
-- (industry, goals, target audience — separate from business_profile which stores contact info)
ALTER TABLE workspaces ADD COLUMN intelligence_profile TEXT;
