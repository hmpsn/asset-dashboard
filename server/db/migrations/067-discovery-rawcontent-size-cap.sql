-- SQLite has no CHECK on TEXT length without a trigger. Install AFTER
-- INSERT/UPDATE triggers that ABORT when raw_content exceeds 1 MiB.
-- Keeps defense-in-depth parallel with the app-level MAX_TEXT_BYTES cap in
-- server/routes/discovery-ingestion.ts:35.

CREATE TRIGGER IF NOT EXISTS discovery_sources_raw_content_size_insert
BEFORE INSERT ON discovery_sources
FOR EACH ROW
WHEN length(NEW.raw_content) > 1048576
BEGIN
  SELECT RAISE(ABORT, 'discovery_sources.raw_content exceeds 1 MiB limit');
END;

CREATE TRIGGER IF NOT EXISTS discovery_sources_raw_content_size_update
BEFORE UPDATE OF raw_content ON discovery_sources
FOR EACH ROW
WHEN length(NEW.raw_content) > 1048576
BEGIN
  SELECT RAISE(ABORT, 'discovery_sources.raw_content exceeds 1 MiB limit');
END;
