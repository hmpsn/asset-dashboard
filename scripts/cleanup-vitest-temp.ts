import fs from 'fs';
import os from 'os';
import path from 'path';

const WORKER_DIR_RE = /^asset-dashboard-vitest-(\d+)-.+$/;
const TEMPLATE_LOCK_RE = /^asset-dashboard-vitest-template-.+\.lock$/;
const DEFAULT_MAX_AGE_MINUTES = 60;

function readMaxAgeMinutes(): number {
  const arg = process.argv.find(value => value.startsWith('--max-age-minutes='));
  const raw = arg?.split('=')[1] ?? process.env.VITEST_TMP_MAX_AGE_MINUTES;
  if (!raw) return DEFAULT_MAX_AGE_MINUTES;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Invalid max age minutes: ${raw}`);
  }
  return parsed;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

const dryRun = process.argv.includes('--dry-run');
const maxAgeMinutes = readMaxAgeMinutes();
const cutoffMs = Date.now() - maxAgeMinutes * 60_000;
const tmpRoot = path.resolve(process.env.TMPDIR || os.tmpdir());

let scanned = 0;
let removed = 0;
let skippedActive = 0;
let skippedFresh = 0;
let failed = 0;

for (const entry of fs.readdirSync(tmpRoot)) {
  const workerMatch = WORKER_DIR_RE.exec(entry);
  const isTemplateLock = TEMPLATE_LOCK_RE.test(entry);
  if (!workerMatch && !isTemplateLock) continue;

  const fullPath = path.join(tmpRoot, entry);
  let stat: fs.Stats;
  try {
    stat = fs.statSync(fullPath);
  } catch {
    continue;
  }
  if (!stat.isDirectory()) continue;

  scanned += 1;
  if (stat.mtimeMs > cutoffMs) {
    skippedFresh += 1;
    continue;
  }

  if (workerMatch) {
    const pid = Number(workerMatch[1]);
    if (Number.isInteger(pid) && isProcessAlive(pid)) {
      skippedActive += 1;
      continue;
    }
  }

  if (!dryRun) {
    try {
      fs.rmSync(fullPath, { recursive: true, force: true });
    } catch {
      failed += 1;
      continue;
    }
  }
  removed += 1;
}

const mode = dryRun ? 'would remove' : 'removed';
console.log(`Vitest temp cleanup (${tmpRoot})`);
console.log(`Scanned: ${scanned}`);
console.log(`${mode}: ${removed}`);
console.log(`Skipped fresh: ${skippedFresh}`);
console.log(`Skipped active PID: ${skippedActive}`);
console.log(`Failed: ${failed}`);

if (failed > 0) {
  process.exitCode = 1;
}
