-- The Issue (Phase 3): per-workspace idempotency marker for the pushed weekly Issue cron.
-- Mirrors `last_briefing_run_week_of` (migration 077): the ISO-week anchor (YYYY-MM-DD, the
-- Monday of the week, UTC) of the last cycle the weekly-Issue push fired for this workspace.
-- The cron pre-bakes the POV + rings the operator doorbell at most once per ISO week; this
-- column is the cross-process duplicate guard (the in-process mutex handles concurrent ticks).
ALTER TABLE workspaces ADD COLUMN last_issue_pushed_week_of TEXT;
