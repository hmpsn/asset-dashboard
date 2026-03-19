-- Migration 017: Add schema_types column to content_templates
-- Auto-populated from pageType via PAGE_TYPE_SCHEMA_MAP (D2: template→schema binding)

ALTER TABLE content_templates ADD COLUMN schema_types TEXT;
