/**
 * Vitest per-worker setup.
 *
 * Establishes an isolated DATA_DIR before importing the DB singleton so
 * parallel workers and spawned integration servers do not share SQLite state.
 * Then runs migrations for that worker-local DB and disables foreign keys for
 * legacy fixtures that insert ad-hoc workspace IDs.
 */
import { ensureIsolatedTestDataDir } from './test-data-dir.js';

ensureIsolatedTestDataDir();

const { default: db, runMigrations } = await import('../server/db/index.js');

runMigrations();
db.pragma('foreign_keys = OFF');
