-- 131-outcome-emv-calibration.sql
-- A5 (audit #20) — durable per-(workspace, action_type) snapshot of the P6
-- realized-vs-predicted EMV calibration AND the observed time-to-completion
-- effort prior, recomputed by the weekly calibration cron
-- (server/outcome-emv-calibration.ts, registered in server/outcome-crons.ts).
--
-- ONE row per (workspace_id, action_type). The cron fully recomputes a
-- workspace's rows on every run (delete + reinsert inside one transaction):
-- this is a DERIVED snapshot table — no user-authored metadata to preserve.
--
-- Honesty contract (FM-2):
--   status='conclusive'  → pair_count >= MIN_CALIBRATION_PAIRS and
--                          median_realization_ratio is a real median of
--                          attributed_value / predicted_emv pairs.
--   status='inconclusive'→ median_realization_ratio IS NULL — never fabricated.
--   median_effort_days   → NULL below MIN_EFFORT_SAMPLES live samples.
--
-- DB column + mapper lockstep (CLAUDE.md): ships in the same commit as
-- OutcomeEmvCalibrationRow + rowToEmvCalibrationEntry + the upsert write path in
-- server/outcome-emv-calibration.ts. Internal-only (admin/AI calibration substrate,
-- never serialized on a public route) — no public-portal field list to update.

CREATE TABLE IF NOT EXISTS outcome_emv_calibration (
  workspace_id TEXT NOT NULL,
  action_type TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('conclusive', 'inconclusive')),
  pair_count INTEGER NOT NULL DEFAULT 0,            -- realized/predicted pairs found
  median_realization_ratio REAL,                    -- median(attributed_value / predicted_emv); NULL when inconclusive
  effort_sample_count INTEGER NOT NULL DEFAULT 0,   -- live rec-completion effort samples found
  median_effort_days REAL,                          -- median(action.created_at - rec.createdAt) in days; NULL below floor
  computed_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, action_type),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);
