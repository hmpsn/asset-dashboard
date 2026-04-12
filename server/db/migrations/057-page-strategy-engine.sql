-- 057-page-strategy-engine.sql
-- Page Strategy Engine tables (Phase 2)

-- ═══ SITE BLUEPRINTS ═══

CREATE TABLE IF NOT EXISTS site_blueprints (
  id                TEXT PRIMARY KEY,
  workspace_id      TEXT NOT NULL,
  name              TEXT NOT NULL,
  version           INTEGER NOT NULL DEFAULT 1,
  status            TEXT NOT NULL DEFAULT 'draft',
  brandscript_id    TEXT,
  industry_type     TEXT,
  generation_inputs TEXT,
  notes             TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_site_blueprints_workspace ON site_blueprints(workspace_id);

-- ═══ BLUEPRINT ENTRIES ═══

CREATE TABLE IF NOT EXISTS blueprint_entries (
  id                  TEXT PRIMARY KEY,
  blueprint_id        TEXT NOT NULL REFERENCES site_blueprints(id) ON DELETE CASCADE,
  name                TEXT NOT NULL,
  page_type           TEXT NOT NULL,
  scope               TEXT NOT NULL DEFAULT 'included',
  sort_order          INTEGER NOT NULL DEFAULT 0,
  is_collection       INTEGER NOT NULL DEFAULT 0,
  primary_keyword     TEXT,
  secondary_keywords  TEXT,
  keyword_source      TEXT,
  section_plan        TEXT NOT NULL DEFAULT '[]',
  template_id         TEXT,
  matrix_id           TEXT,
  brief_id            TEXT,  -- FK to content_briefs (populated by Phase 3 auto-brief generation)
  notes               TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_blueprint_entries_blueprint ON blueprint_entries(blueprint_id);

-- ═══ BLUEPRINT VERSIONS ═══

CREATE TABLE IF NOT EXISTS blueprint_versions (
  id              TEXT PRIMARY KEY,
  blueprint_id    TEXT NOT NULL REFERENCES site_blueprints(id) ON DELETE CASCADE,
  version         INTEGER NOT NULL,
  snapshot        TEXT NOT NULL,
  change_notes    TEXT,
  created_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_blueprint_versions_blueprint ON blueprint_versions(blueprint_id);
