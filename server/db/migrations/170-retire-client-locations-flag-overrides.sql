-- Retire the phantom 'client-locations' feature flag (Reconcile R12b flag
-- burn-down). The flag had full FEATURE_FLAGS / FEATURE_FLAG_CATALOG / group
-- entries but was NEVER consumed by isFeatureEnabled/useFeatureFlag/
-- <FeatureFlag> anywhere in the repo — a genuinely phantom flag, distinct
-- from the unrelated (and very much alive) server/client-locations.ts CRUD
-- module. The catalog/registry entries are removed in
-- shared/types/feature-flags.ts in the same change. Delete any stale
-- override rows (an admin could have toggled it via the flag UI, or set a
-- per-workspace override) so the retired key cannot linger in admin flag
-- surfaces or local/staging state. Idempotent — safe to re-run.

DELETE FROM feature_flag_workspace_overrides
WHERE key = 'client-locations';

DELETE FROM feature_flag_overrides
WHERE key = 'client-locations';
