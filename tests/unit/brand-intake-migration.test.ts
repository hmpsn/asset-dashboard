import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const migrationSql = fs.readFileSync(
  path.resolve('server/db/migrations/185-brand-intake-revisions.sql'),
  'utf8',
);

interface InsertRevisionOptions {
  id: string;
  revision: number;
  fingerprint?: string;
  mutationFingerprint?: string;
  idempotencyKey?: string | null;
  supersedesRevisionId?: string | null;
}

describe('brand intake revision migration', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec('CREATE TABLE workspaces (id TEXT PRIMARY KEY)');
    db.exec(migrationSql);
    db.prepare('INSERT INTO workspaces (id) VALUES (?)').run('workspace-1');
  });

  afterEach(() => db.close());

  function insertRevision(options: InsertRevisionOptions): void {
    db.prepare(`
      INSERT INTO brand_intake_revisions (
        id, workspace_id, revision, schema_version, payload_json,
        evidence_resolutions_json, fingerprint, source, submitter_json,
        mutation_kind, mutation_fingerprint, idempotency_key,
        supersedes_revision_id, created_at
      ) VALUES (
        @id, 'workspace-1', @revision, 1, '{}', '[]', @fingerprint,
        'admin', '{"actorType":"operator","actorId":"operator-1"}',
        @mutation_kind, @mutation_fingerprint, @idempotency_key,
        @supersedes_revision_id, '2026-07-13T12:00:00.000Z'
      )
    `).run({
      id: options.id,
      revision: options.revision,
      fingerprint: options.fingerprint ?? options.revision.toString(16).padStart(64, '0'),
      mutation_kind: options.idempotencyKey ? 'evidence_resolution' : 'submission',
      mutation_fingerprint:
        options.mutationFingerprint ?? (options.revision + 100).toString(16).padStart(64, '0'),
      idempotency_key: options.idempotencyKey ?? null,
      supersedes_revision_id: options.supersedesRevisionId ?? null,
    });
  }

  it('enforces one monotonic revision number and one linear successor per workspace', () => {
    insertRevision({ id: 'intake-a', revision: 1 });
    insertRevision({ id: 'intake-b', revision: 2, supersedesRevisionId: 'intake-a' });

    expect(() => insertRevision({
      id: 'intake-duplicate-revision',
      revision: 2,
      supersedesRevisionId: 'intake-b',
    })).toThrow();
    expect(() => insertRevision({
      id: 'intake-second-successor',
      revision: 3,
      supersedesRevisionId: 'intake-a',
    })).toThrow();
  });

  it('binds one idempotency key to one evidence mutation', () => {
    insertRevision({ id: 'intake-a', revision: 1 });
    insertRevision({
      id: 'intake-b',
      revision: 2,
      supersedesRevisionId: 'intake-a',
      idempotencyKey: 'resolve-1',
    });
    expect(() => insertRevision({
      id: 'intake-c',
      revision: 3,
      supersedesRevisionId: 'intake-b',
      idempotencyKey: 'resolve-1',
    })).toThrow();
  });

  it('allows a later revision to restore an earlier effective fingerprint', () => {
    const originalFingerprint = 'a'.repeat(64);
    insertRevision({ id: 'intake-a', revision: 1, fingerprint: originalFingerprint });
    insertRevision({
      id: 'intake-b',
      revision: 2,
      fingerprint: 'b'.repeat(64),
      supersedesRevisionId: 'intake-a',
    });
    insertRevision({
      id: 'intake-c',
      revision: 3,
      fingerprint: originalFingerprint,
      supersedesRevisionId: 'intake-b',
    });

    const rows = db.prepare(`
      SELECT id, revision FROM brand_intake_revisions
      WHERE workspace_id = 'workspace-1'
      ORDER BY revision
    `).all();
    expect(rows).toEqual([
      { id: 'intake-a', revision: 1 },
      { id: 'intake-b', revision: 2 },
      { id: 'intake-c', revision: 3 },
    ]);
  });

  it('rejects malformed JSON/fingerprints and cascades workspace deletion', () => {
    insertRevision({ id: 'intake-a', revision: 1 });
    expect(() => db.prepare(`
      UPDATE brand_intake_revisions SET payload_json = 'not-json' WHERE id = 'intake-a'
    `).run()).toThrow();
    expect(() => db.prepare(`
      UPDATE brand_intake_revisions SET fingerprint = ? WHERE id = 'intake-a'
    `).run('A'.repeat(64))).toThrow();

    db.prepare('DELETE FROM workspaces WHERE id = ?').run('workspace-1');
    expect(
      db.prepare('SELECT COUNT(*) AS count FROM brand_intake_revisions').get(),
    ).toEqual({ count: 0 });
  });
});
