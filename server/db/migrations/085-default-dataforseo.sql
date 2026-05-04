-- Migrate all workspaces that were explicitly configured to use SEMRush
-- over to DataForSEO. SEMRush API credits are exhausted and DataForSEO
-- is now the primary provider for all SEO data flows.
UPDATE workspaces SET seo_data_provider = 'dataforseo' WHERE seo_data_provider = 'semrush';
