-- Add SERP features column to page_keywords.
-- Stores an array of SERP feature names present for a page's primary keyword
-- (e.g. ["featured_snippet","people_also_ask","local_pack"]) captured from
-- SEMRush domain organic data during strategy generation.
-- Used to aggregate workspace-level SerpFeatures counts in assembleSeoContext().
ALTER TABLE page_keywords ADD COLUMN serp_features TEXT;
