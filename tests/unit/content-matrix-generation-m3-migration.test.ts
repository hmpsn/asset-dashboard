import { readFileSync } from 'node:fs';

import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

const foundationSql = readFileSync(
  new URL('../../server/db/migrations/184-content-matrix-generation-foundation.sql', import.meta.url),
  'utf8',
);
const batchSql = readFileSync(
  new URL('../../server/db/migrations/192-content-matrix-generation-batches.sql', import.meta.url),
  'utf8',
);

function migratedDatabase(): Database.Database {
  const memory = new Database(':memory:');
  memory.pragma('foreign_keys = ON');
  memory.exec(`
    CREATE TABLE workspaces (id TEXT PRIMARY KEY);
    CREATE TABLE content_templates (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, name TEXT NOT NULL,
      description TEXT, page_type TEXT NOT NULL DEFAULT 'service',
      variables TEXT NOT NULL DEFAULT '[]', sections TEXT NOT NULL DEFAULT '[]',
      url_pattern TEXT NOT NULL DEFAULT '', keyword_pattern TEXT NOT NULL DEFAULT '',
      title_pattern TEXT, meta_desc_pattern TEXT, cms_field_map TEXT,
      tone_and_style TEXT, schema_types TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE content_matrices (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, name TEXT NOT NULL,
      template_id TEXT NOT NULL, dimensions TEXT NOT NULL DEFAULT '[]',
      url_pattern TEXT NOT NULL DEFAULT '', keyword_pattern TEXT NOT NULL DEFAULT '',
      cells TEXT NOT NULL DEFAULT '[]', stats TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    INSERT INTO workspaces (id) VALUES ('ws-1');
  `);
  memory.exec(foundationSql);
  memory.exec(batchSql);
  return memory;
}

function columnNames(memory: Database.Database, table: string): string[] {
  return (memory.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>)
    .map(column => column.name);
}

describe('192 content matrix generation batch migration', () => {
  it('adds only the durable batch, set-audit, approval, and retry-command seams', () => {
    const memory = migratedDatabase();
    try {
      expect(columnNames(memory, 'content_matrix_generation_runs')).toEqual(expect.arrayContaining([
        'accepted_budget',
        'set_audit_report',
      ]));
      expect(columnNames(memory, 'content_matrix_generation_items')).toContain('approval_evidence');
      expect(columnNames(memory, 'content_matrix_generation_retry_commands')).toEqual(expect.arrayContaining([
        'run_id',
        'workspace_id',
        'idempotency_key',
        'request_fingerprint',
        'request_payload',
        'job_id',
      ]));
    } finally {
      memory.close();
    }
  });

  it('keeps retry idempotency scoped to one durable run and cascades with it', () => {
    const memory = migratedDatabase();
    try {
      memory.prepare(`
        INSERT INTO content_matrix_generation_runs (
          id, workspace_id, matrix_id, template_id, status,
          idempotency_key, selection_fingerprint, created_by, created_at, updated_at
        ) VALUES ('run-1', 'ws-1', 'matrix-1', 'template-1', 'queued',
          'start-1', 'selection-1', '{}', '2026-07-14', '2026-07-14')
      `).run();
      const insert = memory.prepare(`
        INSERT INTO content_matrix_generation_retry_commands (
          id, run_id, workspace_id, idempotency_key, request_fingerprint,
          request_payload, job_id, created_at
        ) VALUES (?, 'run-1', 'ws-1', ?, ?, '{}', ?, '2026-07-14')
      `);
      insert.run('retry-1', 'retry-key', 'fingerprint-1', 'job-1');
      expect(() => insert.run('retry-2', 'retry-key', 'fingerprint-2', 'job-2')).toThrow();

      memory.prepare(`DELETE FROM content_matrix_generation_runs WHERE id = 'run-1'`).run();
      expect(memory.prepare(
        `SELECT COUNT(*) AS count FROM content_matrix_generation_retry_commands`,
      ).get()).toEqual({ count: 0 });
    } finally {
      memory.close();
    }
  });
});
