/**
 * Daily data backup — copies uploaded files and SQLite database to a timestamped backup directory.
 * 
 * Backs up: uploaded assets (images, brand docs) and the SQLite database.
 * JSON file backup is no longer needed since all data now lives in SQLite.
 * 
 * Retention is split by storage tier:
 *   - Local disk: keeps last 3 daily backups by default (BACKUP_RETENTION_DAYS) — kept tight
 *     because backups share the same disk as the live DB.
 *   - Off-site (S3/R2): keeps last 30 days by default (BACKUP_S3_RETENTION_DAYS) — the durable
 *     copy, retained much longer than the local disk copy.
 * Storage: local disk by default (DATA_DIR/backups/). Set BACKUP_DIR to override.
 * Off-site: when BACKUP_S3_BUCKET is set, uploads a tar.gz archive to S3 (or an S3-compatible
 * provider like Cloudflare R2 — set BACKUP_S3_ENDPOINT) after local backup.
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import Database from 'better-sqlite3';
import { z } from 'zod';
import { DATA_BASE, getUploadRoot } from './data-dir.js';
import db from './db/index.js';
import { createLogger } from './logger.js';
import type * as S3Mod from '@aws-sdk/client-s3';
import { isProgrammingError } from './errors.js';
import { parseJsonSafe } from './db/json-validation.js';

const log = createLogger('backup');

const BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Default local-disk backup retention in days, used when BACKUP_RETENTION_DAYS is unset.
 * Single source of truth — server/storage-stats.ts (report fallback + pruneBackups default)
 * and server/routes/health.ts (prune-backups route default) both import this constant instead
 * of hard-coding their own literal, so the three can never drift out of sync again.
 */
export const DEFAULT_BACKUP_RETENTION_DAYS = 3;
/** Default off-site (S3/R2) backup retention in days, used when BACKUP_S3_RETENTION_DAYS is unset. */
export const DEFAULT_BACKUP_S3_RETENTION_DAYS = 30;

// Local disk retention — kept tight because backups share the same disk as the live DB.
const RETENTION_DAYS = parseInt(process.env.BACKUP_RETENTION_DAYS || String(DEFAULT_BACKUP_RETENTION_DAYS), 10);
// Off-site (S3/R2) retention — the durable copy, kept much longer than the local disk copy.
const S3_RETENTION_DAYS = parseInt(process.env.BACKUP_S3_RETENTION_DAYS || String(DEFAULT_BACKUP_S3_RETENTION_DAYS), 10);
let backupStartupTimeout: ReturnType<typeof setTimeout> | null = null;
let backupInterval: ReturnType<typeof setInterval> | null = null;

function getBackupRoot(): string {
  const dir = process.env.BACKUP_DIR || (DATA_BASE ? path.join(DATA_BASE, 'backups') : path.join(process.env.HOME || '', '.asset-dashboard', 'backups'));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const backupManifestTimestampSchema = z.object({ timestamp: z.string().optional() });

/**
 * Backup posture, read from disk (not in-memory state) so it survives process
 * restarts and is checkable via HTTP without SSH. Surfaced by
 * GET /api/admin/storage-stats — see server/storage-stats.ts.
 */
export function getLastBackupAt(): string | null {
  const backupRoot = getBackupRoot();
  if (!fs.existsSync(backupRoot)) return null;

  let latest: string | null = null;
  for (const entry of fs.readdirSync(backupRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith('backup-')) continue;
    const manifestPath = path.join(backupRoot, entry.name, '_manifest.json');
    try {
      const raw = fs.readFileSync(manifestPath, 'utf-8');
      const manifest = parseJsonSafe(raw, backupManifestTimestampSchema, { timestamp: undefined }, { field: 'timestamp', table: '_manifest.json' });
      if (manifest.timestamp && (!latest || manifest.timestamp > latest)) {
        latest = manifest.timestamp;
      }
    } catch (err) { if (isProgrammingError(err)) log.warn({ err }, 'backup/getLastBackupAt: programming error'); /* skip unreadable/missing manifest */ }
  }
  return latest;
}

/** Whether an off-site (S3-compatible) backup destination is configured. */
export function isOffsiteConfigured(): boolean {
  return !!process.env.BACKUP_S3_BUCKET;
}

/**
 * Construct an S3 client from the BACKUP_S3_* env vars. Takes the `S3Client`
 * ctor as a param so callers keep their own lazy dynamic-import of
 * @aws-sdk/client-s3 (the SDK is only needed when off-site backups are used).
 *
 * BACKUP_S3_ENDPOINT supports S3-compatible providers (e.g. Cloudflare R2). R2
 * requires path-style addressing (forcePathStyle) — virtual-hosted-style bucket
 * URLs don't resolve against R2's endpoint. Only set these keys when an endpoint
 * is configured so the default AWS S3 construction (region-only) is unchanged.
 * Shared by server/backup.ts (uploadToS3) and scripts/restore-drill.ts so the
 * load-bearing R2 nuance lives in exactly one place.
 */
export function makeBackupS3Client<C>(S3Client: new (config: Record<string, unknown>) => C): C {
  const region = process.env.BACKUP_S3_REGION || 'us-east-1';
  const endpoint = process.env.BACKUP_S3_ENDPOINT;
  return new S3Client(endpoint ? { region, endpoint, forcePathStyle: true } : { region });
}

/** Recursively copy upload files (images, brand docs, etc.) from src to dest. */
function copyUploadFiles(src: string, dest: string, stats: { files: number; bytes: number }): void {
  if (!fs.existsSync(src)) return;
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      // Skip optimized images — only back up originals and meta
      if (entry.name === 'optimized') continue;
      fs.mkdirSync(destPath, { recursive: true });
      copyUploadFiles(srcPath, destPath, stats);
    } else {
      try {
        fs.copyFileSync(srcPath, destPath);
        stats.files++;
        stats.bytes += fs.statSync(destPath).size;
      } catch (err) {
        log.error({ err: err }, `Failed to copy ${srcPath}:`);
      }
    }
  }
}

