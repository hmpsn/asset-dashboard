-- 114-feature-flag-workspace-overrides.sql
-- Per-workspace feature-flag override dimension (SEO Generation Quality P0).
--
-- Adds a second, narrower override layer below the existing global
-- feature_flag_overrides table (042). Resolution priority for a flag, when a
-- workspaceId is supplied:
--   per-workspace DB override  (this table)
--     → global DB override     (feature_flag_overrides, 042)
--       → env var              (FEATURE_<FLAG>=true)
--         → hardcoded default  (FEATURE_FLAGS)
-- When no workspaceId is supplied the global path is byte-identical to today.
--
-- This is the runtime substrate the per-workspace canary rollout (plan P4) needs:
-- rolloutTarget is static catalog metadata today with no per-workspace resolver.
--
-- Lockstep note: there is no rowToX mapper for this table — the override values
-- are read as a boolean projection inside server/feature-flags.ts (mirroring the
-- existing feature_flag_overrides read), not assembled into a domain object.
CREATE TABLE IF NOT EXISTS feature_flag_workspace_overrides (
  key          TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  enabled      INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (key, workspace_id)
);
CREATE INDEX IF NOT EXISTS idx_ffwo_workspace ON feature_flag_workspace_overrides(workspace_id);
