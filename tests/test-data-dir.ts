import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * Ensure tests in the current Vitest worker use an isolated data directory
 * before any server/db module reads DATA_DIR.
 */
export function ensureIsolatedTestDataDir(): string {
  if (process.env.ASSET_DASHBOARD_TEST_DATA_DIR_SET === '1' && process.env.DATA_DIR) {
    return process.env.DATA_DIR;
  }

  const workerId = process.env.VITEST_POOL_ID
    ?? process.env.VITEST_WORKER_ID
    ?? 'worker';
  const dir = path.join(os.tmpdir(), `asset-dashboard-vitest-${process.pid}-${workerId}`);

  fs.mkdirSync(dir, { recursive: true });
  process.env.DATA_DIR = dir;
  process.env.ASSET_DASHBOARD_TEST_DATA_DIR_SET = '1';

  return dir;
}
