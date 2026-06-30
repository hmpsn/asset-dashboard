-- 139-strategy-keyword-set.sql
-- Strategy redesign (graft 1) — dedicated managed keyword working-set table.
--
-- WHY A DEDICATED TABLE (not a column on tracked_keywords): tracked_keywords is
-- delete-then-reinserted on every rank-tracking sync (replaceAllTrackedKeywordRows,
-- tracked-keywords-store.ts:184 deleteAll → fixed-column reinsert), so any curation
-- column added there is clobbered to NULL on each sync. This table's SOLE writer is the
-- reconciler grafted into persistKeywordStrategy's writeKeywordStrategy transaction (P3),
-- so regen never clobbers it. A keyword is "in the managed set" iff it has a row with
-- removed_at IS NULL.
--
-- P2 pre-commit: table is CREATED here but never written yet (the reconciler + mutations
-- land in P3). No backfill, no default rows (migration-121 safety model).
--
-- DB column + mapper lockstep: ships with StrategyKeywordSetRow + the rowToX mapper in
-- server/domains/strategy/managed-keyword-set.ts (stub here, bodies in P3). Not on any
-- public-portal serialization list — the managed set is an admin-only curation surface.
CREATE TABLE IF NOT EXISTS strategy_keyword_set (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id  TEXT NOT NULL,
  keyword       TEXT NOT NULL,              -- normalized lowercase-trimmed
  source        TEXT NOT NULL CHECK(source IN ('regen_computed', 'client_request', 'manual_add')),
  kept_at       TEXT,                       -- ISO; set when operator explicitly keeps (survives regen)
  removed_at    TEXT,                       -- ISO; set when operator removes a slot (excluded from replenish)
  slot_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(workspace_id, keyword)
);
CREATE INDEX IF NOT EXISTS idx_strategy_keyword_set_ws ON strategy_keyword_set(workspace_id);
