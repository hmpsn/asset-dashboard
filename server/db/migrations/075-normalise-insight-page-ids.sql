-- 075-normalise-insight-page-ids.sql
--
-- Normalise full-URL page_id values in analytics_insights to relative paths.
-- GSC/GA4 insight generators previously stored full URLs (https://domain.com/path).
-- New writes use relative paths (/path); this migration backfills existing rows.
--
-- Rows whose page_id does not start with 'http' are untouched (already normalised,
-- synthetic keys like 'cannibalization::query', or audit_finding UUIDs).
--
-- Step 1: Update rows that have a path after the host.
-- Formula: skip '://' + 3 chars to reach host, find first '/' in host segment,
-- then take SUBSTR from that position.
UPDATE analytics_insights
SET page_id = SUBSTR(
  page_id,
  INSTR(page_id, '://') + 3
  + INSTR(SUBSTR(page_id, INSTR(page_id, '://') + 3), '/')
  - 1
)
WHERE page_id LIKE 'http%'
  AND INSTR(SUBSTR(page_id, INSTR(page_id, '://') + 3), '/') > 0;

-- Step 2: Handle bare-domain URLs with no path (e.g. https://example.com).
-- Should not occur in GSC data, but safe to handle.
UPDATE analytics_insights
SET page_id = '/'
WHERE page_id LIKE 'http%'
  AND INSTR(SUBSTR(page_id, INSTR(page_id, '://') + 3), '/') = 0;
