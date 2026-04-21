/**
 * Storage statistics & pruning utilities.
 * Scans DATA_BASE, uploads, optimized, and backups directories
 * to produce a per-category size breakdown. Also provides
 * pruning functions for chat history and backup retention.
 */

import fs from 'fs';
import path from 'path';
import { DATA_BASE, getUploadRoot, getOptRoot } from './data-dir.js';
import { isProgrammingError } from './errors.js';
import { createLogger } from './logger.js';


const log = createLogger('storage-stats');
/* ── Types ── */

export interface DirStats {
  name: string;
  bytes: number;
  fileCount: number;
  label: string;
}

export interface StorageReport {
  totalBytes: number;
  totalFiles: number;
  breakdown: DirStats[];
  backupRetentionDays: number;
  chatSessionCount: number;
  oldestChatSession: string | null;
  timestamp: string;
}

/* ── Helpers ── */

/** Recursively sum file sizes in a directory. */
function dirSize(dirPath: string): { bytes: number; files: number } {
  let bytes = 0;
  let files = 0;
  try {
    if (!fs.existsSync(dirPath)) return { bytes: 0, files: 0 };
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dirPath, entry.name);
      try {
        if (entry.isDirectory()) {
          const sub = dirSize(full);
          bytes += sub.bytes;
          files += sub.files;
        } else if (entry.isFile()) {
          bytes += fs.statSync(full).size;
          files++;
        }
      } catch (err) { if (isProgrammingError(err)) log.warn({ err }, 'storage-stats/dirSize: programming error'); /* skip inaccessible */ }
    }
  } catch (err) { if (isProgrammingError(err)) log.warn({ err }, 'storage-stats/dirSize: programming error'); /* directory doesn't exist */ }
  return { bytes, files };
}

/** Async variant of dirSize — used by getStorageReport() to avoid blocking the event loop. */
async function dirSizeAsync(dirPath: string): Promise<{ bytes: number; files: number }> {
  let bytes = 0;
  let files = 0;
  try {
    await fs.promises.access(dirPath);
    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dirPath, entry.name);
      try {
        if (entry.isDirectory()) {
          const sub = await dirSizeAsync(full);
          bytes += sub.bytes;
          files += sub.files;
        } else if (entry.isFile()) {
          bytes += (await fs.promises.stat(full)).size;
          files++;
        }
      } catch (err) {
        if (isProgrammingError(err)) log.warn({ err }, 'storage-stats/dirSizeAsync: programming error');
      }
    }
  } catch (err) {
    if (isProgrammingError(err)) log.warn({ err }, 'storage-stats/dirSizeAsync: programming error');
  }
  return { bytes, files };
}

/* ── Main report ── */

const CATEGORY_LABELS: Record<string, string> = {
  backups: 'Backups',
  'chat-sessions': 'Chat History',
  reports: 'Reports & Snapshots',
  'content-briefs': 'Content Briefs',
  'content-posts': 'Content Posts',
  'content-requests': 'Content Requests',
  recommendations: 'AI Recommendations',
  'rank-tracking': 'Rank Tracking',
  schemas: 'Schema Snapshots',
  redirects: 'Redirect Snapshots',
  performance: 'Performance Data',
  'roi-history': 'ROI History',
  activity: 'Activity Logs',
  'sales-reports': 'Sales Reports',
  auth: 'Auth Data',
  payments: 'Payment Records',
  'email-queue': 'Email Queue',
  feedback: 'Feedback',
  'semrush-usage': 'SEMRush Usage',
  'work-orders': 'Work Orders',
  approvals: 'Approvals',
  'ai-usage': 'AI Usage Logs',
  metadata: 'Metadata',
  admin: 'Admin Config',
  config: 'Config',
  uploads: 'Workspace Uploads',
  optimized: 'Optimized Images',
};

