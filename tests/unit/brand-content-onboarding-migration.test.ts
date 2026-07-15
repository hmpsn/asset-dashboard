import { readFileSync } from 'node:fs';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const migrationSql = readFileSync(
  new URL('../../server/db/migrations/193-brand-content-onboarding-runs.sql', import.meta.url),
  'utf8',
);

describe('193 brand content onboarding migration', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec(`
      CREATE TABLE workspaces (id TEXT PRIMARY KEY);
      CREATE TABLE brand_intake_revisions (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        revision INTEGER NOT NULL,
        fingerprint TEXT NOT NULL,
        UNIQUE (id, workspace_id),
        FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
      );
      INSERT INTO workspaces (id) VALUES ('ws-1');
      INSERT INTO brand_intake_revisions (id, workspace_id, revision, fingerprint)
      VALUES
        ('intake-1', 'ws-1', 1, '${'a'.repeat(64)}'),
        ('intake-2', 'ws-1', 2, '${'b'.repeat(64)}');
    `);
    db.exec(migrationSql);
  });

  afterEach(() => db.close());

  function insertRun(id: string, intakeRevisionId: string, idempotencyKey: string): void {
    db.prepare(`
      INSERT INTO brand_content_onboarding_runs (
        id, workspace_id, intake_revision_id, intake_revision,
        intake_fingerprint, status, idempotency_key, matrix_selection_json,
        input_fingerprint,
        approved_identity_json, children_json, gate_evidence_json,
        created_by_json, created_at, updated_at
      ) VALUES (
        @id, 'ws-1', @intake_revision_id, 1, @intake_fingerprint,
        'intake_ready', @idempotency_key, @matrix_selection_json, @input_fingerprint, '[]',
        '{"brandRunId":null,"voiceReviewDeliverableId":null,"brandReviewDeliverableId":null,"matrixRunId":null,"pageApprovals":[]}',
        '[]', '{"actorType":"mcp","actorId":"key-1"}',
        '2026-07-14T00:00:00.000Z', '2026-07-14T00:00:00.000Z'
      )
    `).run({
      id,
      intake_revision_id: intakeRevisionId,
      intake_fingerprint: intakeRevisionId === 'intake-1' ? 'a'.repeat(64) : 'b'.repeat(64),
      idempotency_key: idempotencyKey,
      input_fingerprint: 'c'.repeat(64),
      matrix_selection_json: JSON.stringify([{
        matrixId: 'matrix-1',
        cellId: 'cell-1',
        sourceRevision: { matrixRevision: 1, templateRevision: 2, cellRevision: 3 },
        structuralFingerprint: 'd'.repeat(64),
        previewFingerprint: null,
      }]),
    });
  }

  it('stores one orchestration record plus its immutable command ledger', () => {
    const tables = (db.prepare(`
      SELECT name FROM sqlite_master WHERE type = 'table'
    `).all() as Array<{ name: string }>).map(row => row.name);
    expect(tables).toContain('brand_content_onboarding_runs');
    expect(tables.filter(name => name.startsWith('brand_content_onboarding_')))
      .toEqual([
        'brand_content_onboarding_runs',
        'brand_content_onboarding_commands',
      ]);

    const columns = (db.prepare(`
      PRAGMA table_info(brand_content_onboarding_runs)
    `).all() as Array<{ name: string }>).map(column => column.name);
    expect(columns).toEqual(expect.arrayContaining([
      'revision',
      'input_fingerprint',
      'matrix_selection_json',
      'finalized_voice_json',
      'approved_identity_json',
      'children_json',
      'gate_evidence_json',
    ]));

    const commandColumns = (db.prepare(`
      PRAGMA table_info(brand_content_onboarding_commands)
    `).all() as Array<{ name: string }>).map(column => column.name);
    expect(commandColumns).toEqual(expect.arrayContaining([
      'idempotency_key',
      'request_fingerprint',
      'result_revision',
      'result_status',
      'paid_job_id',
    ]));
  });

  it('scopes start idempotency to workspace and intake revision', () => {
    insertRun('run-1', 'intake-1', 'start-key');
    expect(() => insertRun('run-2', 'intake-1', 'start-key')).toThrow();
    expect(() => insertRun('run-3', 'intake-2', 'start-key')).not.toThrow();
  });

  it('cascades with the workspace and rejects a missing intake revision', () => {
    insertRun('run-1', 'intake-1', 'start-key');
    db.prepare(`
      INSERT INTO brand_content_onboarding_commands (
        run_id, workspace_id, idempotency_key, request_fingerprint,
        result_revision, result_status, paid_job_id, created_at
      ) VALUES (
        'run-1', 'ws-1', 'resume-key', ?, 1, 'brand_generating',
        'brand-job-1', '2026-07-14T00:01:00.000Z'
      )
    `).run('e'.repeat(64));
    expect(() => insertRun('run-2', 'missing', 'other-key')).toThrow();

    db.prepare(`DELETE FROM workspaces WHERE id = 'ws-1'`).run();
    expect(db.prepare(`
      SELECT COUNT(*) AS count FROM brand_content_onboarding_runs
    `).get()).toEqual({ count: 0 });
    expect(db.prepare(`
      SELECT COUNT(*) AS count FROM brand_content_onboarding_commands
    `).get()).toEqual({ count: 0 });
  });

  it('requires a non-null matrix selection', () => {
    expect(() => db.prepare(`
      INSERT INTO brand_content_onboarding_runs (
        id, workspace_id, intake_revision_id, intake_revision,
        intake_fingerprint, status, idempotency_key, matrix_selection_json,
        input_fingerprint, approved_identity_json, children_json,
        gate_evidence_json, created_by_json, created_at, updated_at
      ) VALUES (
        'run-null', 'ws-1', 'intake-1', 1, ?, 'intake_ready',
        'start-null', NULL, ?, '[]', '{}', '[]',
        '{"actorType":"mcp","actorId":"key-1"}',
        '2026-07-14T00:00:00.000Z', '2026-07-14T00:00:00.000Z'
      )
    `).run('a'.repeat(64), 'c'.repeat(64))).toThrow();
  });
});
