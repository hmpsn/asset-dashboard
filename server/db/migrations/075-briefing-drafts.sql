-- 075-briefing-drafts.sql
-- Weekly client briefing drafts (admin review + publish lifecycle)

CREATE TABLE briefing_drafts (
  id              TEXT PRIMARY KEY,
  workspace_id    TEXT NOT NULL,
  week_of         TEXT NOT NULL,           -- YYYY-MM-DD (Monday of week, UTC)
  status          TEXT NOT NULL DEFAULT 'draft',  -- 'draft' | 'approved' | 'published' | 'skipped'
  stories         TEXT NOT NULL DEFAULT '[]',     -- JSON array: BriefingStory[]
  source_metadata TEXT,                    -- JSON: candidate count, model, generation_ms (admin-only telemetry)
  admin_note      TEXT,
  auto_published  INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  published_at    INTEGER,
  UNIQUE(workspace_id, week_of)
);
CREATE INDEX briefing_drafts_workspace_week ON briefing_drafts(workspace_id, week_of);
CREATE INDEX briefing_drafts_status ON briefing_drafts(workspace_id, status);

-- Per-workspace briefing toggles (column-on-workspaces convention)
ALTER TABLE workspaces ADD COLUMN auto_publish_briefings INTEGER NOT NULL DEFAULT 0;
ALTER TABLE workspaces ADD COLUMN auto_publish_after_hours INTEGER NOT NULL DEFAULT 24;
ALTER TABLE workspaces ADD COLUMN last_briefing_run_week_of TEXT;
