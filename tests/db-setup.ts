/**
 * Vitest per-worker setup.
 *
 * Establishes an isolated DATA_DIR before importing the DB singleton so
 * parallel workers and spawned integration servers do not share SQLite state.
 * Copies a migrated template DB into the worker-local DATA_DIR, then opens the
 * DB singleton and disables foreign keys for legacy fixtures that insert ad-hoc
 * workspace IDs.
 */
import { ensureIsolatedTestDataDir } from './test-data-dir.js';

declare global {
  // Vitest setup files run before each test file. Keep expensive migration work
  // to once per worker context while preserving each worker's isolated DATA_DIR.
  // eslint-disable-next-line no-var
  var __assetDashboardDbSetupDone: boolean | undefined;
}

ensureIsolatedTestDataDir();

if (!globalThis.__assetDashboardDbSetupDone) {
  const { default: db } = await import('../server/db/index.js');

  db.pragma('foreign_keys = OFF');
  globalThis.__assetDashboardDbSetupDone = true;
}
