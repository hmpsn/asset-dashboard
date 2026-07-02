#!/usr/bin/env tsx
/**
 * restore-drill.ts — Backup/restore drill (R0 backup-safety contract).
 *
 * Locates the latest available backup (local source: read in place; S3/R2 and
 * db-export: written into a scratch path), runs the data integrity engine
 * against the restored database, and diffs per-table row counts against the
 * backup's own `_manifest.json`. Exits non-zero on any count mismatch or
 * restore failure so it can gate CI/manual pre-flight checks (see
 * docs/workflows/data-integrity-recovery.md). The auto-created scratch dir is
 * removed on exit; a user-supplied --scratch-dir is left intact.
 *
 * Restore source precedence (first available wins):
 *   1. Local backup directory (BACKUP_DIR or DATA_DIR/backups) — the newest
 *      `backup-*` directory containing a `_manifest.json`.
 *   2. S3 (or S3-compatible, e.g. Cloudflare R2 via BACKUP_S3_ENDPOINT) —
 *      downloads and extracts the newest `backup-*.tar.gz` archive.
 *   3. `/api/admin/db-export` — pulls the live DB export directly from a
 *      running instance (APP_URL + APP_PASSWORD). This has no manifest, so
 *      the count-diff step is skipped and only the integrity report runs.
 *
 * Usage:
 *   npm run backup:restore-drill
 *   npm run backup:restore-drill -- --scratch-dir /tmp/my-drill
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { DATA_BASE } from '../server/data-dir.js';
import { makeBackupS3Client } from '../server/backup.js';
import { runDataIntegrityRecoveryReport } from './platform-data-integrity-recovery.js';

export interface BackupManifest {
  timestamp: string;
  files: number;
  bytes: number;
  dataBase: string;
  verified: boolean;
  tableCounts: Record<string, number>;
}

export interface CountMismatch {
  table: string;
  expected: number;
  actual: number;
}

/**
 * Pure diff between a backup manifest's recorded per-table row counts and the
 * counts actually read back from a restored database. A table present in the
 * manifest but absent from `restoredCounts` is treated as 0 (fully lost). A
 * table present in `restoredCounts` but absent from the manifest is NOT
 * flagged — that's a table created after the backup was taken, not data loss.
 */
export function diffManifestCounts(
  manifest: BackupManifest,
  restoredCounts: Record<string, number>,
): CountMismatch[] {
  const mismatches: CountMismatch[] = [];
  for (const [table, expected] of Object.entries(manifest.tableCounts)) {
    const actual = restoredCounts[table] ?? 0;
    if (actual !== expected) {
      mismatches.push({ table, expected, actual });
    }
  }
  return mismatches;
}

function getBackupRoot(): string {
  return process.env.BACKUP_DIR || (DATA_BASE ? path.join(DATA_BASE, 'backups') : path.join(process.env.HOME || '', '.asset-dashboard', 'backups'));
}

/** A controlled drill failure — caught in runRestoreDrill to exit non-zero with a clear message. */
class DrillError extends Error {}

/**
 * Read + parse a backup `_manifest.json`. A truncated/corrupt archive (or a
 * manifest missing its tableCounts) is a legitimate drill FAILURE, not an
 * unhandled crash — throw a DrillError so runRestoreDrill reports it and exits
 * non-zero. This is a CLI script, so a bare JSON.parse in a try/catch is fine
 * (parseJsonSafe is not required here).
 */
function readManifest(manifestPath: string): BackupManifest {
  let raw: string;
  try {
    raw = fs.readFileSync(manifestPath, 'utf-8');
  } catch (err) {
    throw new DrillError(`Could not read manifest at ${manifestPath}: ${err instanceof Error ? err.message : String(err)}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new DrillError(`Manifest at ${manifestPath} is not valid JSON (corrupt/truncated backup?): ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!parsed || typeof parsed !== 'object' || typeof (parsed as BackupManifest).tableCounts !== 'object') {
    throw new DrillError(`Manifest at ${manifestPath} is missing required fields (tableCounts).`);
  }
  return parsed as BackupManifest;
}

/** Find the most recently created local `backup-*` directory that has a manifest. */
function findLatestLocalBackup(): { backupDir: string; manifest: BackupManifest } | null {
  const backupRoot = getBackupRoot();
  if (!fs.existsSync(backupRoot)) return null;

  const candidates = fs.readdirSync(backupRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && entry.name.startsWith('backup-'))
    .map(entry => path.join(backupRoot, entry.name))
    .filter(dir => fs.existsSync(path.join(dir, '_manifest.json')))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);

  if (candidates.length === 0) return null;

  const backupDir = candidates[0];
  const manifest = readManifest(path.join(backupDir, '_manifest.json'));
  return { backupDir, manifest };
}

