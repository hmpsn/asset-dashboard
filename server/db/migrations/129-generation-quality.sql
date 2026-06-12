-- 129-generation-quality.sql
-- F1 (#7a) — persist the keyword-strategy generation-quality telemetry that was
-- previously log-only. The pipeline computes a typed GenerationQuality record on
-- every run (poolSize, aiReturnedCount, suppressedCount, backfilledCount, floorHit);
-- this table durably records ONE row per generation run, workspace-scoped, so the
-- quality of every run can be queried, trended, and (later) fed into calibration.
--
-- Append-only history (no UNIQUE on workspace_id): a workspace re-generates its
-- strategy many times, and each run is a distinct quality observation. Reads use the
-- (workspace_id, created_at DESC) index to fetch the latest run or a trend window.
--
-- floor_hit is a 0/1 integer boolean (never NULL): the floor either fired or it did
-- not. The count columns are NOT NULL with no default — every run computes them.
--
-- DB column + mapper lockstep (CLAUDE.md): ships in the same commit as
-- GenerationQualityRow + rowToStoredGenerationQuality (server/generation-quality-store.ts),
-- StoredGenerationQuality (shared/types/generation-quality.ts), and the
-- recordGenerationQuality write site in server/keyword-strategy-generation.ts. The
-- table is internal-only (never serialized on a public route) — no public-portal
-- field list to update.

CREATE TABLE IF NOT EXISTS generation_quality (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL,
  pool_size INTEGER NOT NULL,
  ai_returned_count INTEGER NOT NULL,
  suppressed_count INTEGER NOT NULL,
  backfilled_count INTEGER NOT NULL,
  floor_hit INTEGER NOT NULL, -- 0/1 boolean: did the deterministic backfill floor fire
  created_at TEXT NOT NULL,   -- ISO timestamp of the generation run
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_generation_quality_workspace_created
  ON generation_quality(workspace_id, created_at DESC);
