import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const migrationSql = readFileSync(
  new URL('../../server/db/migrations/187-brand-generation-runs.sql', import.meta.url),
  'utf8',
);

describe('187 brand generation run migration', () => {
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
      CREATE TABLE brand_identity_deliverables (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        deliverable_type TEXT NOT NULL,
        content TEXT NOT NULL,
        status TEXT NOT NULL,
        version INTEGER NOT NULL,
        tier TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO workspaces (id) VALUES ('ws-1'), ('ws-2');
      INSERT INTO brand_intake_revisions (id, workspace_id, revision, fingerprint)
      VALUES ('intake-1', 'ws-1', 1, '${'a'.repeat(64)}');
      INSERT INTO brand_identity_deliverables (
        id, workspace_id, deliverable_type, content, status, version, tier,
        created_at, updated_at
      ) VALUES
        ('deliverable-ws-1', 'ws-1', 'mission', 'Mission', 'draft', 1, 'free',
          '2026-07-13T12:00:00.000Z', '2026-07-13T12:00:00.000Z'),
        ('deliverable-ws-2', 'ws-2', 'mission', 'Other mission', 'draft', 1, 'free',
          '2026-07-13T12:00:00.000Z', '2026-07-13T12:00:00.000Z');
    `);
    db.exec(migrationSql);
  });

  afterEach(() => db.close());

  function insertRun(id = 'brand-run-1', idempotencyKey = 'start-1'): void {
    db.prepare(`
      INSERT INTO brand_generation_runs (
        id, workspace_id, intake_revision_id, intake_revision, intake_fingerprint,
        selection_json, dispatch_targets_json, status, stage, idempotency_key,
        selection_fingerprint, effective_input_fingerprint,
        initial_input_fingerprints_json,
        estimated_provider_calls, estimated_input_tokens, estimated_output_tokens,
        estimated_cost_microusd, estimated_max_concurrency,
        max_provider_calls, max_input_tokens,
        max_output_tokens, max_cost_microusd, max_concurrency,
        created_by_json, created_at, updated_at
      ) VALUES (
        @id, 'ws-1', 'intake-1', 1, @intake_fingerprint,
        '{"kind":"preset","preset":"full_brand_system"}', '["voice_foundation"]',
        'queued', 'preflight', @idempotency_key, @selection_fingerprint,
        @effective_input_fingerprint, @initial_input_fingerprints_json,
        4, 10000, 4000, 100000, 1,
        114, 5000000, 250000, 100000000, 3,
        '{"actorType":"operator","actorId":"operator-1"}',
        '2026-07-13T12:00:00.000Z', '2026-07-13T12:00:00.000Z'
      )
    `).run({
      id,
      idempotency_key: idempotencyKey,
      intake_fingerprint: 'a'.repeat(64),
      selection_fingerprint: 'b'.repeat(64),
      effective_input_fingerprint: 'c'.repeat(64),
      initial_input_fingerprints_json: JSON.stringify(['c'.repeat(64)]),
    });
  }

  function insertFoundationItem(id = 'brand-item-foundation'): void {
    db.prepare(`
      INSERT INTO brand_generation_items (
        id, run_id, workspace_id, target, status, created_at, updated_at
      ) VALUES (
        ?, 'brand-run-1', 'ws-1', 'voice_foundation', 'queued',
        '2026-07-13T12:00:00.000Z', '2026-07-13T12:00:00.000Z'
      )
    `).run(id);
  }

  function insertDurableItem(id = 'brand-item-mission'): void {
    db.prepare(`
      INSERT INTO brand_generation_items (
        id, run_id, workspace_id, target, status, artifact_expectation_json,
        created_at, updated_at
      ) VALUES (
        ?, 'brand-run-1', 'ws-1', 'mission', 'queued',
        '{"kind":"create","deliverableId":null,"expectedVersion":0}',
        '2026-07-13T12:00:00.000Z', '2026-07-13T12:00:00.000Z'
      )
    `).run(id);
  }

  function insertStartCommand(id = 'brand-command-start', idempotencyKey = 'start-1'): void {
    db.prepare(`
      INSERT INTO brand_generation_commands (
        id, run_id, workspace_id, command_kind, idempotency_key,
        request_fingerprint, request_snapshot_json, job_id, result_json,
        actor_json, mcp_execution_context_json, created_at
      ) VALUES (
        ?, 'brand-run-1', 'ws-1', 'start', ?, ?,
        '{"schemaVersion":1,"kind":"start","command":{"selection":{"kind":"preset","preset":"full_brand_system"}}}',
        'job-start-1',
        '{"runId":"brand-run-1","runRevision":0,"jobId":"job-start-1","selectionCount":1}',
        '{"actorType":"mcp","actorId":"mcp-key-1"}',
        '{"actorType":"mcp","keyId":"mcp-key-1","scope":"workspace"}',
        '2026-07-13T12:00:00.000Z'
      )
    `).run(id, idempotencyKey, 'e'.repeat(64));
  }

  it('creates normalized run, item, and attempt tables', () => {
    const tables = (db.prepare(`
      SELECT name FROM sqlite_master WHERE type = 'table'
    `).all() as Array<{ name: string }>).map(row => row.name);
    expect(tables).toEqual(expect.arrayContaining([
      'brand_generation_runs',
      'brand_generation_items',
      'brand_generation_commands',
      'brand_generation_attempts',
      'brand_generation_effect_events',
    ]));
  });

  it('scopes start idempotency to workspace and intake revision', () => {
    insertRun();
    expect(() => insertRun('brand-run-2', 'start-1')).toThrow();
    expect(() => insertRun('brand-run-2', 'start-2')).not.toThrow();
  });

  it('enforces foundation/durable artifact mutual exclusion', () => {
    insertRun();
    insertFoundationItem();
    expect(() => db.prepare(`
      UPDATE brand_generation_items
      SET content = 'must not become a deliverable'
      WHERE id = 'brand-item-foundation'
    `).run()).toThrow();
    expect(() => db.prepare(`
      INSERT INTO brand_generation_items (
        id, run_id, workspace_id, target, status, created_at, updated_at
      ) VALUES (
        'brand-item-invalid', 'brand-run-1', 'ws-1', 'mission', 'queued',
        '2026-07-13T12:00:00.000Z', '2026-07-13T12:00:00.000Z'
      )
    `).run()).toThrow();
    expect(() => insertDurableItem()).not.toThrow();
  });

  it('keeps attempt checkpoints unique and preserves a bounded candidate output', () => {
    insertRun();
    insertDurableItem();
    insertStartCommand();
    const insertAttempt = db.prepare(`
      INSERT INTO brand_generation_attempts (
        id, item_id, run_id, command_id, attempt_number, stage, status,
        expected_run_revision, expected_item_revision, expected_deliverable_version,
        source_input_fingerprint, effective_input_fingerprint,
        output_snapshot_json, started_at, completed_at
      ) VALUES (
        ?, 'brand-item-mission', 'brand-run-1', 'brand-command-start', 1, 'dependent_generation',
        'completed', 0, 0, 0, ?, ?, '{"content":"candidate"}',
        '2026-07-13T12:00:00.000Z', '2026-07-13T12:00:01.000Z'
      )
    `);
    insertAttempt.run('attempt-1', 'c'.repeat(64), 'd'.repeat(64));
    expect(() => insertAttempt.run('attempt-2', 'c'.repeat(64), 'd'.repeat(64))).toThrow();
    expect(db.prepare(`
      SELECT output_snapshot_json FROM brand_generation_attempts WHERE id = 'attempt-1'
    `).get()).toEqual({ output_snapshot_json: '{"content":"candidate"}' });
    expect(() => db.prepare(`
      UPDATE brand_generation_attempts SET command_id = 'missing-command'
      WHERE id = 'attempt-1'
    `).run()).toThrow();
    expect(() => db.prepare(`
      UPDATE brand_generation_attempts SET output_snapshot_json = NULL
      WHERE id = 'attempt-1'
    `).run()).toThrow();
  });

  it('preserves immutable command jobs, request snapshots, attribution, and replay identity', () => {
    insertRun();
    insertStartCommand();
    expect(() => insertStartCommand('brand-command-duplicate', 'start-1')).toThrow();
    expect(db.prepare(`
      SELECT job_id, request_snapshot_json, actor_json, mcp_execution_context_json
      FROM brand_generation_commands WHERE id = 'brand-command-start'
    `).get()).toEqual({
      job_id: 'job-start-1',
      request_snapshot_json: '{"schemaVersion":1,"kind":"start","command":{"selection":{"kind":"preset","preset":"full_brand_system"}}}',
      actor_json: '{"actorType":"mcp","actorId":"mcp-key-1"}',
      mcp_execution_context_json: '{"actorType":"mcp","keyId":"mcp-key-1","scope":"workspace"}',
    });
  });

  it('stores revision direction and exact prior review state on the item-scoped command', () => {
    insertRun();
    insertDurableItem();
    db.prepare(`
      INSERT INTO brand_generation_commands (
        id, run_id, workspace_id, item_id, command_kind, idempotency_key,
        request_fingerprint, request_snapshot_json, expected_run_revision,
        expected_item_revision, expected_deliverable_version, prior_item_status,
        job_id, result_json, actor_json, created_at
      ) VALUES (
        'brand-command-revision', 'brand-run-1', 'ws-1', 'brand-item-mission',
        'revision', 'revision-1', ?,
        '{"schemaVersion":1,"kind":"revision","command":{"direction":"Make it warmer without adding claims."}}',
        2, 4, 1, 'changes_requested', 'job-revision-1',
        '{"runId":"brand-run-1","runRevision":3,"jobId":"job-revision-1","selectionCount":1}',
        '{"actorType":"operator","actorId":"operator-1"}',
        '2026-07-13T12:01:00.000Z'
      )
    `).run('f'.repeat(64));
    expect(db.prepare(`
      SELECT request_snapshot_json, prior_item_status, job_id, actor_json
      FROM brand_generation_commands WHERE id = 'brand-command-revision'
    `).get()).toEqual({
      request_snapshot_json: '{"schemaVersion":1,"kind":"revision","command":{"direction":"Make it warmer without adding claims."}}',
      prior_item_status: 'changes_requested',
      job_id: 'job-revision-1',
      actor_json: '{"actorType":"operator","actorId":"operator-1"}',
    });
  });

  it('rejects missing and cross-workspace committed deliverable links', () => {
    insertRun();
    insertDurableItem();
    const commit = db.prepare(`
      UPDATE brand_generation_items
      SET committed_deliverable_id = ?, committed_deliverable_version = 1
      WHERE id = 'brand-item-mission'
    `);
    expect(() => commit.run('missing-deliverable')).toThrow();
    expect(() => commit.run('deliverable-ws-2')).toThrow();
    expect(() => commit.run('deliverable-ws-1')).not.toThrow();
  });

  it('rejects budget overspend and cascades only with workspace deletion', () => {
    insertRun();
    insertFoundationItem();
    expect(() => db.prepare(`
      UPDATE brand_generation_runs SET reserved_provider_calls = 115
      WHERE id = 'brand-run-1'
    `).run()).toThrow();
    expect(() => db.prepare(`
      UPDATE brand_generation_runs SET estimated_provider_calls = 115
      WHERE id = 'brand-run-1'
    `).run()).toThrow();
    db.prepare(`DELETE FROM workspaces WHERE id = 'ws-1'`).run();
    expect(db.prepare(`SELECT COUNT(*) AS count FROM brand_generation_runs`).get())
      .toEqual({ count: 0 });
    expect(db.prepare(`SELECT COUNT(*) AS count FROM brand_generation_items`).get())
      .toEqual({ count: 0 });
    expect(db.prepare(`SELECT COUNT(*) AS count FROM brand_generation_commands`).get())
      .toEqual({ count: 0 });
  });

  it('rejects non-integer lifecycle, budget, count, and revision values', () => {
    insertRun();
    insertDurableItem();
    for (const sql of [
      `UPDATE brand_generation_runs SET selected_count = 'not-a-count' WHERE id = 'brand-run-1'`,
      `UPDATE brand_generation_runs SET max_concurrency = 1.5 WHERE id = 'brand-run-1'`,
      `UPDATE brand_generation_items SET revision = 0.5 WHERE id = 'brand-item-mission'`,
    ]) {
      expect(() => db.prepare(sql).run()).toThrow();
    }
  });
});
