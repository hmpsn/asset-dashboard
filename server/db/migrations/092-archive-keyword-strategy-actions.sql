-- 092-archive-keyword-strategy-actions.sql
-- Archive all non-archived keyword_strategy client_actions.
-- The keyword_strategy source type is retired per IA redesign PR 1.0b.
-- Rows are preserved as archived (not deleted) for audit trail.
-- All statuses (pending, approved, completed, changes_requested) are archived
-- so no ghost rows remain that would be silently re-typed by rowToAction fallback.
-- Note: migration runs on server startup; no WS broadcast or activity-log entry
-- is emitted here — clients see the status change on next cache refresh.
UPDATE client_actions
SET status = 'archived', updated_at = datetime('now')
WHERE source_type = 'keyword_strategy' AND status != 'archived';
