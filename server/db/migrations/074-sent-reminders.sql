-- Migration 074: persist sent reminder state across restarts
-- Replaces in-memory Set/Map in trial-reminders.ts and approval-reminders.ts
CREATE TABLE IF NOT EXISTS sent_reminders (
  key TEXT PRIMARY KEY,
  sent_at TEXT NOT NULL
);
