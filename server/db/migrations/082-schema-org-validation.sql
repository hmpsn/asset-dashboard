-- 082-schema-org-validation.sql
-- Adds schema.org validator results to schema_snapshots.
-- Status: NULL (never validated) → 'schema_org_validated' | 'schema_org_failed'

ALTER TABLE schema_snapshots ADD COLUMN schema_org_validation_status TEXT;
ALTER TABLE schema_snapshots ADD COLUMN schema_org_validation_details TEXT;
