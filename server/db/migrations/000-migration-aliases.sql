-- Migration aliases: idempotent rename bridge.
--
-- When a migration file is renamed, the `_migrations` tracker (keyed by filename)
-- must be taught about the new name or the runner will try to re-apply the SQL
-- on existing databases. This migration runs FIRST (prefix `000-`) on every boot
-- and copies the applied_at timestamp from any old filename to its new filename,
-- but only if the old entry exists. INSERT OR IGNORE keeps it safe on fresh DBs.
--
-- Pattern for future renames: append a new pair here, never remove old pairs.
--
-- History:
--   2026-04 — 048 triple-prefix cleanup
--     048-meeting-briefs.sql           → 054-meeting-briefs.sql
--     048-site-intelligence-client-view.sql → 055-site-intelligence-client-view.sql

INSERT OR IGNORE INTO _migrations (name, applied_at)
SELECT '054-meeting-briefs.sql', applied_at
FROM _migrations
WHERE name = '048-meeting-briefs.sql';

INSERT OR IGNORE INTO _migrations (name, applied_at)
SELECT '055-site-intelligence-client-view.sql', applied_at
FROM _migrations
WHERE name = '048-site-intelligence-client-view.sql';
