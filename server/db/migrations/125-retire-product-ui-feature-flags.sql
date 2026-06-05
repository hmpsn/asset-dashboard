-- Retire product/UI rollout flags that are now canonical.
DELETE FROM feature_flag_workspace_overrides
WHERE key IN (
  'copy-engine',
  'copy-engine-voice',
  'copy-engine-pipeline',
  'deep-diagnostics',
  'client-brand-section'
);

DELETE FROM feature_flag_overrides
WHERE key IN (
  'copy-engine',
  'copy-engine-voice',
  'copy-engine-pipeline',
  'deep-diagnostics',
  'client-brand-section'
);
