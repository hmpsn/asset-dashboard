-- The Issue (operator-steering batch): per-rec operator overrides that survive the weekly regen.
-- One row per (workspace, rec_id). `title`/`insight` correct a rec's wording; `sort_order` sets the
-- client-facing running order. Keyed on rec_id (not the merge key) because applyLifecycleCarryOver
-- copies the rec id old→new across regen, so a rec_id-keyed override follows the rec automatically.
-- Applied ONLY at display boundaries (admin GET serialization + public projection) — never baked into
-- the recommendation_sets blob, so clearing an override restores the source wording.
CREATE TABLE IF NOT EXISTS rec_operator_override (
  workspace_id TEXT NOT NULL,
  rec_id       TEXT NOT NULL,
  title        TEXT,
  insight      TEXT,
  sort_order   INTEGER,
  updated_at   TEXT NOT NULL,
  PRIMARY KEY (workspace_id, rec_id),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);
