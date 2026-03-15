/**
 * Vitest global setup — runs once before any worker threads start.
 * Ensures SQLite migrations are applied before parallel tests begin,
 * avoiding SQLITE_BUSY errors from concurrent migration attempts.
 */
import { runMigrations } from '../server/db/index.js';

export function setup() {
  runMigrations();
}
