-- 083-schema-cms-field-mappings.sql
-- Collection-level schema role and JSON-LD field mapping.

CREATE TABLE IF NOT EXISTS schema_cms_field_mappings (
  site_id            TEXT NOT NULL,
  collection_id      TEXT NOT NULL,
  collection_name    TEXT NOT NULL,
  collection_slug    TEXT NOT NULL,
  schema_field_slug  TEXT,
  collection_role    TEXT,
  updated_at         TEXT NOT NULL,
  PRIMARY KEY (site_id, collection_id)
);

CREATE INDEX IF NOT EXISTS idx_schema_cms_field_mappings_site
  ON schema_cms_field_mappings(site_id);
