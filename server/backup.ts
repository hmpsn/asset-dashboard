/**
 * Daily data backup — copies uploaded files and SQLite database to a timestamped backup directory.
 * 
 * Backs up: uploaded assets (images, brand docs) and the SQLite database.
 * JSON file backup is no longer needed since all data now lives in SQLite.
 * 
 * Retention: keeps last 3 daily backups (configurable via BACKUP_RETENTION_DAYS).
 * Storage: local disk by default (DATA_DIR/backups/). Set BACKUP_DIR to override.
 * Off-site: when BACKUP_S3_BUCKET is set, uploads a tar.gz archive to S3 after local backup.
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import Database from 'better-sqlite3';
import { DATA_BASE, getUploadRoot } from './data-dir.js';
import db from './db/index.js';
import { createLogger } from './logger.js';

const log = createLogger('backup');

const BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const RETENTION_DAYS = parseInt(process.env.BACKUP_RETENTION_DAYS || '3', 10);

function getBackupRoot(): string {
  const dir = process.env.BACKUP_DIR || (DATA_BASE ? path.join(DATA_BASE, 'backups') : path.join(process.env.HOME || '', '.asset-dashboard', 'backups'));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
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
  const region = process.env.BACKUP_S3_REGION || 'us-east-1';
  const prefix = process.env.BACKUP_S3_PREFIX || 'backups';

  // Dynamically import to avoid requiring @aws-sdk/client-s3 when S3 is not configured
  const { S3Client, PutObjectCommand, ListObjectsV2Command, DeleteObjectsCommand } = await import('@aws-sdk/client-s3');

  const client = new S3Client({ region });

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
    try { fs.unlinkSync(archivePath); } catch { /* already gone */ }
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
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);

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
    } catch { /* skip */ }
  }

  return pruned;
}

/** Start the daily backup scheduler. */
export function startBackupScheduler(): void {
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
  setTimeout(runBackupCycle, 30_000);

  // Then run every 24 hours
  setInterval(runBackupCycle, BACKUP_INTERVAL_MS);

  log.info(`Backup scheduler started (every 24h, retain ${RETENTION_DAYS} days)`);
}
