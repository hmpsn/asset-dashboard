import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

const migrationSql = readFileSync(
  new URL('../../server/db/migrations/184-content-matrix-generation-foundation.sql', import.meta.url),
  'utf8',
);

function createPreM0Database(): Database.Database {
  const memory = new Database(':memory:');
  memory.pragma('foreign_keys = ON');
  memory.exec(`
    CREATE TABLE workspaces (id TEXT PRIMARY KEY);
    CREATE TABLE content_templates (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      page_type TEXT NOT NULL DEFAULT 'service',
      variables TEXT NOT NULL DEFAULT '[]',
      sections TEXT NOT NULL DEFAULT '[]',
      url_pattern TEXT NOT NULL DEFAULT '',
      keyword_pattern TEXT NOT NULL DEFAULT '',
      title_pattern TEXT,
      meta_desc_pattern TEXT,
      cms_field_map TEXT,
      tone_and_style TEXT,
      schema_types TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE content_matrices (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      name TEXT NOT NULL,
      template_id TEXT NOT NULL,
      dimensions TEXT NOT NULL DEFAULT '[]',
      url_pattern TEXT NOT NULL DEFAULT '',
      keyword_pattern TEXT NOT NULL DEFAULT '',
      cells TEXT NOT NULL DEFAULT '[]',
      stats TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    INSERT INTO workspaces (id) VALUES ('ws-legacy');
    INSERT INTO content_templates (
      id, workspace_id, name, created_at, updated_at
    ) VALUES (
      'tpl-legacy', 'ws-legacy', 'Legacy', '2026-07-13', '2026-07-13'
    );
    INSERT INTO content_matrices (
      id, workspace_id, name, template_id, created_at, updated_at
    ) VALUES (
      'matrix-legacy', 'ws-legacy', 'Legacy', 'tpl-legacy', '2026-07-13', '2026-07-13'
    );
  `);
  return memory;
}

function columnNames(memory: Database.Database, table: string): string[] {
  return (memory.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>)
    .map(column => column.name);
}

function insertRun(
  memory: Database.Database,
  id = 'run-integrity',
  matrixId = 'matrix-integrity',
): void {
  memory.prepare(`
    INSERT INTO content_matrix_generation_runs (
      id, workspace_id, matrix_id, template_id, status,
      idempotency_key, selection_fingerprint, created_by, created_at, updated_at
    ) VALUES (?, 'ws-legacy', ?, 'template-integrity', 'queued', ?, 'selection', '{}', '2026-07-13', '2026-07-13')
  `).run(id, matrixId, `idempotency-${id}`);
}

function insertItem(
  memory: Database.Database,
  id = 'item-integrity',
  runId = 'run-integrity',
  matrixId = 'matrix-integrity',
): void {
  memory.prepare(`
    INSERT INTO content_matrix_generation_items (
      id, run_id, workspace_id, matrix_id, cell_id,
      matrix_revision, template_revision, cell_revision,
      structural_fingerprint, preview_fingerprint, status,
      created_at, updated_at
    ) VALUES (?, ?, 'ws-legacy', ?, 'cell-integrity', 0, 0, 0, 'structural', 'preview', 'queued', '2026-07-13', '2026-07-13')
  `).run(id, runId, matrixId);
}

