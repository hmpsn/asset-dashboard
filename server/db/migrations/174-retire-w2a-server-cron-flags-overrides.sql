-- Flag-sunset Wave 2a — retire two pure-server-cron feature flags:
-- 'strategy-staleness-scan' and 'signal-auto-recompute'. Both were globally
-- ON in prod already, so unconditional-izing their gates is a no-op for
-- behavior. 'strategy-staleness-scan' gated the runSentRecStalenessScan
-- nudge/supersession pass (server/recommendation-staleness.ts);
-- 'signal-auto-recompute' gated the daily activity-gated insight-recompute
-- cron (server/insight-recompute-cron.ts) and the shared
-- enqueueIntelligenceRecompute helper (server/intelligence-recompute-job.ts).
-- The catalog/registry entries are removed in shared/types/feature-flags.ts
-- in the same change. Delete any stale override rows (an admin could have
-- toggled them via the flag UI, or a per-workspace override could exist) so
-- the retired keys cannot linger in admin flag surfaces or local/staging
-- state. Idempotent — safe to re-run.

DELETE FROM feature_flag_workspace_overrides
WHERE key IN (
  'strategy-staleness-scan',
  'signal-auto-recompute'
);

DELETE FROM feature_flag_overrides
WHERE key IN (
  'strategy-staleness-scan',
  'signal-auto-recompute'
);
