-- Meeting briefs: one row per workspace, upserted on regenerate.
-- JSON columns store AI-generated sections as TEXT arrays.
-- metrics: At-a-Glance data assembled from intelligence slices (not AI).
-- prompt_hash: optional optimization to skip regeneration when data hasn't changed.

CREATE TABLE IF NOT EXISTS meeting_briefs (
  workspace_id       TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  generated_at       TEXT NOT NULL,
  situation_summary  TEXT NOT NULL,
  wins               TEXT NOT NULL DEFAULT '[]',
  attention          TEXT NOT NULL DEFAULT '[]',
  recommendations    TEXT NOT NULL DEFAULT '[]',
  blueprint_progress TEXT,
  prompt_hash        TEXT,
  metrics            TEXT NOT NULL DEFAULT '{}'
);

-- Layer 3 prompt assembly: per-workspace custom AI framing notes
ALTER TABLE workspaces ADD COLUMN custom_prompt_notes TEXT;
