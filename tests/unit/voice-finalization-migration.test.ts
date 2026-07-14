import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const migrationSql = fs.readFileSync(
  path.resolve('server/db/migrations/186-voice-profile-finalizations.sql'),
  'utf8',
);

describe('voice profile finalization migration', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec('CREATE TABLE workspaces (id TEXT PRIMARY KEY)');
    db.exec(`
      CREATE TABLE voice_profiles (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL UNIQUE REFERENCES workspaces(id) ON DELETE CASCADE,
        status TEXT NOT NULL DEFAULT 'draft',
        voice_dna_json TEXT,
        guardrails_json TEXT,
        context_modifiers_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
    db.exec(migrationSql);
    db.prepare('INSERT INTO workspaces (id) VALUES (?)').run('ws-1');
    db.prepare(`
      INSERT INTO voice_profiles (
        id, workspace_id, status, created_at, updated_at
      ) VALUES ('vp-1', 'ws-1', 'calibrating', '2026-07-13T10:00:00.000Z', '2026-07-13T10:00:00.000Z')
    `).run();
  });

  afterEach(() => db.close());

  function insertFinalization(overrides: Record<string, unknown> = {}): void {
    db.prepare(`
      INSERT INTO voice_profile_finalizations (
        id, workspace_id, voice_profile_id, voice_version, profile_revision,
        voice_dna_json, guardrails_json, context_modifiers_json, anchors_json,
        calibration_selections_json, finalized_by_json, execution_actor_json,
        fingerprint, mutation_fingerprint, idempotency_key, authorization_id,
        finalized_at, created_at
      ) VALUES (
        @id, @workspace_id, @voice_profile_id, @voice_version, @profile_revision,
        @voice_dna_json, @guardrails_json, '[]', @anchors_json,
        '[]', @finalized_by_json, @execution_actor_json,
        @fingerprint, @mutation_fingerprint, @idempotency_key, @authorization_id,
        '2026-07-13T12:00:00.000Z', '2026-07-13T12:00:00.000Z'
      )
    `).run({
      id: 'voice-final-1',
      workspace_id: 'ws-1',
      voice_profile_id: 'vp-1',
      voice_version: 1,
      profile_revision: 2,
      voice_dna_json: '{"personalityTraits":["warm"]}',
      guardrails_json: '{"toneBoundaries":["never pressure"]}',
      anchors_json: '[{"selector":{"kind":"voice_sample","voiceSampleId":"vs-1"}}]',
      finalized_by_json: '{"actorType":"operator","actorId":"operator-1"}',
      execution_actor_json: '{"actorType":"operator","actorId":"operator-1"}',
      fingerprint: 'a'.repeat(64),
      mutation_fingerprint: 'b'.repeat(64),
      idempotency_key: 'finalize-1',
      authorization_id: null,
      ...overrides,
    });
  }

  function insertAuthorization(overrides: Record<string, unknown> = {}): void {
    db.prepare(`
      INSERT INTO voice_finalization_authorizations (
        id, token_hash, workspace_id, voice_profile_id,
        expected_profile_revision, request_json, mutation_fingerprint,
        authorized_by_json, issued_at, expires_at, consumed_at, finalization_id,
        execution_actor_json
      ) VALUES (
        @id, @token_hash, 'ws-1', 'vp-1', 1, @request_json,
        @mutation_fingerprint, @authorized_by_json,
        @issued_at, @expires_at, @consumed_at, @finalization_id,
        @execution_actor_json
      )
    `).run({
      id: 'auth-1',
      token_hash: 'c'.repeat(64),
      request_json: JSON.stringify({ expectedProfileRevision: 1 }),
      mutation_fingerprint: 'd'.repeat(64),
      authorized_by_json: '{"actorType":"operator","actorId":"operator-1"}',
      issued_at: '2026-07-13T11:45:00.000Z',
      expires_at: '2026-07-13T12:00:00.000Z',
      consumed_at: null,
      finalization_id: null,
      execution_actor_json: null,
      ...overrides,
    });
  }

  function consumeAuthorization(
    consumedAt = '2026-07-13T11:59:59.999Z',
    executionActorJson = '{"actorType":"mcp","actorId":"mcp-key-1","actorLabel":"Primary MCP"}',
  ): void {
    db.prepare(`
      UPDATE voice_finalization_authorizations
      SET consumed_at = ?,
          finalization_id = 'voice-final-1',
          execution_actor_json = ?
      WHERE id = 'auth-1'
    `).run(consumedAt, executionActorJson);
  }

  function insertAuthorizedFinalization(overrides: Record<string, unknown> = {}): void {
    insertFinalization({
      authorization_id: 'auth-1',
      mutation_fingerprint: 'd'.repeat(64),
      execution_actor_json: '{"actorType":"mcp","actorId":"mcp-key-1","actorLabel":"Primary MCP"}',
      ...overrides,
    });
  }

  it('adds a positive profile revision without fabricating finalization history', () => {
    expect(db.prepare('SELECT revision FROM voice_profiles WHERE id = ?').get('vp-1'))
      .toEqual({ revision: 1 });
    expect(db.prepare('SELECT COUNT(*) AS count FROM voice_profile_finalizations').get())
      .toEqual({ count: 0 });
  });

  it('enforces immutable monotonic voice versions and scoped idempotency', () => {
    insertFinalization();
    expect(() => insertFinalization({ id: 'voice-final-2' })).toThrow();
    expect(() => insertFinalization({
      id: 'voice-final-2',
      voice_version: 2,
      idempotency_key: 'finalize-1',
    })).toThrow();
    expect(() => db.prepare(`
      UPDATE voice_profile_finalizations SET voice_version = 2 WHERE id = 'voice-final-1'
    `).run()).toThrow(/immutable/);
    expect(() => db.prepare(`
      DELETE FROM voice_profile_finalizations WHERE id = 'voice-final-1'
    `).run()).toThrow(/immutable/);
  });

  it('defaults to storage codec V1 and rejects impossible revision-one finalizations', () => {
    expect(() => insertFinalization({
      id: 'impossible-revision-one',
      profile_revision: 1,
    })).toThrow();

    insertFinalization();
    expect(db.prepare(`
      SELECT schema_version, profile_revision
      FROM voice_profile_finalizations
      WHERE id = 'voice-final-1'
    `).get()).toEqual({ schema_version: 1, profile_revision: 2 });
  });

  it('rejects empty anchors, malformed JSON, non-operator finalizers, and bad fingerprints', () => {
    expect(() => insertFinalization({ id: 'empty', anchors_json: '[]' })).toThrow();
    expect(() => insertFinalization({ id: 'bad-json', anchors_json: 'nope' })).toThrow();
    expect(() => insertFinalization({
      id: 'bad-actor',
      finalized_by_json: '{"actorType":"mcp","actorId":"key-1"}',
    })).toThrow();
    expect(() => insertFinalization({
      id: 'missing-finalizer',
      finalized_by_json: '{}',
    })).toThrow();
    expect(() => insertFinalization({
      id: 'missing-finalizer-id',
      finalized_by_json: '{"actorType":"operator"}',
    })).toThrow();
    expect(() => insertFinalization({ id: 'bad-fingerprint', fingerprint: 'A'.repeat(64) }))
      .toThrow();
  });

  it('accepts only strict operator-or-MCP immutable execution provenance', () => {
    expect(() => insertFinalization({
      id: 'missing-executor',
      execution_actor_json: '{}',
    })).toThrow();
    expect(() => insertFinalization({
      id: 'missing-executor-id',
      execution_actor_json: '{"actorType":"mcp"}',
    })).toThrow();
    expect(() => insertFinalization({
      id: 'client-executor',
      execution_actor_json: '{"actorType":"client","actorId":"client-1"}',
    })).toThrow();
    expect(() => insertFinalization({
      id: 'system-executor',
      execution_actor_json: '{"actorType":"system","actorId":"system-1"}',
    })).toThrow();
    expect(() => insertFinalization({
      id: 'extra-executor-field',
      execution_actor_json: '{"actorType":"operator","actorId":"operator-1","extra":true}',
    })).toThrow();
    expect(() => insertFinalization({
      id: 'padded-executor-id',
      execution_actor_json: '{"actorType":"mcp","actorId":" key-1 "}',
    })).toThrow();

    expect(() => insertFinalization({
      id: 'mcp-without-authorization',
      execution_actor_json: '{"actorType":"mcp","actorId":"key-1"}',
    })).toThrow();
    expect(() => insertFinalization({
      id: 'mcp-with-missing-authorization',
      authorization_id: 'auth-missing',
      execution_actor_json: '{"actorType":"mcp","actorId":"key-1"}',
    })).toThrow(/exact active operator authorization/);

    insertAuthorization();
    expect(() => insertFinalization({
      id: 'operator-with-authorization',
      authorization_id: 'auth-1',
    })).toThrow();
    expect(() => insertFinalization({
      id: 'mcp-wrong-fingerprint',
      authorization_id: 'auth-1',
      execution_actor_json: '{"actorType":"mcp","actorId":"key-1"}',
    })).toThrow(/exact active operator authorization/);
    expect(() => insertFinalization({
      id: 'mcp-wrong-finalizer',
      authorization_id: 'auth-1',
      mutation_fingerprint: 'd'.repeat(64),
      finalized_by_json: '{"actorType":"operator","actorId":"operator-2"}',
      execution_actor_json: '{"actorType":"mcp","actorId":"key-1"}',
    })).toThrow(/exact active operator authorization/);

    insertFinalization({
      id: 'mcp-executor',
      authorization_id: 'auth-1',
      mutation_fingerprint: 'd'.repeat(64),
      execution_actor_json: '{"actorType":"mcp","actorId":"key-1","actorLabel":"Primary MCP"}',
    });
    expect(db.prepare(`
      SELECT execution_actor_json
      FROM voice_profile_finalizations
      WHERE id = 'mcp-executor'
    `).get()).toEqual({
      execution_actor_json: '{"actorType":"mcp","actorId":"key-1","actorLabel":"Primary MCP"}',
    });
  });

  it('requires strict operator attribution on authorization rows', () => {
    expect(() => insertAuthorization({ authorized_by_json: '{}' })).toThrow();
    expect(() => insertAuthorization({
      authorized_by_json: '{"actorType":"operator"}',
    })).toThrow();
    expect(() => insertAuthorization({
      authorized_by_json: '{"actorType":"mcp","actorId":"key-1"}',
    })).toThrow();
    expect(() => insertAuthorization({
      authorized_by_json: '{"actorType":"operator","actorId":"operator-1","extra":true}',
    })).toThrow();

    insertAuthorization();
    expect(db.prepare(`
      SELECT authorized_by_json
      FROM voice_finalization_authorizations
      WHERE id = 'auth-1'
    `).get()).toEqual({
      authorized_by_json: '{"actorType":"operator","actorId":"operator-1"}',
    });
  });

  it('binds one-time authorization fields and allows exactly one consumption update', () => {
    insertAuthorization();
    insertAuthorizedFinalization();
    expect(db.prepare(`
      SELECT request_schema_version
      FROM voice_finalization_authorizations
      WHERE id = 'auth-1'
    `).get()).toEqual({ request_schema_version: 1 });
    consumeAuthorization();
    expect(() => db.prepare(`
      UPDATE voice_finalization_authorizations
      SET expires_at = '2026-07-14T12:00:00.000Z'
      WHERE id = 'auth-1'
    `).run()).toThrow(/immutable|consumed/);
    expect(() => db.prepare(`
      UPDATE voice_finalization_authorizations
      SET request_schema_version = 2
      WHERE id = 'auth-1'
    `).run()).toThrow(/immutable|consumed/);
  });

  it('binds origin authorization consumption to the artifact executor', () => {
    insertAuthorization();
    insertAuthorizedFinalization();

    expect(() => consumeAuthorization(
      '2026-07-13T11:59:59.999Z',
      '{"actorType":"mcp","actorId":"different-key"}',
    )).toThrow(/result does not match/);
    consumeAuthorization();
  });

  it('allows an exact redundant authorization to link a direct operator artifact', () => {
    insertAuthorization();
    insertFinalization({ mutation_fingerprint: 'd'.repeat(64) });

    consumeAuthorization();
    expect(db.prepare(`
      SELECT finalization_id, execution_actor_json
      FROM voice_finalization_authorizations
      WHERE id = 'auth-1'
    `).get()).toEqual({
      finalization_id: 'voice-final-1',
      execution_actor_json: '{"actorType":"mcp","actorId":"mcp-key-1","actorLabel":"Primary MCP"}',
    });
  });

  it('rejects redundant authorization linkage to a different command', () => {
    insertAuthorization();
    insertFinalization();

    expect(() => consumeAuthorization()).toThrow(/result does not match/);
  });

  it('requires parseable, ordered authorization timestamps within the exact 15-minute TTL', () => {
    insertAuthorization();
    insertAuthorization({
      id: 'auth-exact-fractional',
      token_hash: '3'.repeat(64),
      issued_at: '2026-07-13T01:37:42.123Z',
      expires_at: '2026-07-13T01:52:42.123Z',
    });
    expect(db.prepare(`
      SELECT issued_at, expires_at
      FROM voice_finalization_authorizations
      WHERE id = 'auth-1'
    `).get()).toEqual({
      issued_at: '2026-07-13T11:45:00.000Z',
      expires_at: '2026-07-13T12:00:00.000Z',
    });

    expect(() => insertAuthorization({
      id: 'auth-bad-issued',
      token_hash: 'e'.repeat(64),
      issued_at: 'not-a-timestamp',
    })).toThrow();
    expect(() => insertAuthorization({
      id: 'auth-bad-expires',
      token_hash: 'f'.repeat(64),
      expires_at: 'not-a-timestamp',
    })).toThrow();
    expect(() => insertAuthorization({
      id: 'auth-inverted',
      token_hash: '1'.repeat(64),
      expires_at: '2026-07-13T11:44:59.999Z',
    })).toThrow();
    expect(() => insertAuthorization({
      id: 'auth-overlong',
      token_hash: '2'.repeat(64),
      expires_at: '2026-07-13T12:00:00.001Z',
    })).toThrow();
  });

  it('requires consumed timestamps to be inside the issued-to-expiry window', () => {
    insertAuthorization();
    insertAuthorizedFinalization();

    const consume = db.prepare(`
      UPDATE voice_finalization_authorizations
      SET consumed_at = ?,
          finalization_id = 'voice-final-1',
          execution_actor_json = '{"actorType":"mcp","actorId":"mcp-key-1","actorLabel":"Primary MCP"}'
      WHERE id = 'auth-1'
    `);
    expect(() => consume.run('not-a-timestamp')).toThrow();
    expect(() => consume.run('2026-07-13T11:44:59.999Z')).toThrow();
    expect(() => consume.run('2026-07-13T12:00:00.000Z')).toThrow();

    consume.run('2026-07-13T11:45:00.000Z');
    expect(db.prepare(`
      SELECT consumed_at, finalization_id
      FROM voice_finalization_authorizations
      WHERE id = 'auth-1'
    `).get()).toEqual({
      consumed_at: '2026-07-13T11:45:00.000Z',
      finalization_id: 'voice-final-1',
    });
  });

  it('requires complete, valid MCP execution provenance on consumption', () => {
    insertAuthorization();
    insertAuthorizedFinalization();

    expect(() => db.prepare(`
      UPDATE voice_finalization_authorizations
      SET consumed_at = '2026-07-13T11:59:59.999Z',
          finalization_id = 'voice-final-1'
      WHERE id = 'auth-1'
    `).run()).toThrow();
    expect(() => db.prepare(`
      UPDATE voice_finalization_authorizations
      SET execution_actor_json = '{"actorType":"mcp","actorId":"mcp-key-1"}'
      WHERE id = 'auth-1'
    `).run()).toThrow();
    expect(() => consumeAuthorization(
      '2026-07-13T11:59:59.999Z',
      'not-json',
    )).toThrow();
    expect(() => consumeAuthorization(
      '2026-07-13T11:59:59.999Z',
      '{}',
    )).toThrow();
    expect(() => consumeAuthorization(
      '2026-07-13T11:59:59.999Z',
      '{"actorType":"mcp"}',
    )).toThrow();
    expect(() => consumeAuthorization(
      '2026-07-13T11:59:59.999Z',
      '{"actorType":"operator","actorId":"operator-1"}',
    )).toThrow();
    expect(() => consumeAuthorization(
      '2026-07-13T11:59:59.999Z',
      '{"actorType":"mcp","actorId":""}',
    )).toThrow();
    expect(() => consumeAuthorization(
      '2026-07-13T11:59:59.999Z',
      '{"actorType":"mcp","actorId":" mcp-key-1 "}',
    )).toThrow();
    expect(() => consumeAuthorization(
      '2026-07-13T11:59:59.999Z',
      JSON.stringify({ actorType: 'mcp', actorId: 'x'.repeat(129) }),
    )).toThrow();
    expect(() => consumeAuthorization(
      '2026-07-13T11:59:59.999Z',
      '{"actorType":"mcp","actorId":"mcp-key-1","actorLabel":""}',
    )).toThrow();
    expect(() => consumeAuthorization(
      '2026-07-13T11:59:59.999Z',
      JSON.stringify({
        actorType: 'mcp',
        actorId: 'mcp-key-1',
        actorLabel: 'x'.repeat(201),
      }),
    )).toThrow();
    expect(() => consumeAuthorization(
      '2026-07-13T11:59:59.999Z',
      '{"actorType":"mcp","actorId":"mcp-key-1","extra":true}',
    )).toThrow();
    expect(() => consumeAuthorization(
      '2026-07-13T11:59:59.999Z',
      `${' '.repeat(4096)}{"actorType":"mcp","actorId":"mcp-key-1"}`,
    )).toThrow();

    consumeAuthorization();
    expect(db.prepare(`
      SELECT execution_actor_json
      FROM voice_finalization_authorizations
      WHERE id = 'auth-1'
    `).get()).toEqual({
      execution_actor_json: '{"actorType":"mcp","actorId":"mcp-key-1","actorLabel":"Primary MCP"}',
    });
  });

  it('keeps the execution actor immutable after authorization consumption', () => {
    insertAuthorization();
    insertAuthorizedFinalization();
    consumeAuthorization();

    expect(() => db.prepare(`
      UPDATE voice_finalization_authorizations
      SET execution_actor_json = '{"actorType":"mcp","actorId":"different-key"}'
      WHERE id = 'auth-1'
    `).run()).toThrow(/immutable|consumed/);
  });

  it('forbids direct deletion of consumed authorization proof', () => {
    insertAuthorization();
    insertAuthorizedFinalization();
    consumeAuthorization();

    expect(() => db.prepare(`
      DELETE FROM voice_finalization_authorizations WHERE id = 'auth-1'
    `).run()).toThrow(/consumed or active.*immutable/);
    expect(db.prepare(`
      SELECT COUNT(*) AS count FROM voice_finalization_authorizations
    `).get()).toEqual({ count: 1 });
  });

  it('allows cleanup deletion of an expired, unconsumed authorization', () => {
    const now = Date.now();
    insertAuthorization({
      issued_at: new Date(now - 20 * 60 * 1_000).toISOString(),
      expires_at: new Date(now - 10 * 60 * 1_000).toISOString(),
    });
    db.prepare(`
      DELETE FROM voice_finalization_authorizations WHERE id = 'auth-1'
    `).run();
    expect(db.prepare(`
      SELECT COUNT(*) AS count FROM voice_finalization_authorizations
    `).get()).toEqual({ count: 0 });
  });

  it('forbids cleanup deletion of an active, unconsumed authorization', () => {
    const now = Date.now();
    insertAuthorization({
      issued_at: new Date(now - 60 * 1_000).toISOString(),
      expires_at: new Date(now + 10 * 60 * 1_000).toISOString(),
    });

    expect(() => db.prepare(`
      DELETE FROM voice_finalization_authorizations WHERE id = 'auth-1'
    `).run()).toThrow(/consumed or active.*immutable/);
    expect(db.prepare(`
      SELECT COUNT(*) AS count FROM voice_finalization_authorizations
    `).get()).toEqual({ count: 1 });
  });

  it('cascades consumed proof and finalization history with the owning workspace', () => {
    insertAuthorization();
    insertAuthorizedFinalization();
    consumeAuthorization();
    db.prepare('DELETE FROM workspaces WHERE id = ?').run('ws-1');
    expect(db.prepare('SELECT COUNT(*) AS count FROM voice_profile_finalizations').get())
      .toEqual({ count: 0 });
    expect(db.prepare('SELECT COUNT(*) AS count FROM voice_finalization_authorizations').get())
      .toEqual({ count: 0 });
  });

  it('cascades consumed proof and finalization history with the owning profile', () => {
    insertAuthorization();
    insertAuthorizedFinalization();
    consumeAuthorization();
    db.prepare('DELETE FROM voice_profiles WHERE id = ?').run('vp-1');
    expect(db.prepare('SELECT COUNT(*) AS count FROM voice_profile_finalizations').get())
      .toEqual({ count: 0 });
    expect(db.prepare('SELECT COUNT(*) AS count FROM voice_finalization_authorizations').get())
      .toEqual({ count: 0 });
    expect(db.prepare('SELECT COUNT(*) AS count FROM workspaces').get())
      .toEqual({ count: 1 });
  });
});
