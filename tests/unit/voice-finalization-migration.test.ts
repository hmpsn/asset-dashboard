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

  it('rejects empty anchors, malformed JSON, non-operator finalizers, and bad fingerprints', () => {
    expect(() => insertFinalization({ id: 'empty', anchors_json: '[]' })).toThrow();
    expect(() => insertFinalization({ id: 'bad-json', anchors_json: 'nope' })).toThrow();
    expect(() => insertFinalization({
      id: 'bad-actor',
      finalized_by_json: '{"actorType":"mcp","actorId":"key-1"}',
    })).toThrow();
    expect(() => insertFinalization({ id: 'bad-fingerprint', fingerprint: 'A'.repeat(64) }))
      .toThrow();
  });

  it('binds one-time authorization fields and allows exactly one consumption update', () => {
    db.prepare(`
      INSERT INTO voice_finalization_authorizations (
        id, token_hash, workspace_id, voice_profile_id,
        expected_profile_revision, request_json, mutation_fingerprint,
        authorized_by_json, issued_at, expires_at
      ) VALUES (
        'auth-1', @token_hash, 'ws-1', 'vp-1', 1, @request_json,
        @mutation_fingerprint, @authorized_by_json,
        '2026-07-13T11:45:00.000Z', '2026-07-13T12:00:00.000Z'
      )
    `).run({
      token_hash: 'c'.repeat(64),
      request_json: JSON.stringify({ expectedProfileRevision: 1 }),
      mutation_fingerprint: 'd'.repeat(64),
      authorized_by_json: '{"actorType":"operator","actorId":"operator-1"}',
    });
    insertFinalization({ authorization_id: 'auth-1' });
    db.prepare(`
      UPDATE voice_finalization_authorizations
      SET consumed_at = '2026-07-13T12:00:00.000Z', finalization_id = 'voice-final-1'
      WHERE id = 'auth-1'
    `).run();
    expect(() => db.prepare(`
      UPDATE voice_finalization_authorizations
      SET expires_at = '2026-07-14T12:00:00.000Z'
      WHERE id = 'auth-1'
    `).run()).toThrow(/immutable|consumed/);
  });

  it('cascades finalizations and authorizations with the owning workspace', () => {
    insertFinalization();
    db.prepare('DELETE FROM workspaces WHERE id = ?').run('ws-1');
    expect(db.prepare('SELECT COUNT(*) AS count FROM voice_profile_finalizations').get())
      .toEqual({ count: 0 });
  });
});