/** Run a single backup cycle. */
export async function runBackup(): Promise<{ backupDir: string; files: number; bytes: number }> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const backupDir = path.join(getBackupRoot(), `backup-${timestamp}`);
  fs.mkdirSync(backupDir, { recursive: true });

  const stats = { files: 0, bytes: 0 };

  // 1. Back up uploads root (workspace images, brand docs, etc.)
  const uploadRoot = getUploadRoot();
  if (fs.existsSync(uploadRoot)) {
    const uploadDest = path.join(backupDir, 'uploads');
    fs.mkdirSync(uploadDest, { recursive: true });
    copyUploadFiles(uploadRoot, uploadDest, stats);
  }

  // 2. Back up SQLite database (synchronous via VACUUM INTO)
  let verified = false;
  let tableCounts: Record<string, number> = {};
  try {
    const dbBackupPath = path.join(backupDir, 'dashboard.db');
    db.exec(`VACUUM INTO '${dbBackupPath.replace(/'/g, "''")}'`);
    stats.files++;
    stats.bytes += fs.statSync(dbBackupPath).size;

    // 2b. Verify backup integrity
    try {
      const verifyDb = new Database(dbBackupPath, { readonly: true });
      try {
        const result = verifyDb.pragma('integrity_check') as Array<{ integrity_check: string }>;
        if (result[0]?.integrity_check !== 'ok') {
          log.error({ result }, 'SQLite backup integrity check FAILED');
        } else {
          // Verify the backup has data (not an empty database)
          const tables = verifyDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '\\_%' ESCAPE '\\'").all() as Array<{ name: string }>;
          for (const t of tables) {
            const row = verifyDb.prepare(`SELECT COUNT(*) as c FROM "${t.name}"`).get() as { c: number };
            tableCounts[t.name] = row.c;
          }
          verified = true;
          const totalRows = Object.values(tableCounts).reduce((a, b) => a + b, 0);
          log.info({ tableCount: tables.length, totalRows }, 'Backup verified');
        }
      } finally {
        verifyDb.close();
      }
    } catch (err) {
      log.error({ err }, 'SQLite backup verification failed');
    }
  } catch (err) {
    log.error({ err: err }, 'SQLite backup failed');
  }

  // 3. Write backup manifest
  const manifest = {
    timestamp: new Date().toISOString(),
    files: stats.files,
    bytes: stats.bytes,
    dataBase: DATA_BASE || '~/.asset-dashboard',
    verified,
    tableCounts,
  };
  fs.writeFileSync(path.join(backupDir, '_manifest.json'), JSON.stringify(manifest, null, 2));

  // 4. Upload to S3 if configured
  if (process.env.BACKUP_S3_BUCKET) {
    try {
      await uploadToS3(backupDir, timestamp);
    } catch (err) {
      log.error({ err }, 'S3 backup upload failed (local backup still available)');
    }
  }

  return { backupDir, ...stats };
}

// ── S3 Off-site Backup ──

