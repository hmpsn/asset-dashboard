import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import Database from 'better-sqlite3';
import { describe, expect, it, vi } from 'vitest';

import {
  buildDataIntegrityRecoveryReport,
  formatDataIntegrityRecoveryReportAsMarkdown,
  runDataIntegrityRecoveryReport,
} from '../../scripts/platform-data-integrity-recovery.js';

function createTempDbPath(name: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'asset-dashboard-integrity-'));
  return path.join(dir, `${name}.db`);
}

function withDatabase(dbPath: string, run: (db: Database.Database) => void): void {
  const db = new Database(dbPath);
  try {
    run(db);
  } finally {
    db.close();
  }
}

describe('data integrity recovery report', () => {
  it('reports healthy schema with zero violations', () => {
    const dbPath = createTempDbPath('healthy');
    withDatabase(dbPath, db => {
      db.exec('PRAGMA foreign_keys = ON');
      db.exec(`
        CREATE TABLE workspaces (
          id TEXT PRIMARY KEY
        );
        CREATE TABLE content_posts (
          id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL,
          FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
        );
        CREATE TABLE copy_sections (
          id TEXT PRIMARY KEY,
          workspace_id TEXT,
          content_post_id TEXT,
          FOREIGN KEY (content_post_id) REFERENCES content_posts(id)
        );
      `);

      db.prepare('INSERT INTO workspaces (id) VALUES (?)').run('ws-1');
      db.prepare('INSERT INTO content_posts (id, workspace_id) VALUES (?, ?)').run('post-1', 'ws-1');
      db.prepare('INSERT INTO copy_sections (id, workspace_id, content_post_id) VALUES (?, ?, ?)').run(
        'section-1',
        'ws-1',
        'post-1',
      );

      const report = buildDataIntegrityRecoveryReport(db, dbPath);
      expect(report.checks.quickCheck).toBe('ok');
      expect(report.checks.integrityCheck).toBe('ok');
      expect(report.checks.foreignKeyViolations).toBe(0);
      expect(report.checks.workspaceOrphanRows).toBe(0);
      expect(report.checks.crossTableIssues).toBe(0);

      const markdown = formatDataIntegrityRecoveryReportAsMarkdown(report);
      expect(markdown).toContain('# Data Integrity & Recovery Report');
      expect(markdown).toContain('Artifact Recovery Map');
    });
  });

  it('detects workspace orphans and broken cross-table references', () => {
    const dbPath = createTempDbPath('orphaned');
    withDatabase(dbPath, db => {
      db.exec('PRAGMA foreign_keys = ON');
      db.exec(`
        CREATE TABLE workspaces (
          id TEXT PRIMARY KEY
        );
        CREATE TABLE content_posts (
          id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL,
          FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
        );
        CREATE TABLE copy_sections (
          id TEXT PRIMARY KEY,
          workspace_id TEXT,
          content_post_id TEXT,
          FOREIGN KEY (content_post_id) REFERENCES content_posts(id)
        );
      `);

      db.prepare('INSERT INTO workspaces (id) VALUES (?)').run('ws-1');
      db.prepare('INSERT INTO content_posts (id, workspace_id) VALUES (?, ?)').run('post-1', 'ws-1');

      db.exec('PRAGMA foreign_keys = OFF');
      db.prepare('INSERT INTO copy_sections (id, workspace_id, content_post_id) VALUES (?, ?, ?)').run(
        'section-orphan',
        'ws-missing',
        'post-missing',
      );
      db.exec('PRAGMA foreign_keys = ON');

      const report = buildDataIntegrityRecoveryReport(db, dbPath);
      expect(report.checks.foreignKeyViolations).toBeGreaterThan(0);
      expect(report.checks.workspaceOrphanRows).toBe(1);
      expect(report.checks.crossTableIssues).toBeGreaterThan(0);
      expect(report.workspaceOrphans.some(entry => entry.table === 'copy_sections')).toBe(true);
      expect(
        report.crossTableConsistencyIssues.some(
          issue => issue.childTable === 'copy_sections' && issue.parentTable === 'content_posts',
        ),
      ).toBe(true);
    });
  });

  it('returns a stable non-zero result for non-database inputs', () => {
    const badPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'asset-dashboard-notadb-')), 'not-a-db.txt');
    fs.writeFileSync(badPath, 'this is not sqlite');

    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const exitCode = runDataIntegrityRecoveryReport(['--db', badPath]);
      expect(exitCode).toBe(1);
      expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('Failed integrity report'));
    } finally {
      consoleError.mockRestore();
    }
  });
});
