import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const TEST_ROOT = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TEST_ROOT, '..');

declare global {
  // Avoid duplicate exit/signal handlers when Vitest setup imports this helper
  // before many test files in the same worker process.
  // eslint-disable-next-line no-var
  var __assetDashboardTestDataDirCleanupRegistered: boolean | undefined;
}

function hashTemplateInputs(): string {
  const migrationsDir = path.join(REPO_ROOT, 'server/db/migrations');
  const files = fs.readdirSync(migrationsDir)
    .filter(file => file.endsWith('.sql'))
    .sort();
  const input = files.map((file) => {
    const stat = fs.statSync(path.join(migrationsDir, file));
    return `${file}:${stat.size}:${stat.mtimeMs}`;
  }).join('|');

  let hash = 5381;
  for (let i = 0; i < input.length; i += 1) {
    hash = ((hash << 5) + hash) ^ input.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}

function waitForTemplate(markerPath: string, lockDir: string): void {
  const started = Date.now();
  while (!fs.existsSync(markerPath)) {
    if (!fs.existsSync(lockDir)) {
      break;
    }
    if (Date.now() - started > 60_000) {
      throw new Error('Timed out waiting for Vitest DB template creation');
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
  }
}

function ensureMigratedTemplateDb(): string {
  const templateRoot = path.join(os.tmpdir(), `asset-dashboard-vitest-template-${hashTemplateInputs()}`);
  const dbPath = path.join(templateRoot, 'dashboard.db');
  const markerPath = path.join(templateRoot, '.ready');
  const lockDir = `${templateRoot}.lock`;

  if (fs.existsSync(markerPath) && fs.existsSync(dbPath)) {
    return dbPath;
  }

  try {
    fs.mkdirSync(lockDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    waitForTemplate(markerPath, lockDir);
    if (fs.existsSync(markerPath) && fs.existsSync(dbPath)) {
      return dbPath;
    }
    fs.rmSync(lockDir, { recursive: true, force: true });
    fs.mkdirSync(lockDir);
  }

  try {
    fs.rmSync(templateRoot, { recursive: true, force: true });
    fs.mkdirSync(templateRoot, { recursive: true });
    const result = spawnSync(
      process.execPath,
      ['--import', 'tsx', path.join(TEST_ROOT, 'create-db-template.ts')],
      {
        cwd: REPO_ROOT,
        env: {
          ...process.env,
          DATA_DIR: templateRoot,
          NODE_ENV: 'test',
          LOG_LEVEL: 'silent',
        },
        encoding: 'utf8',
      },
    );

    if (result.status !== 0) {
      throw new Error(
        `Failed to create Vitest DB template:\n${result.stdout || ''}${result.stderr || ''}`,
      );
    }

    fs.writeFileSync(markerPath, new Date().toISOString(), 'utf8');
    return dbPath;
  } finally {
    fs.rmSync(lockDir, { recursive: true, force: true });
  }
}

function copyTemplateDb(dataDir: string): void {
  const source = ensureMigratedTemplateDb();
  const dest = path.join(dataDir, 'dashboard.db');
  if (fs.existsSync(dest)) return;
  fs.copyFileSync(source, dest);
}

function isWorkerDataDir(dataDir: string): boolean {
  const tmpRoot = path.resolve(os.tmpdir());
  const resolved = path.resolve(dataDir);
  return (
    resolved.startsWith(`${tmpRoot}${path.sep}`)
    && /^asset-dashboard-vitest-\d+-[^/]+$/.test(path.basename(resolved))
  );
}

function removeWorkerDataDir(dataDir: string): void {
  if (process.env.ASSET_DASHBOARD_TEST_PRESERVE_DATA_DIR === '1') return;
  if (!isWorkerDataDir(dataDir)) return;

  try {
    fs.rmSync(dataDir, { recursive: true, force: true });
  } catch {
    // Best effort: a failed temp cleanup should never mask the test result.
  }
}

function registerWorkerDataDirCleanup(dataDir: string): void {
  if (globalThis.__assetDashboardTestDataDirCleanupRegistered) return;
  globalThis.__assetDashboardTestDataDirCleanupRegistered = true;

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    removeWorkerDataDir(dataDir);
  };

  process.once('exit', cleanup);

  const handleSignal = (signal: NodeJS.Signals) => {
    cleanup();
    process.exit(signal === 'SIGINT' ? 130 : 143);
  };
  process.once('SIGINT', handleSignal);
  process.once('SIGTERM', handleSignal);
}

/**
 * Ensure tests in the current Vitest worker use an isolated data directory
 * before any server/db module reads DATA_DIR.
 */
export function ensureIsolatedTestDataDir(): string {
  if (process.env.ASSET_DASHBOARD_TEST_DATA_DIR_SET === '1' && process.env.DATA_DIR) {
    const currentTemplateHash = hashTemplateInputs();
    const workerTemplateHash = process.env.ASSET_DASHBOARD_TEST_DB_TEMPLATE_HASH;
    if (workerTemplateHash && workerTemplateHash !== currentTemplateHash) {
      throw new Error(
        'Vitest DB migrations changed after this worker opened its isolated database. '
        + 'Restart Vitest so the worker DB can be recreated from the latest migration template.',
      );
    }
    registerWorkerDataDirCleanup(process.env.DATA_DIR);
    return process.env.DATA_DIR;
  }

  const templateHash = hashTemplateInputs();
  const workerId = process.env.VITEST_POOL_ID
    ?? process.env.VITEST_WORKER_ID
    ?? 'worker';
  const dir = path.join(os.tmpdir(), `asset-dashboard-vitest-${process.pid}-${workerId}`);

  fs.mkdirSync(dir, { recursive: true });
  copyTemplateDb(dir);
  process.env.DATA_DIR = dir;
  process.env.ASSET_DASHBOARD_TEST_DATA_DIR_SET = '1';
  process.env.ASSET_DASHBOARD_TEST_DB_TEMPLATE_HASH = templateHash;
  registerWorkerDataDirCleanup(dir);

  return dir;
}
