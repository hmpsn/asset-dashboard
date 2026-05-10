-- 093-approval-batch-note.sql
-- Add optional note column to approval_batches for the Phase 1 send-to-client convention.
-- When present, the note converts a Decisions batch into a Conversations batch (PR 1.2 routing).
ALTER TABLE approval_batches ADD COLUMN note TEXT;
