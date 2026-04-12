-- 058-copy-pipeline.sql
-- Full Copy Pipeline tables (Phase 3)

-- ═══ COPY SECTIONS ═══
-- Each row = generated copy for one section of one blueprint entry

CREATE TABLE IF NOT EXISTS copy_sections (
  id                    TEXT PRIMARY KEY,
  workspace_id          TEXT NOT NULL,
  entry_id              TEXT NOT NULL REFERENCES blueprint_entries(id) ON DELETE CASCADE,
  section_plan_item_id  TEXT NOT NULL,
  generated_copy        TEXT,
  status                TEXT NOT NULL DEFAULT 'pending',
  ai_annotation         TEXT,
  ai_reasoning          TEXT,
  steering_history      TEXT NOT NULL DEFAULT '[]',
  client_suggestions    TEXT,
  quality_flags         TEXT,
  version               INTEGER NOT NULL DEFAULT 0,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_copy_sections_entry ON copy_sections(entry_id);
CREATE INDEX IF NOT EXISTS idx_copy_sections_status ON copy_sections(status);
CREATE INDEX IF NOT EXISTS idx_copy_sections_workspace ON copy_sections(workspace_id);

-- ═══ COPY METADATA ═══
-- SEO title, meta desc, OG tags per blueprint entry

CREATE TABLE IF NOT EXISTS copy_metadata (
  id                TEXT PRIMARY KEY,
  workspace_id      TEXT NOT NULL,
  entry_id          TEXT NOT NULL REFERENCES blueprint_entries(id) ON DELETE CASCADE,
  seo_title         TEXT,
  meta_description  TEXT,
  og_title          TEXT,
  og_description    TEXT,
  status            TEXT NOT NULL DEFAULT 'pending',
  steering_history  TEXT NOT NULL DEFAULT '[]',
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_copy_metadata_entry ON copy_metadata(workspace_id, entry_id);
CREATE INDEX IF NOT EXISTS idx_copy_metadata_workspace ON copy_metadata(workspace_id);

-- ═══ COPY INTELLIGENCE ═══
-- Workspace-level learned patterns from copy review

CREATE TABLE IF NOT EXISTS copy_intelligence (
  id              TEXT PRIMARY KEY,
  workspace_id    TEXT NOT NULL,
  pattern_type    TEXT NOT NULL,
  pattern         TEXT NOT NULL,
  source          TEXT,
  frequency       INTEGER NOT NULL DEFAULT 1,
  active          INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_copy_intelligence_workspace ON copy_intelligence(workspace_id);
CREATE INDEX IF NOT EXISTS idx_copy_intelligence_active ON copy_intelligence(workspace_id, active);

-- ═══ BATCH JOBS ═══
-- Persistent batch generation tracking (survives browser close)

CREATE TABLE IF NOT EXISTS copy_batch_jobs (
  id                    TEXT PRIMARY KEY,
  workspace_id          TEXT NOT NULL,
  blueprint_id          TEXT NOT NULL REFERENCES site_blueprints(id) ON DELETE CASCADE,
  mode                  TEXT NOT NULL DEFAULT 'review_inbox',
  entry_ids_json        TEXT NOT NULL DEFAULT '[]',
  batch_size            INTEGER NOT NULL DEFAULT 5,
  status                TEXT NOT NULL DEFAULT 'pending',
  progress_json         TEXT NOT NULL DEFAULT '{"total":0,"generated":0,"reviewed":0,"approved":0}',
  accumulated_steering  TEXT NOT NULL DEFAULT '[]',
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_copy_batch_workspace ON copy_batch_jobs(workspace_id);
CREATE INDEX IF NOT EXISTS idx_copy_batch_status ON copy_batch_jobs(status);

-- ═══ EXTEND CONTENT BRIEFS ═══
-- Track copy approval rate for brief quality feedback loop

ALTER TABLE content_briefs ADD COLUMN copy_approval_rate REAL;