/** Download + extract the newest S3 (or S3-compatible) backup archive to a scratch dir. */
async function restoreFromS3(scratchDir: string): Promise<{ backupDir: string; manifest: BackupManifest } | null> {
  const bucket = process.env.BACKUP_S3_BUCKET;
  if (!bucket) return null;

  const prefix = process.env.BACKUP_S3_PREFIX || 'backups';

  const { S3Client, ListObjectsV2Command, GetObjectCommand } = await import('@aws-sdk/client-s3'); // dynamic-import-ok
  const client = makeBackupS3Client(S3Client);

  const listRes = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: `${prefix}/backup-` }));
  const objects = (listRes.Contents || [])
    .filter(obj => obj.Key && obj.LastModified)
    .sort((a, b) => (b.LastModified!.getTime()) - (a.LastModified!.getTime()));

  if (objects.length === 0) {
    console.log('  No S3 backup archives found.');
    return null;
  }

  const key = objects[0].Key!;
  console.log(`  → Downloading s3://${bucket}/${key}...`);
  const getRes = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const body = await getRes.Body?.transformToByteArray();
  if (!body) {
    console.error('  ✗ S3 object body was empty.');
    return null;
  }

  const archivePath = path.join(scratchDir, path.basename(key));
  fs.writeFileSync(archivePath, Buffer.from(body));
  execSync(`tar -xzf "${archivePath}" -C "${scratchDir}"`);

  const extractedDirName = path.basename(key).replace(/\.tar\.gz$/, '');
  const backupDir = path.join(scratchDir, extractedDirName);
  const manifestPath = path.join(backupDir, '_manifest.json');
  if (!fs.existsSync(manifestPath)) {
    console.error(`  ✗ Extracted archive has no _manifest.json at ${manifestPath}`);
    return null;
  }
  const manifest = readManifest(manifestPath);
  return { backupDir, manifest };
}

