-- 075-normalise-insight-page-ids.sql
--
-- Normalise full-URL page_id values in analytics_insights to relative paths.
-- GSC/GA4 insight generators previously stored full URLs (https://domain.com/path).
-- New writes use relative paths (/path); this migration backfills existing rows.
--
-- Rows whose page_id does not start with 'http' are untouched (already normalised,
-- synthetic keys like 'cannibalization::query', or audit_finding UUIDs).
--
-- The unique index on (workspace_id, COALESCE(page_id, '__workspace__'), insight_type)
-- (migration 037) means we must pre-dedupe rows that would collapse to the same
-- normalised key — e.g. http:// + https:// variants of the same logical page,
-- or rows with query strings vs. without. Without pre-dedupe a single collision
-- aborts the migration transaction and blocks server startup.

-- Step 0: Pre-dedupe rows that would collide after normalisation.
-- For each (workspace_id, post-normalisation key, insight_type) tuple, keep the
-- newest row by computed_at and delete the rest. The post-normalisation key
-- mirrors what runtime toInsightPageId(...) produces: pathname only, no
-- query string, no fragment.
DELETE FROM analytics_insights
WHERE id NOT IN (
  SELECT id FROM (
    SELECT id,
           ROW_NUMBER() OVER (
             PARTITION BY workspace_id,
               CASE
                 WHEN page_id LIKE 'http%'
                      AND INSTR(SUBSTR(page_id, INSTR(page_id, '://') + 3), '/') > 0
                 THEN
                   -- Extract pathname, then strip '?...' and '#...' to match runtime semantics
                   CASE
                     WHEN INSTR(SUBSTR(page_id, INSTR(page_id, '://') + 3
                                + INSTR(SUBSTR(page_id, INSTR(page_id, '://') + 3), '/') - 1), '?') > 0
                     THEN SUBSTR(page_id,
                                 INSTR(page_id, '://') + 3
                                 + INSTR(SUBSTR(page_id, INSTR(page_id, '://') + 3), '/') - 1,
                                 INSTR(SUBSTR(page_id, INSTR(page_id, '://') + 3
                                              + INSTR(SUBSTR(page_id, INSTR(page_id, '://') + 3), '/') - 1), '?') - 1)
                     WHEN INSTR(SUBSTR(page_id, INSTR(page_id, '://') + 3
                                + INSTR(SUBSTR(page_id, INSTR(page_id, '://') + 3), '/') - 1), '#') > 0
                     THEN SUBSTR(page_id,
                                 INSTR(page_id, '://') + 3
                                 + INSTR(SUBSTR(page_id, INSTR(page_id, '://') + 3), '/') - 1,
                                 INSTR(SUBSTR(page_id, INSTR(page_id, '://') + 3
                                              + INSTR(SUBSTR(page_id, INSTR(page_id, '://') + 3), '/') - 1), '#') - 1)
                     ELSE SUBSTR(page_id,
                                 INSTR(page_id, '://') + 3
                                 + INSTR(SUBSTR(page_id, INSTR(page_id, '://') + 3), '/') - 1)
                   END
                 WHEN page_id LIKE 'http%' THEN '/'
                 ELSE page_id
               END,
               insight_type
             ORDER BY datetime(computed_at) DESC, id DESC
           ) AS rn
    FROM analytics_insights
  )
  WHERE rn = 1
);

-- Step 1: Update rows that have a path after the host. Strip query string and fragment
-- to match runtime toInsightPageId(...) semantics (URL.pathname).
UPDATE analytics_insights
SET page_id =
  CASE
    WHEN INSTR(SUBSTR(page_id, INSTR(page_id, '://') + 3
                + INSTR(SUBSTR(page_id, INSTR(page_id, '://') + 3), '/') - 1), '?') > 0
    THEN SUBSTR(page_id,
                INSTR(page_id, '://') + 3
                + INSTR(SUBSTR(page_id, INSTR(page_id, '://') + 3), '/') - 1,
                INSTR(SUBSTR(page_id, INSTR(page_id, '://') + 3
                             + INSTR(SUBSTR(page_id, INSTR(page_id, '://') + 3), '/') - 1), '?') - 1)
    WHEN INSTR(SUBSTR(page_id, INSTR(page_id, '://') + 3
                + INSTR(SUBSTR(page_id, INSTR(page_id, '://') + 3), '/') - 1), '#') > 0
    THEN SUBSTR(page_id,
                INSTR(page_id, '://') + 3
                + INSTR(SUBSTR(page_id, INSTR(page_id, '://') + 3), '/') - 1,
                INSTR(SUBSTR(page_id, INSTR(page_id, '://') + 3
                             + INSTR(SUBSTR(page_id, INSTR(page_id, '://') + 3), '/') - 1), '#') - 1)
    ELSE SUBSTR(page_id,
                INSTR(page_id, '://') + 3
                + INSTR(SUBSTR(page_id, INSTR(page_id, '://') + 3), '/') - 1)
  END
WHERE page_id LIKE 'http%'
  AND INSTR(SUBSTR(page_id, INSTR(page_id, '://') + 3), '/') > 0;

-- Step 2: Handle bare-domain URLs with no path (e.g. https://example.com).
-- Should not occur in GSC data, but safe to handle.
UPDATE analytics_insights
SET page_id = '/'
WHERE page_id LIKE 'http%'
  AND INSTR(SUBSTR(page_id, INSTR(page_id, '://') + 3), '/') = 0;