async function uploadToS3(backupDir: string, timestamp: string): Promise<void> {
  const bucket = process.env.BACKUP_S3_BUCKET!;
  const prefix = process.env.BACKUP_S3_PREFIX || 'backups';

  // Dynamically import to avoid requiring @aws-sdk/client-s3 when S3 is not configured
  const { S3Client, PutObjectCommand, ListObjectsV2Command, DeleteObjectsCommand }: typeof S3Mod = await import('@aws-sdk/client-s3'); // dynamic-import-ok

  const client = makeBackupS3Client(S3Client);

  // Create a tar.gz archive of the backup directory
  const archiveName = `backup-${timestamp}.tar.gz`;
  const archivePath = path.join(path.dirname(backupDir), archiveName);
  execSync(`tar -czf "${archivePath}" -C "${path.dirname(backupDir)}" "${path.basename(backupDir)}"`);

  try {
    const archiveData = fs.readFileSync(archivePath);
    const key = `${prefix}/${archiveName}`;

    log.info({ bucket, key, sizeBytes: archiveData.length }, 'Uploading backup to S3');

    await client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: archiveData,
      ContentType: 'application/gzip',
    }));

    log.info({ bucket, key }, 'S3 backup upload complete');
  } finally {
    // Clean up local archive regardless of success/failure
    try { fs.unlinkSync(archivePath); } catch (err) { if (isProgrammingError(err)) log.warn({ err }, 'backup: programming error'); /* already gone */ }
  }

  // Prune old S3 backups beyond retention period
  await pruneS3Backups(client, bucket, prefix, ListObjectsV2Command, DeleteObjectsCommand);
}

async function pruneS3Backups(
  client: InstanceType<typeof import('@aws-sdk/client-s3').S3Client>,
  bucket: string,
  prefix: string,
  ListObjectsV2Command: typeof import('@aws-sdk/client-s3').ListObjectsV2Command,
  DeleteObjectsCommand: typeof import('@aws-sdk/client-s3').DeleteObjectsCommand,
): Promise<void> {
  const cutoff = new Date(Date.now() - S3_RETENTION_DAYS * 24 * 60 * 60 * 1000);

  const listRes = await client.send(new ListObjectsV2Command({
    Bucket: bucket,
    Prefix: `${prefix}/backup-`,
  }));

  const toDelete = (listRes.Contents || [])
    .filter(obj => obj.LastModified && obj.LastModified < cutoff && obj.Key)
    .map(obj => ({ Key: obj.Key! }));

  if (toDelete.length === 0) return;

  await client.send(new DeleteObjectsCommand({
    Bucket: bucket,
    Delete: { Objects: toDelete },
  }));

  log.info({ count: toDelete.length, bucket }, 'Pruned old S3 backups');
}

/** Remove backups older than retention period. */
function pruneOldBackups(): number {
  const backupRoot = getBackupRoot();
  if (!fs.existsSync(backupRoot)) return 0;

  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  let pruned = 0;

  for (const entry of fs.readdirSync(backupRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith('backup-')) continue;
    const dirPath = path.join(backupRoot, entry.name);
    try {
      const stat = fs.statSync(dirPath);
      if (stat.mtimeMs < cutoff) {
        fs.rmSync(dirPath, { recursive: true, force: true });
        pruned++;
      }
    } catch (err) { if (isProgrammingError(err)) log.warn({ err }, 'backup/pruneOldBackups: programming error'); /* skip */ }
  }

  return pruned;
}

/** Start the daily backup scheduler. */
export function startBackupScheduler(): void {
  if (backupStartupTimeout || backupInterval) return;

  async function runBackupCycle() {
    try {
      const result = await runBackup();
      const pruned = pruneOldBackups();
      log.info(`Daily backup complete: ${result.files} files, ${(result.bytes / 1024).toFixed(1)}KB → ${result.backupDir}${pruned > 0 ? ` (pruned ${pruned} old backup${pruned > 1 ? 's' : ''})` : ''}`);
    } catch (err) {
      log.error({ err: err }, 'Backup failed');
    }
  }

  // Run first backup shortly after startup (30 seconds delay)
  backupStartupTimeout = setTimeout(() => {
    backupStartupTimeout = null;
    void runBackupCycle();
  }, 30_000);

  // Then run every 24 hours
  backupInterval = setInterval(() => { void runBackupCycle(); }, BACKUP_INTERVAL_MS);

  log.info(`Backup scheduler started (every 24h, retain ${RETENTION_DAYS} days)`);
}

/** Stop the daily backup scheduler. Cancels both the startup delay timeout
 * (if the first backup hasn't fired yet) and the recurring 24h interval. */
export function stopBackupScheduler(): void {
  if (backupStartupTimeout) { clearTimeout(backupStartupTimeout); backupStartupTimeout = null; }
  if (backupInterval) { clearInterval(backupInterval); backupInterval = null; }
}
