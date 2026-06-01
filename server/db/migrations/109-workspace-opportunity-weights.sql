-- 109-workspace-opportunity-weights.sql
-- Per-workspace calibrated Opportunity Value display weights (PR5 · Spine C).
-- The 7 dimension weights feed the OV component-breakdown DISPLAY (not the value).
-- Default = platform DEFAULT_WEIGHTS; the monthly ridge-nudge auto-tuning is
-- OUT OF SCOPE for PR5 (deferred) — this PR ships the table + getOrCreate at
-- platform defaults so the weights round-trip with zero behavior change.

CREATE TABLE IF NOT EXISTS workspace_opportunity_weights (
  workspace_id TEXT PRIMARY KEY,
  demand REAL NOT NULL,
  winnability REAL NOT NULL,
  intent REAL NOT NULL,
  effort REAL NOT NULL,
  business_fit REAL NOT NULL,
  timing REAL NOT NULL,
  evidence REAL NOT NULL,
  calibration_version TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
