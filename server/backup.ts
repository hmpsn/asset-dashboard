/**
 * Daily data backup — copies critical JSON data files to a timestamped backup directory.
 * 
 * Backs up: workspace config, client users, auth data, reports, schemas, payments,
 * content requests, chat sessions, activity logs, rank tracking, annotations, etc.
 * 
 * Retention: keeps last 3 daily backups (configurable via BACKUP_RETENTION_DAYS).
 * Storage: local disk by default (DATA_DIR/backups/). Set BACKUP_DIR to override.
 * 
 * Future: add S3/GCS upload when cloud credentials are configured.
 */

import fs from 'fs';
import path from 'path';
import { DATA_BASE, getDataDir, getUploadRoot } from './data-dir.js';
import db from './db/index.js';

const BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const RETENTION_DAYS = parseInt(process.env.BACKUP_RETENTION_DAYS || '3', 10);

function getBackupRoot(): string {
  const dir = process.env.BACKUP_DIR || (DATA_BASE ? path.join(DATA_BASE, 'backups') : path.join(process.env.HOME || '', '.asset-dashboard', 'backups'));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Recursively copy JSON files from src to dest, preserving directory structure. */
function copyJsonFiles(src: string, dest: string, stats: { files: number; bytes: number }): void {
  if (!fs.existsSync(src)) return;
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      // Skip optimized images — only back up config/data files
      if (entry.name === 'optimized' || entry.name === 'meta') continue;
      fs.mkdirSync(destPath, { recursive: true });
      copyJsonFiles(srcPath, destPath, stats);
    } else if (entry.name.endsWith('.json') || entry.name.startsWith('.')) {
      // Copy JSON data files and dot-files (like .workspaces.json)
      try {
        fs.copyFileSync(srcPath, destPath);
        stats.files++;
        stats.bytes += fs.statSync(destPath).size;
      } catch (err) {
        console.error(`[backup] Failed to copy ${srcPath}:`, err);
      }
    }
  }
}

/** Run a single backup cycle. */
export function runBackup(): { backupDir: string; files: number; bytes: number } {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const backupDir = path.join(getBackupRoot(), `backup-${timestamp}`);
  fs.mkdirSync(backupDir, { recursive: true });

  const stats = { files: 0, bytes: 0 };

  // 1. Back up uploads root (workspace configs, dot-files)
  const uploadRoot = getUploadRoot();
  if (fs.existsSync(uploadRoot)) {
    const uploadDest = path.join(backupDir, 'uploads');
    fs.mkdirSync(uploadDest, { recursive: true });
    copyJsonFiles(uploadRoot, uploadDest, stats);
  }

  // 2. Back up named data directories
  const dataDirs = ['auth', 'reports', 'schemas', 'payments', 'content-requests', 'chat', 'activity', 'rank-tracking', 'annotations', 'redirects', 'sales-reports', 'stripe', 'email-queue', 'jobs'];
  for (const sub of dataDirs) {
    try {
      const srcDir = getDataDir(sub);
      if (fs.existsSync(srcDir) && fs.readdirSync(srcDir).length > 0) {
        const destDir = path.join(backupDir, sub);
        fs.mkdirSync(destDir, { recursive: true });
        copyJsonFiles(srcDir, destDir, stats);
      }
    } catch { /* directory doesn't exist yet */ }
  }

  // 3. Back up SQLite database (synchronous via VACUUM INTO)
  try {
    const dbBackupPath = path.join(backupDir, 'dashboard.db');
    db.exec(`VACUUM INTO '${dbBackupPath.replace(/'/g, "''")}'`);
    stats.files++;
    stats.bytes += fs.statSync(dbBackupPath).size;
  } catch (err) {
    console.error('[backup] SQLite backup failed:', err);
  }

  // 4. Write backup manifest
  const manifest = {
    timestamp: new Date().toISOString(),
    files: stats.files,
    bytes: stats.bytes,
    dataBase: DATA_BASE || '~/.asset-dashboard',
  };
  fs.writeFileSync(path.join(backupDir, '_manifest.json'), JSON.stringify(manifest, null, 2));

  return { backupDir, ...stats };
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
  // Run first backup shortly after startup (30 seconds delay)
  setTimeout(() => {
    try {
      const result = runBackup();
      const pruned = pruneOldBackups();
      console.log(`[backup] Daily backup complete: ${result.files} files, ${(result.bytes / 1024).toFixed(1)}KB → ${result.backupDir}${pruned > 0 ? ` (pruned ${pruned} old backup${pruned > 1 ? 's' : ''})` : ''}`);
    } catch (err) {
      console.error('[backup] Backup failed:', err);
    }
  }, 30_000);

  // Then run every 24 hours
  setInterval(() => {
    try {
      const result = runBackup();
      const pruned = pruneOldBackups();
      console.log(`[backup] Daily backup complete: ${result.files} files, ${(result.bytes / 1024).toFixed(1)}KB${pruned > 0 ? ` (pruned ${pruned})` : ''}`);
    } catch (err) {
      console.error('[backup] Backup failed:', err);
    }
  }, BACKUP_INTERVAL_MS);

  console.log(`[startup] Backup scheduler started (every 24h, retain ${RETENTION_DAYS} days)`);
}
