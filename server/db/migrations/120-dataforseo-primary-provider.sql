-- DataForSEO is the canonical runtime SEO provider.
-- Legacy SEMRush preferences are retained only as input aliases before PR2 removes
-- the remaining compatibility surface.
UPDATE workspaces
SET seo_data_provider = 'dataforseo'
WHERE seo_data_provider = 'semrush';
