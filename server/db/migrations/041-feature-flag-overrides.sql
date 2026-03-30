-- 041-feature-flag-overrides.sql
-- Persists admin-controlled feature flag overrides.
-- Priority: DB override > env var > hardcoded default.
CREATE TABLE IF NOT EXISTS feature_flag_overrides (
  key     TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
