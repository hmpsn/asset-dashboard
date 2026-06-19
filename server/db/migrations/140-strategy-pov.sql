-- The Issue (Lane B): the drafted "point of view" — one row per workspace, upserted on regenerate.
-- pov_json stores the resolved StrategyPov (override ∪ draft) as a TEXT JSON blob, parsed at the
-- read boundary via parseJsonSafe(strategyPovSchema). prompt_hash busts the cache when any signal
-- changes (curated rec id-set, each curated rec clientStatus/lifecycle, prose-edit version,
-- regenerate nonce). version bumps on every operator edit. Mirrors meeting_briefs (migration 054).
CREATE TABLE IF NOT EXISTS strategy_pov (
  workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  pov_json     TEXT NOT NULL DEFAULT '{}',
  prompt_hash  TEXT,
  version      INTEGER NOT NULL DEFAULT 0,
  generated_at TEXT,
  edited_at    TEXT
);
