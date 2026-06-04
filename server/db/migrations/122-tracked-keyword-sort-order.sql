-- Wave 3c-iii-a — ADDITIVE sort_order order-preservation column for tracked_keywords.
--
-- INTERNAL ordering column, NEVER client-facing. It is read ONLY to ORDER BY the
-- tracked-keyword reads (listByWs); it is NOT projected into the TrackedKeyword
-- type by rowToTrackedKeyword and never leaks into getTrackedKeywords or the public
-- payloads. Its sole purpose is to preserve the verbatim-to-client list order
-- (the old blob array index) once the blob ordering is stripped in 3c-iii-b.
--
-- NULLABLE, NO DEFAULT — SQL cannot read the JSON blob's array index, so this
-- column is populated by:
--   (1) the boot backfill (migrateTrackedKeywordsFromConfigBlob), which reads the
--       LIVE rank_tracking_config.tracked_keywords blob and stamps sort_order = the
--       blob array index (with an append-fallback tail for table rows absent from
--       the blob), and
--   (2) every write (replaceAllTrackedKeywordRows), which RE-STAMPS sort_order from
--       the incoming array's positional index on every replace — delete-then-
--       reinsert would otherwise clobber the order. The canonical TrackedKeyword[]
--       passed to the writer IS the order (mirroring the old blob array).
--
-- Reads order by (sort_order ASC, added_at ASC, normalized_query ASC); the tail is a
-- deterministic tiebreaker for any transiently-NULL sort_order (NULLs sort first in
-- SQLite ASC, so a freshly-added-but-not-yet-stamped row would lead — the write path
-- re-stamps on the same txn, so this is only a transient-state guard). The blob write
-- and the empty-table blob fallback are KEPT until 3c-iii-b; this column moves only
-- the ORDERING off the blob array index, not the blob itself.

ALTER TABLE tracked_keywords ADD COLUMN sort_order INTEGER;

CREATE INDEX IF NOT EXISTS idx_tracked_keywords_sort ON tracked_keywords(workspace_id, sort_order);
