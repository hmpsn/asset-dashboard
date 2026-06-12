-- Retire fully enabled Outcome Intelligence feature flags.
-- The runtime paths are default-on as of this migration; stale overrides must not
-- keep retired keys visible in admin flag surfaces or local/staging state.

DELETE FROM feature_flag_workspace_overrides
WHERE key IN (
  'outcome-tracking',
  'outcome-dashboard',
  'outcome-playbooks',
  'outcome-external-detection',
  'outcome-client-reporting',
  'outcome-ai-injection',
  'outcome-predictive'
);

DELETE FROM feature_flag_overrides
WHERE key IN (
  'outcome-tracking',
  'outcome-dashboard',
  'outcome-playbooks',
  'outcome-external-detection',
  'outcome-client-reporting',
  'outcome-ai-injection',
  'outcome-predictive'
);
