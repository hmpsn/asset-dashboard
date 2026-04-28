/**
 * DB-backed sent-reminder tracking.
 *
 * Replaces the in-memory Set/Map previously used by trial-reminders.ts and
 * approval-reminders.ts so that state survives deploys/restarts.
 */
import db from './db/index.js';
import { createStmtCache } from './db/stmt-cache.js';

const stmts = createStmtCache(() => ({
  check: db.prepare(`SELECT sent_at FROM sent_reminders WHERE key = ?`),
  upsert: db.prepare(`INSERT OR REPLACE INTO sent_reminders (key, sent_at) VALUES (?, datetime('now'))`),
  insert: db.prepare(`INSERT OR IGNORE INTO sent_reminders (key, sent_at) VALUES (?, datetime('now'))`),
  delete: db.prepare(`DELETE FROM sent_reminders WHERE key = ?`),
  prune: db.prepare(`DELETE FROM sent_reminders WHERE sent_at < datetime('now', ?)`),
}));

/** Returns true if the key has already been recorded. */
export function hasReminder(key: string): boolean {
  return !!stmts().check.get(key);
}

/** Returns the sent_at timestamp (UTC ISO string) or null. */
export function getReminderSentAt(key: string): string | null {
  const row = stmts().check.get(key) as { sent_at: string } | undefined;
  if (!row) return null;
  // SQLite datetime('now') returns 'YYYY-MM-DD HH:MM:SS' without timezone;
  // append 'Z' so JS Date parses it as UTC (matching SQLite's UTC storage).
  const raw = row.sent_at;
  return raw.endsWith('Z') ? raw : raw + 'Z';
}

/** Record a reminder as sent (INSERT OR IGNORE — won't overwrite). */
export function markReminderSent(key: string): void {
  stmts().insert.run(key);
}

/** Record or update a reminder timestamp (INSERT OR REPLACE). */
export function upsertReminder(key: string): void {
  stmts().upsert.run(key);
}

/** Remove a specific reminder key. */
export function deleteReminder(key: string): void {
  stmts().delete.run(key);
}

/** Prune entries older than the given SQLite modifier (e.g. '-30 days'). */
export function pruneReminders(olderThan: string): void {
  stmts().prune.run(olderThan);
}