export async function getStorageReport(): Promise<StorageReport> {
  const dataRoot = DATA_BASE || path.join(process.env.HOME || '', '.asset-dashboard');
  const breakdown: DirStats[] = [];
  let totalBytes = 0;
  let totalFiles = 0;

  // Scan all known data subdirectories
  const knownDirs = [
    'backups', 'chat-sessions', 'reports', 'content-briefs', 'content-posts',
    'content-requests', 'recommendations', 'rank-tracking', 'schemas',
    'redirects', 'performance', 'roi-history', 'activity', 'sales-reports',
    'auth', 'payments', 'email-queue', 'feedback', 'semrush-usage',
    'work-orders', 'approvals', 'ai-usage', 'metadata', 'admin', 'config',
  ];

  for (const sub of knownDirs) {
    const dirPath = path.join(dataRoot, sub);
    const stats = await dirSizeAsync(dirPath);
    if (stats.bytes > 0 || stats.files > 0) {
      breakdown.push({
        name: sub,
        bytes: stats.bytes,
        fileCount: stats.files,
        label: CATEGORY_LABELS[sub] || sub,
      });
      totalBytes += stats.bytes;
      totalFiles += stats.files;
    }
  }

  // Uploads root (may be separate from data root in dev)
  try {
    const uploadRoot = getUploadRoot();
    const uploadStats = await dirSizeAsync(uploadRoot);
    if (uploadStats.bytes > 0) {
      breakdown.push({
        name: 'uploads',
        bytes: uploadStats.bytes,
        fileCount: uploadStats.files,
        label: CATEGORY_LABELS.uploads,
      });
      totalBytes += uploadStats.bytes;
      totalFiles += uploadStats.files;
    }
  } catch (err) { if (isProgrammingError(err)) log.warn({ err }, 'storage-stats: programming error'); /* ignore */ }

  // Optimized images
  try {
    const optRoot = getOptRoot();
    const optStats = await dirSizeAsync(optRoot);
    if (optStats.bytes > 0) {
      breakdown.push({
        name: 'optimized',
        bytes: optStats.bytes,
        fileCount: optStats.files,
        label: CATEGORY_LABELS.optimized,
      });
      totalBytes += optStats.bytes;
      totalFiles += optStats.files;
    }
  } catch (err) { if (isProgrammingError(err)) log.warn({ err }, 'storage-stats: programming error'); /* ignore */ }

  // Sort by size descending
  breakdown.sort((a, b) => b.bytes - a.bytes);

  // Chat session stats
  const chatDir = path.join(dataRoot, 'chat-sessions');
  let chatSessionCount = 0;
  let oldestChatSession: string | null = null;
  try {
    const wsDirs = (await fs.promises.readdir(chatDir, { withFileTypes: true }).catch(() => [])).filter(d => d.isDirectory());
    for (const wsDir of wsDirs) {
      const wsPath = path.join(chatDir, wsDir.name);
      const files = (await fs.promises.readdir(wsPath).catch(() => [])).filter((f: string) => f.endsWith('.json'));
      chatSessionCount += files.length;
      for (const file of files) {
        try {
          const raw = await fs.promises.readFile(path.join(wsPath, file), 'utf-8');
          const data = JSON.parse(raw);
          if (data.createdAt && (!oldestChatSession || data.createdAt < oldestChatSession)) {
            oldestChatSession = data.createdAt;
          }
        } catch { /* skip malformed session files */ } // catch-ok
      }
    }
  } catch { /* chatDir not found or inaccessible */ } // catch-ok

  const retentionDays = parseInt(process.env.BACKUP_RETENTION_DAYS || '7', 10);

  return {
    totalBytes,
    totalFiles,
    breakdown,
    backupRetentionDays: retentionDays,
    chatSessionCount,
    oldestChatSession,
    timestamp: new Date().toISOString(),
  };
}

/* ── Pruning: Chat history ── */

export interface PruneResult {
  sessionsRemoved: number;
  bytesFreed: number;
  errors: string[];
}

/**
 * Archive chat sessions older than `maxAgeDays`.
 * "Archive" = delete the session file (messages are gone, summaries were already generated).
 */