/** Fallback: pull the live DB export directly. No manifest, so count-diff is skipped. */
async function restoreFromDbExport(scratchDir: string): Promise<{ dbPath: string } | null> {
  const appUrl = process.env.APP_URL;
  const password = process.env.APP_PASSWORD;
  if (!appUrl || !password) return null;

  console.log(`  → Falling back to /api/admin/db-export from ${appUrl}...`);
  const res = await fetch(`${appUrl}/api/admin/db-export`, { headers: { 'x-auth-token': password } });
  if (!res.ok) {
    console.error(`  ✗ db-export fetch failed: HTTP ${res.status}`);
    return null;
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  const dbPath = path.join(scratchDir, 'dashboard.db');
  fs.writeFileSync(dbPath, buffer);
  return { dbPath };
}

async function readTableCountsFromDb(dbPath: string): Promise<Record<string, number>> {
  const { default: Database }: typeof import('better-sqlite3') = await import('better-sqlite3'); // dynamic-import-ok
  const db = new Database(dbPath, { readonly: true });
  try {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '\\_%' ESCAPE '\\'").all() as Array<{ name: string }>;
    const counts: Record<string, number> = {};
    for (const t of tables) {
      const row = db.prepare(`SELECT COUNT(*) as c FROM "${t.name}"`).get() as { c: number };
      counts[t.name] = row.c;
    }
    return counts;
  } finally {
    db.close();
  }
}

export async function runRestoreDrill(args: string[]): Promise<number> {
  const scratchFlagIndex = args.indexOf('--scratch-dir');
  const userScratchDir = scratchFlagIndex >= 0 && args[scratchFlagIndex + 1] ? args[scratchFlagIndex + 1] : null;
  // Only an auto-created temp dir is ours to delete; a user-supplied --scratch-dir
  // is left intact so they can inspect the restored artifacts afterward.
  const scratchDir = userScratchDir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'asset-dashboard-restore-drill-'));
  fs.mkdirSync(scratchDir, { recursive: true });

  console.log(`\nRestore drill — scratch dir: ${scratchDir}\n`);

  try {
    return await runDrillBody(scratchDir);
  } catch (err) {
    if (err instanceof DrillError) {
      console.error(`\n✗ Restore drill FAILED — ${err.message}\n`);
      return 1;
    }
    throw err;
  } finally {
    // Clean up ONLY the auto-created temp dir — every run leaks a full backup tar +
    // extracted DB otherwise, and the drill runs repeatedly on the 1 GB disk. Guard
    // in its own try/catch so a cleanup failure can't mask the real exit code.
    if (!userScratchDir) {
      try {
        fs.rmSync(scratchDir, { recursive: true, force: true });
      } catch (err) {
        console.warn(`  (warning) failed to clean up scratch dir ${scratchDir}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
}

async function runDrillBody(scratchDir: string): Promise<number> {
  // ── 1. Restore, trying local → S3 → db-export in order ──
  let restoredDbPath: string | null = null;
  let manifest: BackupManifest | null = null;

  console.log('Step 1: locate a backup to restore');
  const local = findLatestLocalBackup();
  if (local) {
    console.log(`  ✓ Using local backup: ${local.backupDir}`);
    restoredDbPath = path.join(local.backupDir, 'dashboard.db');
    manifest = local.manifest;
  } else {
    console.log('  No local backup found — trying S3...');
    const s3Result = await restoreFromS3(scratchDir);
    if (s3Result) {
      console.log(`  ✓ Using S3 backup: ${s3Result.backupDir}`);
      restoredDbPath = path.join(s3Result.backupDir, 'dashboard.db');
      manifest = s3Result.manifest;
    } else {
      console.log('  No S3 backup found — trying /api/admin/db-export...');
      const dbExportResult = await restoreFromDbExport(scratchDir);
      if (dbExportResult) {
        console.log(`  ✓ Using live db-export: ${dbExportResult.dbPath}`);
        restoredDbPath = dbExportResult.dbPath;
      }
    }
  }

  if (!restoredDbPath || !fs.existsSync(restoredDbPath)) {
    console.error('\n✗ No backup source was available (local, S3, or db-export). Cannot run drill.\n');
    return 1;
  }

  // ── 2. Run the integrity report against the restored DB ──
  console.log('\nStep 2: run data integrity report against restored DB');
  const integrityExitCode = runDataIntegrityRecoveryReport(['--db', restoredDbPath]);
  if (integrityExitCode !== 0) {
    console.error('\n✗ Data integrity report failed on the restored database.\n');
    return 1;
  }
  console.log('  ✓ Integrity report passed.');

  // ── 3. Diff per-table counts vs the manifest (skipped when there is no manifest) ──
  if (!manifest) {
    console.log('\nStep 3: skipped (no manifest available for this restore source — db-export fallback has no manifest).');
    console.log('\n✓ Restore drill passed (integrity-only; no manifest to diff).\n');
    return 0;
  }

  console.log('\nStep 3: diff restored table counts vs backup manifest');
  const restoredCounts = await readTableCountsFromDb(restoredDbPath);
  const mismatches = diffManifestCounts(manifest, restoredCounts);

  if (mismatches.length > 0) {
    console.error('\n✗ Restore drill FAILED — table count mismatches:\n');
    for (const m of mismatches) {
      console.error(`  ${m.table}: expected ${m.expected}, restored ${m.actual}`);
    }
    console.error('');
    return 1;
  }

  console.log('  ✓ All table counts match the manifest.');
  console.log('\n✓ Restore drill passed.\n');
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runRestoreDrill(process.argv.slice(2)).then(exitCode => process.exit(exitCode));
}
