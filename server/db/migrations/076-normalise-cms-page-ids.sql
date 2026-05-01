-- 076-normalise-cms-page-ids.sql
--
-- Normalise CMS synthetic page_id values to the canonical toCmsPageId() format
-- (cms-{path-with-slashes-as-dashes}) across all tables that key CMS pages.
--
-- Three legacy formats existed before this PR:
--   • cms-${path.replace(/\//g, '-')}        → cms--blog-post     (routes/webflow.ts, routes/jobs.ts: leading slash kept, doubled the dash)
--   • cms-${slug}                            → cms-blog/my-post   (schema-suggester.ts: leading slash stripped, interior slashes preserved)
--   • cms-${slug-with-slashes-already-out}   → cms-blog-my-post   (rare; matches canonical, untouched)
-- The canonical formula strips leading slash AND replaces interior slashes:
--   cms-${path.replace(/^\//, '').replace(/\//g, '-')} → cms-blog-my-post
--
-- Tables migrated (page_states from the original spec does not exist in this codebase):
--   • schema_validations      — UNIQUE(workspace_id, page_id) → collision risk
--   • schema_page_types       — PRIMARY KEY (site_id, page_id) → collision risk
--   • schema_publish_history  — PRIMARY KEY id only, no collision risk
--   • seo_changes             — PRIMARY KEY id only, no collision risk
--
-- Collision case: when both a cms--* and a cms-* row (or a cms-with-slashes row)
-- already exist for the same logical page, all formats fold to the same canonical
-- key. Pre-dedupe drops older rows by validated_at / updated_at before the UPDATE.
--
-- Out of scope: schema_snapshots.results is a JSON column with embedded pageId
-- fields. Any pre-existing snapshot may carry legacy-format pageIds in that JSON,
-- but snapshots are fully regenerated on the next schema-suggester run, so this
-- self-heals. Migrating JSON values in SQLite would be substantially more complex
-- and is not justified given the self-healing path.

-- ── schema_validations: pre-dedupe by validated_at (keep newest), then normalise ──
DELETE FROM schema_validations
WHERE id NOT IN (
  SELECT id FROM (
    SELECT id,
           ROW_NUMBER() OVER (
             PARTITION BY workspace_id,
               CASE
                 WHEN page_id LIKE 'cms--%' THEN REPLACE('cms-' || SUBSTR(page_id, 6), '/', '-')
                 WHEN page_id LIKE 'cms-%' THEN REPLACE(page_id, '/', '-')
                 ELSE page_id
               END
             ORDER BY datetime(validated_at) DESC, id DESC
           ) AS rn
    FROM schema_validations
  )
  WHERE rn = 1
);
-- Step 1: collapse double-dash legacy form to single-dash.
UPDATE schema_validations
SET page_id = 'cms-' || SUBSTR(page_id, 6)
WHERE page_id LIKE 'cms--%';
-- Step 2: replace interior slashes with dashes (handles the schema-suggester legacy form).
UPDATE schema_validations
SET page_id = REPLACE(page_id, '/', '-')
WHERE page_id LIKE 'cms-%/%';

-- ── schema_page_types: pre-dedupe by updated_at, then normalise ──
DELETE FROM schema_page_types
WHERE rowid NOT IN (
  SELECT rowid FROM (
    SELECT rowid,
           ROW_NUMBER() OVER (
             PARTITION BY site_id,
               CASE
                 WHEN page_id LIKE 'cms--%' THEN REPLACE('cms-' || SUBSTR(page_id, 6), '/', '-')
                 WHEN page_id LIKE 'cms-%' THEN REPLACE(page_id, '/', '-')
                 ELSE page_id
               END
             ORDER BY datetime(updated_at) DESC, rowid DESC
           ) AS rn
    FROM schema_page_types
  )
  WHERE rn = 1
);
UPDATE schema_page_types
SET page_id = 'cms-' || SUBSTR(page_id, 6)
WHERE page_id LIKE 'cms--%';
UPDATE schema_page_types
SET page_id = REPLACE(page_id, '/', '-')
WHERE page_id LIKE 'cms-%/%';

-- ── schema_publish_history: no unique constraint on page_id, plain UPDATE is safe ──
UPDATE schema_publish_history
SET page_id = 'cms-' || SUBSTR(page_id, 6)
WHERE page_id LIKE 'cms--%';
UPDATE schema_publish_history
SET page_id = REPLACE(page_id, '/', '-')
WHERE page_id LIKE 'cms-%/%';

-- ── seo_changes: no unique constraint on page_id, plain UPDATE is safe ──
UPDATE seo_changes
SET page_id = 'cms-' || SUBSTR(page_id, 6)
WHERE page_id LIKE 'cms--%';
UPDATE seo_changes
SET page_id = REPLACE(page_id, '/', '-')
WHERE page_id LIKE 'cms-%/%';
