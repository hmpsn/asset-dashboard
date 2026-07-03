-- Flag-sunset Wave 1 — retire three reserved-but-never-wired phantom feature
-- flags: 'strategy-paid-topics', 'the-issue-client-reconciliation', and
-- 'the-issue-client-segment-inserts'. Each had full FEATURE_FLAGS /
-- FEATURE_FLAG_CATALOG / group entries but was NEVER consumed by
-- isFeatureEnabled / useFeatureFlag / <FeatureFlag> anywhere in the repo —
-- reserved for future features that were never built (the segment-inserts
-- behavior already ships unflagged under the-issue-client-spine). The
-- catalog/registry entries are removed in shared/types/feature-flags.ts in the
-- same change. Delete any stale override rows (an admin could have toggled them
-- via the flag UI, or a per-workspace override could exist) so the retired keys
-- cannot linger in admin flag surfaces or local/staging state. Delete-then-
-- re-add-when-built; zero behavior change. Idempotent — safe to re-run.

DELETE FROM feature_flag_workspace_overrides
WHERE key IN (
  'strategy-paid-topics',
  'the-issue-client-reconciliation',
  'the-issue-client-segment-inserts'
);

DELETE FROM feature_flag_overrides
WHERE key IN (
  'strategy-paid-topics',
  'the-issue-client-reconciliation',
  'the-issue-client-segment-inserts'
);
