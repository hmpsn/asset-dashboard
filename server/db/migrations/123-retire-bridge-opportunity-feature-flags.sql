-- Retire fully enabled Workspace Intelligence bridge and Opportunity Value flags.
-- Runtime paths are default-on as of this migration; stale overrides must not
-- keep retired keys visible in admin flag surfaces or local/staging state.

DELETE FROM feature_flag_workspace_overrides
WHERE key IN (
  'intelligence-shadow-mode',
  'opportunity-value-scorer',
  'opportunity-value-calibration',
  'opportunity-value-events',
  'bridge-outcome-reweight',
  'bridge-decay-suggested-brief',
  'bridge-strategy-invalidate',
  'bridge-insight-to-action',
  'bridge-page-analysis-invalidate',
  'bridge-action-auto-resolve',
  'bridge-content-to-insight',
  'bridge-schema-to-insight',
  'bridge-anomaly-boost',
  'bridge-settings-cascade',
  'bridge-audit-page-health',
  'bridge-action-annotation',
  'bridge-annotation-to-insight',
  'bridge-audit-site-health',
  'bridge-audit-auto-resolve',
  'bridge-briefing-candidate-refresh',
  'bridge-client-signal'
);

DELETE FROM feature_flag_overrides
WHERE key IN (
  'intelligence-shadow-mode',
  'opportunity-value-scorer',
  'opportunity-value-calibration',
  'opportunity-value-events',
  'bridge-outcome-reweight',
  'bridge-decay-suggested-brief',
  'bridge-strategy-invalidate',
  'bridge-insight-to-action',
  'bridge-page-analysis-invalidate',
  'bridge-action-auto-resolve',
  'bridge-content-to-insight',
  'bridge-schema-to-insight',
  'bridge-anomaly-boost',
  'bridge-settings-cascade',
  'bridge-audit-page-health',
  'bridge-action-annotation',
  'bridge-annotation-to-insight',
  'bridge-audit-site-health',
  'bridge-audit-auto-resolve',
  'bridge-briefing-candidate-refresh',
  'bridge-client-signal'
);
