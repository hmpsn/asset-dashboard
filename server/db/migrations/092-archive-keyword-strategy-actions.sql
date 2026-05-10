-- 092-archive-keyword-strategy-actions.sql
-- Archive all pending keyword_strategy client_actions.
-- The keyword_strategy source type is retired per IA redesign PR 1.0b.
-- Rows are preserved as archived (not deleted) for audit trail.
UPDATE client_actions
SET status = 'archived', updated_at = datetime('now')
WHERE source_type = 'keyword_strategy' AND status = 'pending';
