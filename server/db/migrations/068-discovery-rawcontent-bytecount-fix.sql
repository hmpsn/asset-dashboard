-- Fix-up for migration 067.
--
-- Migration 067 used length(NEW.raw_content) which SQLite computes in
-- characters, not bytes, on TEXT values. For ASCII content the two are
-- numerically identical, but multi-byte Unicode (em dashes, curly quotes,
-- emoji — common in brand docs and discovery transcripts) drifts: a
-- 600,000-char string of 'é' is 1.2 MiB on disk but passes the
-- character-counting 1 MiB threshold.
--
-- length(CAST(... AS BLOB)) forces a byte-count measurement, matching the
-- app-layer MAX_TEXT_BYTES check in server/routes/discovery-ingestion.ts:35
-- (which operates on JavaScript strings, but the .max() check there is
-- against the byte length the runtime materializes from the HTTP body).

DROP TRIGGER IF EXISTS discovery_sources_raw_content_size_insert;
DROP TRIGGER IF EXISTS discovery_sources_raw_content_size_update;

CREATE TRIGGER discovery_sources_raw_content_size_insert
BEFORE INSERT ON discovery_sources
FOR EACH ROW
WHEN length(CAST(NEW.raw_content AS BLOB)) > 1048576
BEGIN
  SELECT RAISE(ABORT, 'discovery_sources.raw_content exceeds 1 MiB limit');
END;

CREATE TRIGGER discovery_sources_raw_content_size_update
BEFORE UPDATE OF raw_content ON discovery_sources
FOR EACH ROW
WHEN length(CAST(NEW.raw_content AS BLOB)) > 1048576
BEGIN
  SELECT RAISE(ABORT, 'discovery_sources.raw_content exceeds 1 MiB limit');
END;
