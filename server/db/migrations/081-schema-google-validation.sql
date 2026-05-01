-- 081-schema-google-validation.sql
-- Adds google_validation_status and google_validation_details to schema_publish_history.
-- Status lifecycle: NULL (unpublished) → 'published' → 'google_validated' | 'google_failed' | 'no_gsc'
-- Tracked: schema-google-validation-v1

ALTER TABLE schema_publish_history
  ADD COLUMN google_validation_status TEXT;

ALTER TABLE schema_publish_history
  ADD COLUMN google_validation_details TEXT;
