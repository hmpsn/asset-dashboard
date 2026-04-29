-- 076-normalise-cms-page-ids.sql
--
-- Normalise CMS synthetic page_id values from double-dash format (cms--blog-post)
-- to single-dash format (cms-blog-post) across all tables that key CMS pages.
--
-- Double-dash arose because the old formula was cms-${path.replace(/\//g, '-')}
-- which kept the leading slash, producing cms--blog-post for /blog-post.
-- The new toCmsPageId canonical formula strips the leading slash first.
--
-- Tables migrated (page_states from the original spec does not exist in this codebase):
--   • schema_validations  — UNIQUE(workspace_id, page_id) → collision risk
--   • schema_page_types   — PRIMARY KEY (site_id, page_id) → collision risk
--   • schema_publish_history  — PRIMARY KEY id only, no collision risk
--   • seo_changes         — PRIMARY KEY id only, no collision risk
--
-- Collision case: schema-suggester previously produced cms-{slug} (no leading slash)
-- while the route generators produced cms--{path} (with leading slash). After this
-- migration both converge on cms-{path-with-slashes-as-dashes}, so a workspace that
-- has rows from both writers would see UNIQUE-constraint collisions. We pre-dedupe
-- collision tables before the UPDATE, keeping the newer row.

-- ── schema_validations: pre-dedupe by validated_at (keep newest), then normalise ──
DELETE FROM schema_validations
WHERE id NOT IN (
  SELECT id FROM (
    SELECT id,
           ROW_NUMBER() OVER (
             PARTITION BY workspace_id,
               CASE WHEN page_id LIKE 'cms--%' THEN 'cms-' || SUBSTR(page_id, 6) ELSE page_id END
             ORDER BY datetime(validated_at) DESC, id DESC
           ) AS rn
    FROM schema_validations
  )
  WHERE rn = 1
);
UPDATE schema_validations
SET page_id = 'cms-' || SUBSTR(page_id, 6)
WHERE page_id LIKE 'cms--%';

-- ── schema_page_types: pre-dedupe by updated_at, then normalise ──
DELETE FROM schema_page_types
WHERE rowid NOT IN (
  SELECT rowid FROM (
    SELECT rowid,
           ROW_NUMBER() OVER (
             PARTITION BY site_id,
               CASE WHEN page_id LIKE 'cms--%' THEN 'cms-' || SUBSTR(page_id, 6) ELSE page_id END
             ORDER BY datetime(updated_at) DESC, rowid DESC
           ) AS rn
    FROM schema_page_types
  )
  WHERE rn = 1
);
UPDATE schema_page_types
SET page_id = 'cms-' || SUBSTR(page_id, 6)
WHERE page_id LIKE 'cms--%';

-- ── schema_publish_history: no unique constraint on page_id, plain UPDATE is safe ──
UPDATE schema_publish_history
SET page_id = 'cms-' || SUBSTR(page_id, 6)
WHERE page_id LIKE 'cms--%';

-- ── seo_changes: no unique constraint on page_id, plain UPDATE is safe ──
UPDATE seo_changes
SET page_id = 'cms-' || SUBSTR(page_id, 6)
WHERE page_id LIKE 'cms--%';
