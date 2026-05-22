-- Per-workspace override for the local SEO refresh keyword budget.
--
-- Default (NULL) means "use the global default" — see LOCAL_SEO_DEFAULT_KEYWORDS_PER_REFRESH
-- in server/local-seo.ts. Local-first workspaces (e.g. multi-market service
-- businesses) can raise this to spend more DataForSEO budget on broader local-pack
-- coverage. Bounded server-side to [LOCAL_SEO_MIN_KEYWORDS_PER_REFRESH,
-- LOCAL_SEO_MAX_KEYWORDS_PER_REFRESH_CAP].

ALTER TABLE local_seo_workspace_settings
  ADD COLUMN keywords_per_refresh INTEGER;
