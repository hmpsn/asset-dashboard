-- 107-ov-divergence.sql
-- Shadow-logging table for the Opportunity Value re-architecture (PR4).
-- Records per-generation divergence between the legacy ranked #1 and the
-- OV-ranked #1 so the owner can review before any flag flip.
-- Zero client-facing effect — admin/internal read only.

CREATE TABLE IF NOT EXISTS ov_divergence (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  legacy_top_rec_id TEXT,
  ov_top_rec_id TEXT,
  agree INTEGER NOT NULL,            -- 1 if legacy_top === ov_top, 0 otherwise
  ov_top_confidence REAL,
  ov_top_grounded_spine TEXT,
  ov_top_emv REAL,
  invariant_held INTEGER NOT NULL,   -- 1 if grounded-beats-ungrounded invariant holds
  legacy_top3 TEXT,                  -- JSON: [{id, title, source, impactScore}]
  ov_top3 TEXT,                      -- JSON: [{id, title, source, impactScore}]
  per_rec_delta TEXT,                -- JSON: [{id, legacy, ov}]
  computed_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ov_divergence_workspace_id ON ov_divergence(workspace_id, computed_at DESC);
