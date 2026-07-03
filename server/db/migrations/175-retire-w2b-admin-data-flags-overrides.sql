-- Flag-sunset Wave 2b — retire four admin/data-shaping feature flags:
-- 'smart-placeholders', 'keyword-universe-full', 'ai-visibility', and
-- 'geo-targeting'. All four were globally ON in prod already, so
-- unconditional-izing their gates is a no-op for behavior. 'smart-placeholders'
-- gated the admin AdminChat contextual placeholder + suggestion chips
-- (src/hooks/useSmartPlaceholder.ts); 'keyword-universe-full' gated the
-- uncapped keyword-universe coverage path in the Keyword Command Center
-- (server/domains/keyword-command-center/); 'ai-visibility' gated the
-- LLM-mentions admin KPI panel + seoContext slice field
-- (server/intelligence/seo-context-slice.ts, server/routes/rank-tracking.ts,
-- src/components/strategy/AiVisibilityPanel.tsx); 'geo-targeting' gated
-- workspaceProviderGeo resolving the real target-geo instead of `{}`
-- (server/seo-target-geo.ts) + the admin TargetGeoEditor
-- (src/components/settings/BusinessFootprintTab.tsx). None have a
-- client-facing surface. The catalog/registry entries are removed in
-- shared/types/feature-flags.ts in the same change. Delete any stale
-- override rows (an admin could have toggled them via the flag UI, or a
-- per-workspace override could exist) so the retired keys cannot linger in
-- admin flag surfaces or local/staging state. Idempotent — safe to re-run.

DELETE FROM feature_flag_workspace_overrides
WHERE key IN (
  'smart-placeholders',
  'keyword-universe-full',
  'ai-visibility',
  'geo-targeting'
);

DELETE FROM feature_flag_overrides
WHERE key IN (
  'smart-placeholders',
  'keyword-universe-full',
  'ai-visibility',
  'geo-targeting'
);
