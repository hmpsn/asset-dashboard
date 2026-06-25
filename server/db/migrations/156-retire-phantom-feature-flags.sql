-- Retire four never-wired ("phantom") feature flags surfaced by the 2026-06-24
-- platform complexity audit: 'self-service-onboarding', 'self-service-gsc-ga4',
-- 'team-collaboration', 'white-label'. These had full catalog/lifecycle entries
-- but ZERO code usages (no FeatureFlag/useFeatureFlag/isFeatureEnabled references)
-- and no backing implementation — they only inflated the active-flag count and
-- carried recurring stale-audit obligations. The catalog entries are removed in
-- shared/types/feature-flags.ts in the same change. Delete any stale override rows
-- (an admin could have toggled them via the flag UI) so the retired keys cannot
-- linger in admin flag surfaces or local/staging state. The corresponding roadmap
-- intent lives on as roadmap items 100/105 (self-service onboarding + OAuth),
-- 16/17/117 (team), and 27 (white-label).

DELETE FROM feature_flag_workspace_overrides
WHERE key IN (
  'self-service-onboarding',
  'self-service-gsc-ga4',
  'team-collaboration',
  'white-label'
);

DELETE FROM feature_flag_overrides
WHERE key IN (
  'self-service-onboarding',
  'self-service-gsc-ga4',
  'team-collaboration',
  'white-label'
);
