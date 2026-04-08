/**
 * studio-config — key-value store for studio-level settings.
 *
 * Values are stored in the `studio_config` table (migration 050).
 * Use typed helpers (getBookingUrl / setBookingUrl) rather than the
 * raw get/set functions wherever possible.
 */
import db from './db/index.js';
import { createStmtCache } from './db/stmt-cache.js';

const stmts = createStmtCache(() => ({
  get:    db.prepare('SELECT value FROM studio_config WHERE key = ?'),
  upsert: db.prepare(`
    INSERT INTO studio_config (key, value, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `),
  delete: db.prepare('DELETE FROM studio_config WHERE key = ?'),
}));

export function getStudioConfig(key: string): string | null {
  const row = stmts().get.get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setStudioConfig(key: string, value: string): void {
  stmts().upsert.run(key, value);
}

export function deleteStudioConfig(key: string): void {
  stmts().delete.run(key);
}

// ── Typed helpers ─────────────────────────────────────────────────────────────

/** URL clients are directed to when they want to book a call with the team. */
export function getBookingUrl(): string | null {
  return getStudioConfig('booking_url');
}

export function setBookingUrl(url: string): void {
  setStudioConfig('booking_url', url);
}

export function clearBookingUrl(): void {
  deleteStudioConfig('booking_url');
}