export function pruneChatSessions(maxAgeDays: number = 90): PruneResult {
  const dataRoot = DATA_BASE || path.join(process.env.HOME || '', '.asset-dashboard');
  const chatDir = path.join(dataRoot, 'chat-sessions');
  const cutoff = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000).toISOString();
  const result: PruneResult = { sessionsRemoved: 0, bytesFreed: 0, errors: [] };

  try {
    if (!fs.existsSync(chatDir)) return result;
    const wsDirs = fs.readdirSync(chatDir, { withFileTypes: true }).filter(d => d.isDirectory());
    for (const wsDir of wsDirs) {
      const wsPath = path.join(chatDir, wsDir.name);
      const files = fs.readdirSync(wsPath).filter(f => f.endsWith('.json'));
      for (const file of files) {
        const filePath = path.join(wsPath, file);
        try {
          const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
          if (data.updatedAt && data.updatedAt < cutoff) {
            const stat = fs.statSync(filePath);
            fs.unlinkSync(filePath);
            result.sessionsRemoved++;
            result.bytesFreed += stat.size;
          }
        } catch (err) {
          result.errors.push(`${file}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }
  } catch (err) {
    result.errors.push(`Chat prune failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  return result;
}

/* ── Pruning: Backups ── */

/**
 * Reduce backup retention to `retainDays` (default 3).
 * Returns count of backup dirs removed and bytes freed.
 */
export function pruneBackups(retainDays: number = 3): PruneResult {
  const dataRoot = DATA_BASE || path.join(process.env.HOME || '', '.asset-dashboard');
  const backupRoot = process.env.BACKUP_DIR || path.join(dataRoot, 'backups');
  const cutoff = Date.now() - retainDays * 24 * 60 * 60 * 1000;
  const result: PruneResult = { sessionsRemoved: 0, bytesFreed: 0, errors: [] };

  try {
    if (!fs.existsSync(backupRoot)) return result;
    for (const entry of fs.readdirSync(backupRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.startsWith('backup-')) continue;
      const dirPath = path.join(backupRoot, entry.name);
      try {
        const stat = fs.statSync(dirPath);
        if (stat.mtimeMs < cutoff) {
          const size = dirSize(dirPath);
          fs.rmSync(dirPath, { recursive: true, force: true });
          result.sessionsRemoved++;
          result.bytesFreed += size.bytes;
        }
      } catch (err) {
        result.errors.push(`${entry.name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } catch (err) {
    result.errors.push(`Backup prune failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  return result;
}

/* ── Pruning: Audit report snapshots ── */

/**
 * Keep only the most recent `keepPerSite` audit snapshots per site.
 * Reports are stored as individual JSON files in DATA_DIR/reports/{siteId}/.
 */
export function pruneReportSnapshots(keepPerSite: number = 20): PruneResult {
  const dataRoot = DATA_BASE || path.join(process.env.HOME || '', '.asset-dashboard');
  const reportsDir = path.join(dataRoot, 'reports');
  const result: PruneResult = { sessionsRemoved: 0, bytesFreed: 0, errors: [] };

  try {
    if (!fs.existsSync(reportsDir)) return result;
    const siteDirs = fs.readdirSync(reportsDir, { withFileTypes: true }).filter(d => d.isDirectory());
    for (const siteDir of siteDirs) {
      const sitePath = path.join(reportsDir, siteDir.name);
      const files = fs.readdirSync(sitePath).filter(f => f.endsWith('.json'));
      if (files.length <= keepPerSite) continue;

      // Sort by mtime descending (newest first)
      const withTime = files.map(f => {
        const fp = path.join(sitePath, f);
        try { return { name: f, mtime: fs.statSync(fp).mtimeMs, size: fs.statSync(fp).size }; }
        catch { return { name: f, mtime: 0, size: 0 }; }
      }).sort((a, b) => b.mtime - a.mtime);

      // Delete everything beyond keepPerSite
      const toDelete = withTime.slice(keepPerSite);
      for (const f of toDelete) {
        try {
          fs.unlinkSync(path.join(sitePath, f.name));
          result.sessionsRemoved++;
          result.bytesFreed += f.size;
        } catch (err) {
          result.errors.push(`${siteDir.name}/${f.name}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }
  } catch (err) {
    result.errors.push(`Report prune failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  return result;
}

/* ── Pruning: Activity logs ── */

/**
 * Remove activity log entries older than `maxAgeDays` (default 180).
 * Activity logs are per-workspace JSON files in DATA_DIR/activity/.
 */
export function pruneActivityLogs(maxAgeDays: number = 180): PruneResult {
  const dataRoot = DATA_BASE || path.join(process.env.HOME || '', '.asset-dashboard');
  const activityDir = path.join(dataRoot, 'activity');
  const cutoff = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000).toISOString();
  const result: PruneResult = { sessionsRemoved: 0, bytesFreed: 0, errors: [] };

  try {
    if (!fs.existsSync(activityDir)) return result;
    const files = fs.readdirSync(activityDir).filter(f => f.endsWith('.json'));
    for (const file of files) {
      const filePath = path.join(activityDir, file);
      try {
        const beforeSize = fs.statSync(filePath).size;
        const entries = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        if (!Array.isArray(entries)) continue;
        const filtered = entries.filter((e: { timestamp?: string }) => !e.timestamp || e.timestamp >= cutoff);
        const removed = entries.length - filtered.length;
        if (removed > 0) {
          fs.writeFileSync(filePath, JSON.stringify(filtered, null, 2));
          const afterSize = fs.statSync(filePath).size;
          result.sessionsRemoved += removed;
          result.bytesFreed += beforeSize - afterSize;
        }
      } catch (err) {
        result.errors.push(`${file}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } catch (err) {
    result.errors.push(`Activity prune failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  return result;
}
