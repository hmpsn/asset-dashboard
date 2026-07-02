/**
 * Unit tests for the pure core of scripts/restore-drill.ts — the
 * manifest-vs-restored-counts diff. The full restore flow (local backup dir →
 * S3 tar → /api/admin/db-export fallback) involves fs/network/child_process
 * side effects that are exercised by the manual drill run (see the PR body
 * evidence attached in the A1 task), not unit-tested here. This file pins the
 * pure diffing contract so the mismatch-detection logic itself is
 * unit-testable in isolation.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { diffManifestCounts, runRestoreDrill, type BackupManifest } from '../../scripts/restore-drill.js';

function manifest(tableCounts: Record<string, number>): BackupManifest {
  return {
    timestamp: '2026-05-25T12:00:00.000Z',
    files: 3,
    bytes: 100,
    dataBase: '/data',
    verified: true,
    tableCounts,
  };
}

describe('diffManifestCounts', () => {
  it('returns an empty mismatch list when restored counts exactly match the manifest', () => {
    const m = manifest({ workspaces: 5, activities: 13 });
    const restored = { workspaces: 5, activities: 13 };

    expect(diffManifestCounts(m, restored)).toEqual([]);
  });

  it('flags a table whose restored count is lower than the manifest count', () => {
    const m = manifest({ workspaces: 5, activities: 13 });
    const restored = { workspaces: 5, activities: 10 };

    const mismatches = diffManifestCounts(m, restored);
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0]).toMatchObject({ table: 'activities', expected: 13, actual: 10 });
  });

  it('flags a table whose restored count is higher than the manifest count', () => {
    const m = manifest({ workspaces: 5 });
    const restored = { workspaces: 8 };

    const mismatches = diffManifestCounts(m, restored);
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0]).toMatchObject({ table: 'workspaces', expected: 5, actual: 8 });
  });

  it('flags a table present in the manifest but missing from the restored counts (treated as 0)', () => {
    const m = manifest({ workspaces: 5, schema_snapshots: 2 });
    const restored = { workspaces: 5 };

    const mismatches = diffManifestCounts(m, restored);
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0]).toMatchObject({ table: 'schema_snapshots', expected: 2, actual: 0 });
  });

  it('does not flag a table present in restored counts but absent from the manifest (new table added since backup)', () => {
    const m = manifest({ workspaces: 5 });
    const restored = { workspaces: 5, brand_new_table: 1 };

    expect(diffManifestCounts(m, restored)).toEqual([]);
  });

  it('flags multiple mismatched tables in one pass', () => {
    const m = manifest({ workspaces: 5, activities: 13, content_posts: 7 });
    const restored = { workspaces: 5, activities: 0, content_posts: 6 };

    const mismatches = diffManifestCounts(m, restored);
    expect(mismatches).toHaveLength(2);
    expect(mismatches.map(x => x.table).sort()).toEqual(['activities', 'content_posts']);
  });

  it('returns an empty list for an empty manifest tableCounts', () => {
    const m = manifest({});
    expect(diffManifestCounts(m, {})).toEqual([]);
  });
});

describe('runRestoreDrill scratch-dir cleanup', () => {
  const DRILL_PREFIX = 'asset-dashboard-restore-drill-';
  let emptyBackupDir: string;

  beforeEach(() => {
    // Point the drill at an empty backup dir so no local backup is found, and clear
    // S3 + db-export env so all three restore sources are unavailable → the drill
    // returns 1 without doing real I/O beyond scratch-dir management.
    emptyBackupDir = mkdtempSync(join(tmpdir(), 'restore-drill-empty-backups-'));
    process.env.BACKUP_DIR = emptyBackupDir;
    delete process.env.BACKUP_S3_BUCKET;
    delete process.env.APP_URL;
    delete process.env.APP_PASSWORD;
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    delete process.env.BACKUP_DIR;
    vi.restoreAllMocks();
    try { rmSync(emptyBackupDir, { recursive: true, force: true }); } catch { /* best-effort */ }
  });

  function drillTempDirsBefore(): Set<string> {
    return new Set(readdirSync(tmpdir()).filter(name => name.startsWith(DRILL_PREFIX)));
  }

  it('removes the auto-created scratch dir after the drill finishes', async () => {
    const before = drillTempDirsBefore();

    const exitCode = await runRestoreDrill([]);
    expect(exitCode).toBe(1); // no backup source available

    const leaked = readdirSync(tmpdir())
      .filter(name => name.startsWith(DRILL_PREFIX))
      .filter(name => !before.has(name));
    expect(leaked).toEqual([]); // the run's own temp dir was cleaned up
  });

  it('leaves a user-supplied --scratch-dir intact', async () => {
    const userScratch = mkdtempSync(join(tmpdir(), 'restore-drill-user-scratch-'));
    try {
      const exitCode = await runRestoreDrill(['--scratch-dir', userScratch]);
      expect(exitCode).toBe(1);
      expect(existsSync(userScratch)).toBe(true); // user dir preserved for inspection
    } finally {
      rmSync(userScratch, { recursive: true, force: true });
    }
  });
});
