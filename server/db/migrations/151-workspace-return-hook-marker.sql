-- The Issue (Client) P1c — weekly email return-hook send marker.
-- Mirrors last_issue_pushed_week_of (migration for the Phase-3 pushed Issue cron): the weekly
-- return-hook cron stamps this ISO-week marker (YYYY-MM-DD Monday anchor) once per workspace per
-- week so a later tick in the same week is a no-op (cross-process idempotency backstop to the
-- per-recipient email throttle). NULL until the first send.
ALTER TABLE workspaces ADD COLUMN last_return_hook_sent_week_of TEXT;
