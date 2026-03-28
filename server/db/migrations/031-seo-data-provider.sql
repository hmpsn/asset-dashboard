-- Migration 031: SEO data provider preference per workspace
-- Allows switching between SEMRush and DataForSEO per workspace.

ALTER TABLE workspaces ADD COLUMN seo_data_provider TEXT;
