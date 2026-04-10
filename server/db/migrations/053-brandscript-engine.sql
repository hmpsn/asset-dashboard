-- 053-brandscript-engine.sql
-- Brandscript Engine + Voice Calibration tables

-- ═══ BRANDSCRIPT BUILDER ═══

CREATE TABLE IF NOT EXISTS brandscript_templates (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  sections_json TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS brandscripts (
  id              TEXT PRIMARY KEY,
  workspace_id    TEXT NOT NULL,
  name            TEXT NOT NULL,
  framework_type  TEXT NOT NULL DEFAULT 'storybrand',
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_brandscripts_workspace ON brandscripts(workspace_id);

CREATE TABLE IF NOT EXISTS brandscript_sections (
  id              TEXT PRIMARY KEY,
  brandscript_id  TEXT NOT NULL REFERENCES brandscripts(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  purpose         TEXT,
  content         TEXT,
  sort_order      INTEGER NOT NULL,
  created_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_brandscript_sections_brandscript ON brandscript_sections(brandscript_id);

-- ═══ DISCOVERY INGESTION ═══

CREATE TABLE IF NOT EXISTS discovery_sources (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL,
  filename      TEXT NOT NULL,
  source_type   TEXT NOT NULL,
  raw_content   TEXT NOT NULL,
  processed_at  TEXT,
  created_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_discovery_sources_workspace ON discovery_sources(workspace_id);

CREATE TABLE IF NOT EXISTS discovery_extractions (
  id              TEXT PRIMARY KEY,
  source_id       TEXT NOT NULL REFERENCES discovery_sources(id) ON DELETE CASCADE,
  workspace_id    TEXT NOT NULL,
  extraction_type TEXT NOT NULL,
  category        TEXT NOT NULL,
  content         TEXT NOT NULL,
  source_quote    TEXT,
  confidence      TEXT NOT NULL DEFAULT 'medium',
  status          TEXT NOT NULL DEFAULT 'pending',
  routed_to       TEXT,
  created_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_discovery_extractions_workspace ON discovery_extractions(workspace_id);
CREATE INDEX IF NOT EXISTS idx_discovery_extractions_source ON discovery_extractions(source_id);

-- ═══ VOICE CALIBRATION ═══

CREATE TABLE IF NOT EXISTS voice_profiles (
  id                      TEXT PRIMARY KEY,
  workspace_id            TEXT NOT NULL UNIQUE,
  status                  TEXT NOT NULL DEFAULT 'draft',
  voice_dna_json          TEXT,
  guardrails_json         TEXT,
  context_modifiers_json  TEXT,
  created_at              TEXT NOT NULL,
  updated_at              TEXT NOT NULL
);

-- UNIQUE on workspace_id already creates an implicit index, but keep the
-- named one for clarity and for any future query planner visibility.
CREATE INDEX IF NOT EXISTS idx_voice_profiles_workspace ON voice_profiles(workspace_id);

CREATE TABLE IF NOT EXISTS voice_samples (
  id                TEXT PRIMARY KEY,
  voice_profile_id  TEXT NOT NULL REFERENCES voice_profiles(id) ON DELETE CASCADE,
  content           TEXT NOT NULL,
  context_tag       TEXT,
  source            TEXT,
  sort_order        INTEGER,
  created_at        TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_voice_samples_profile ON voice_samples(voice_profile_id);

CREATE TABLE IF NOT EXISTS voice_calibration_sessions (
  id                TEXT PRIMARY KEY,
  voice_profile_id  TEXT NOT NULL REFERENCES voice_profiles(id) ON DELETE CASCADE,
  prompt_type       TEXT NOT NULL,
  variations_json   TEXT NOT NULL,
  steering_notes    TEXT,
  created_at        TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_voice_calibration_profile ON voice_calibration_sessions(voice_profile_id);

-- ═══ BRAND IDENTITY ═══

CREATE TABLE IF NOT EXISTS brand_identity_deliverables (
  id                TEXT PRIMARY KEY,
  workspace_id      TEXT NOT NULL,
  deliverable_type  TEXT NOT NULL,
  content           TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'draft',
  version           INTEGER NOT NULL DEFAULT 1,
  tier              TEXT NOT NULL DEFAULT 'essentials',
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_brand_identity_workspace ON brand_identity_deliverables(workspace_id);

CREATE TABLE IF NOT EXISTS brand_identity_versions (
  id              TEXT PRIMARY KEY,
  deliverable_id  TEXT NOT NULL REFERENCES brand_identity_deliverables(id) ON DELETE CASCADE,
  content         TEXT NOT NULL,
  steering_notes  TEXT,
  version         INTEGER NOT NULL,
  created_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_brand_identity_versions_deliverable ON brand_identity_versions(deliverable_id);

-- ═══ SEED: Default StoryBrand template ═══

INSERT OR IGNORE INTO brandscript_templates (id, name, description, sections_json, created_at)
VALUES (
  'tmpl_storybrand',
  'StoryBrand BrandScript',
  'Donald Miller''s StoryBrand framework — Character, Problem, Guide, Plan, CTA, Stakes, Success',
  '[{"title":"Hook","purpose":"Set the stage — the opening that captures attention and frames the brand story"},{"title":"Character","purpose":"Who is the customer? What do they want? Their desires and aspirations"},{"title":"Problem","purpose":"External problem (tangible frustration), Internal problem (emotional struggle), Philosophical problem (bigger picture)"},{"title":"Guide","purpose":"Why is this brand the right choice? Empathy (we understand) + Authority (we can help)"},{"title":"Plan","purpose":"Simple steps the customer takes to engage — make it easy and clear"},{"title":"Call to Action","purpose":"Primary CTA (main action) + Secondary CTA (lower commitment alternative)"},{"title":"Failure","purpose":"What is at stake if they do not act? The negative consequences of inaction"},{"title":"Success","purpose":"What transformation do they experience? The positive outcome of choosing this brand"}]',
  '2026-03-26T00:00:00.000Z'
);