describe('184 content matrix generation foundation migration', () => {
  it('adds revision-safe source columns without changing legacy revisions', () => {
    const memory = createPreM0Database();
    try {
      memory.exec(migrationSql);

      expect(columnNames(memory, 'content_matrices')).toContain('revision');
      expect(columnNames(memory, 'content_templates')).toEqual(expect.arrayContaining([
        'revision',
        'generation_contract_version',
        'generation_upgrade_fingerprint',
        'generation_upgrade_idempotency_key',
        'generation_upgrade_source_revision',
      ]));
      expect(memory.prepare(
        'SELECT revision FROM content_matrices WHERE id = ?',
      ).get('matrix-legacy')).toEqual({ revision: 0 });
      expect(memory.prepare(`
        SELECT revision, generation_contract_version
        FROM content_templates WHERE id = ?
      `).get('tpl-legacy')).toEqual({ revision: 0, generation_contract_version: null });
      expect(() => memory.prepare(`
        UPDATE content_templates SET generation_contract_version = 0 WHERE id = ?
      `).run('tpl-legacy')).not.toThrow();
      expect(() => memory.prepare(`
        UPDATE content_templates SET generation_contract_version = -1 WHERE id = ?
      `).run('tpl-legacy')).toThrow();
    } finally {
      memory.close();
    }
  });

  it('creates normalized run, item, attempt, and versioned evidence tables', () => {
    const memory = createPreM0Database();
    try {
      memory.exec(migrationSql);
      const tables = (memory.prepare(`
        SELECT name FROM sqlite_master WHERE type = 'table'
      `).all() as Array<{ name: string }>).map(row => row.name);

      expect(tables).toEqual(expect.arrayContaining([
        'content_matrix_generation_runs',
        'content_matrix_generation_items',
        'content_matrix_generation_attempts',
        'content_matrix_cell_evidence',
      ]));
      expect(columnNames(memory, 'content_matrix_generation_items')).toEqual(expect.arrayContaining([
        'matrix_revision', 'template_revision', 'cell_revision',
        'structural_fingerprint', 'preview_fingerprint',
        'structural_target', 'preview_target', 'audit_report', 'error',
      ]));
    } finally {
      memory.close();
    }
  });

  it('enforces integer revision, version, counter, and marker contracts in SQLite', () => {
    const memory = createPreM0Database();
    try {
      memory.exec(migrationSql);
      insertRun(memory);
      insertItem(memory);
      memory.prepare(`
        INSERT INTO content_matrix_generation_attempts (
          id, item_id, attempt_number, stage, status,
          effective_input_fingerprint, started_at
        ) VALUES ('attempt-integrity', 'item-integrity', 1, 'preflight', 'running', 'effective', '2026-07-13')
      `).run();
      memory.prepare(`
        INSERT INTO content_matrix_cell_evidence (
          id, workspace_id, matrix_id, cell_id, requirement_id,
          matrix_revision, template_revision, cell_revision,
          value, source_ref, resolved_by, expected_artifact_revisions,
          idempotency_key, is_current, created_at
        ) VALUES (
          'evidence-integrity', 'ws-legacy', 'matrix-integrity', 'cell-integrity', 'requirement-integrity',
          0, 0, 0, '{}', '{}', '{}', '[]', 'evidence-integrity', 1, '2026-07-13'
        )
      `).run();

      const invalidWrites = [
        `UPDATE content_matrices SET revision = 1.5 WHERE id = 'matrix-legacy'`,
        `UPDATE content_templates SET revision = 'not-an-integer' WHERE id = 'tpl-legacy'`,
        `UPDATE content_templates SET generation_contract_version = 1.5 WHERE id = 'tpl-legacy'`,
        `UPDATE content_templates SET generation_upgrade_source_revision = 'bad' WHERE id = 'tpl-legacy'`,
        `UPDATE content_matrix_generation_runs SET revision = 0.5 WHERE id = 'run-integrity'`,
        `UPDATE content_matrix_generation_runs SET selected_count = 'bad' WHERE id = 'run-integrity'`,
        `UPDATE content_matrix_generation_items SET matrix_revision = 0.5 WHERE id = 'item-integrity'`,
        `UPDATE content_matrix_generation_items SET attempt_count = 'bad' WHERE id = 'item-integrity'`,
        `UPDATE content_matrix_generation_items SET automatic_revision_count = 0.5 WHERE id = 'item-integrity'`,
        `UPDATE content_matrix_generation_attempts SET attempt_number = 1.5 WHERE id = 'attempt-integrity'`,
        `UPDATE content_matrix_cell_evidence SET template_revision = 'bad' WHERE id = 'evidence-integrity'`,
        `UPDATE content_matrix_cell_evidence SET is_current = 0.5 WHERE id = 'evidence-integrity'`,
      ];
      for (const sql of invalidWrites) {
        expect(() => memory.prepare(sql).run(), sql).toThrow();
      }
    } finally {
      memory.close();
    }
  });

  it('scopes idempotency to workspace+matrix and does not FK runs to deletable sources', () => {
    const memory = createPreM0Database();
    try {
      memory.exec(migrationSql);
      const sourceForeignKeys = memory.prepare(
        `PRAGMA foreign_key_list(content_matrix_generation_runs)`,
      ).all() as Array<{ table: string; from: string }>;
      expect(sourceForeignKeys).toEqual([
        expect.objectContaining({ table: 'workspaces', from: 'workspace_id' }),
      ]);

      const insert = memory.prepare(`
        INSERT INTO content_matrix_generation_runs (
          id, workspace_id, matrix_id, template_id, status,
          idempotency_key, selection_fingerprint, created_by, created_at, updated_at
        ) VALUES (?, 'ws-legacy', 'deleted-matrix', 'deleted-template', 'queued', ?, ?, '{}', '2026-07-13', '2026-07-13')
      `);
      insert.run('run-1', 'idempotency-1', 'fingerprint-1');
      expect(() => insert.run('run-2', 'idempotency-1', 'fingerprint-2')).toThrow();

      expect(() => insertItem(memory, 'item-cross-matrix', 'run-1', 'another-matrix')).toThrow();
      expect(() => insertItem(memory, 'item-same-matrix', 'run-1', 'deleted-matrix')).not.toThrow();

      memory.prepare(`DELETE FROM workspaces WHERE id = 'ws-legacy'`).run();
      expect(memory.prepare(
        `SELECT COUNT(*) AS count FROM content_matrix_generation_runs`,
      ).get()).toEqual({ count: 0 });
    } finally {
      memory.close();
    }
  });

  it('keeps evidence supersession chains inside one workspace, matrix, cell, and requirement', () => {
    const memory = createPreM0Database();
    try {
      memory.exec(migrationSql);
      memory.prepare(`INSERT INTO workspaces (id) VALUES ('ws-other')`).run();
      const insertEvidence = memory.prepare(`
        INSERT INTO content_matrix_cell_evidence (
          id, workspace_id, matrix_id, cell_id, requirement_id,
          matrix_revision, template_revision, cell_revision,
          value, source_ref, resolved_by, expected_artifact_revisions,
          idempotency_key, supersedes_id, is_current, created_at
        ) VALUES (
          @id, @workspace_id, @matrix_id, @cell_id, @requirement_id,
          1, 1, 1, '{}', '{}', '{}', '[]',
          @idempotency_key, @supersedes_id, @is_current, '2026-07-13'
        )
      `);
      insertEvidence.run({
        id: 'evidence-a',
        workspace_id: 'ws-legacy',
        matrix_id: 'matrix-a',
        cell_id: 'cell-a',
        requirement_id: 'requirement-a',
        idempotency_key: 'evidence-a',
        supersedes_id: null,
        is_current: 0,
      });

      expect(() => insertEvidence.run({
        id: 'evidence-cross-workspace',
        workspace_id: 'ws-other',
        matrix_id: 'matrix-a',
        cell_id: 'cell-a',
        requirement_id: 'requirement-a',
        idempotency_key: 'evidence-cross-workspace',
        supersedes_id: 'evidence-a',
        is_current: 1,
      })).toThrow();
      expect(() => insertEvidence.run({
        id: 'evidence-cross-requirement',
        workspace_id: 'ws-legacy',
        matrix_id: 'matrix-a',
        cell_id: 'cell-a',
        requirement_id: 'requirement-b',
        idempotency_key: 'evidence-cross-requirement',
        supersedes_id: 'evidence-a',
        is_current: 1,
      })).toThrow();

      insertEvidence.run({
        id: 'evidence-b',
        workspace_id: 'ws-legacy',
        matrix_id: 'matrix-a',
        cell_id: 'cell-a',
        requirement_id: 'requirement-a',
        idempotency_key: 'evidence-b',
        supersedes_id: 'evidence-a',
        is_current: 1,
      });
      expect(memory.prepare(`
        SELECT supersedes_id FROM content_matrix_cell_evidence WHERE id = 'evidence-b'
      `).get()).toEqual({ supersedes_id: 'evidence-a' });
    } finally {
      memory.close();
    }
  });
});
