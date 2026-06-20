-- The Issue (Phase 4 — trust ladder): per-workspace, per-archetype auto-send policy + the
-- consecutive-cycle trust counter. One row per (workspace, eligible archetype). `enabled` is the
-- operator opt-in (only settable once earned); `consecutive_cycles` is the latched streak of
-- weekly cycles in which the bucket was sent; `last_credited_week` is the ISO Monday (YYYY-MM-DD,
-- UTC) of the most recent crediting send. Only quick_win / technical archetypes are ever stored.
CREATE TABLE IF NOT EXISTS strategy_autosend_policy (
  workspace_id        TEXT NOT NULL,
  archetype           TEXT NOT NULL,
  enabled             INTEGER NOT NULL DEFAULT 0,
  consecutive_cycles  INTEGER NOT NULL DEFAULT 0,
  last_credited_week  TEXT,
  updated_at          TEXT NOT NULL,
  PRIMARY KEY (workspace_id, archetype),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);
