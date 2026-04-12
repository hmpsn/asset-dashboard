-- 058-page-strategy-rename-json-columns.sql
-- Rename JSON columns in page strategy tables to use the _json suffix
-- (project convention). Migration 057 was applied before the naming fix in
-- commit 01ffd7b, so the columns were left without the suffix.
--
-- SQLite 3.25.0+ supports ALTER TABLE RENAME COLUMN natively.

ALTER TABLE site_blueprints
  RENAME COLUMN generation_inputs TO generation_inputs_json;

ALTER TABLE blueprint_entries
  RENAME COLUMN secondary_keywords TO secondary_keywords_json;

ALTER TABLE blueprint_entries
  RENAME COLUMN section_plan TO section_plan_json;

ALTER TABLE blueprint_versions
  RENAME COLUMN snapshot TO snapshot_json;
