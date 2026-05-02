-- 084-schema-cms-field-target-mappings.sql
-- Persist per-collection schema concept field bindings for CMS-driven generation.

ALTER TABLE schema_cms_field_mappings
  ADD COLUMN field_mappings TEXT;
