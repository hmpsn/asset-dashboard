import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const migrationSql = readFileSync(
  new URL('../../server/db/migrations/196-mcp-api-key-profile.sql', import.meta.url),
  'utf8',
);

describe('196 MCP API key profile migration', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE mcp_api_keys (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        key_hash TEXT NOT NULL,
        label TEXT NOT NULL,
        created_at TEXT NOT NULL,
        last_used_at TEXT,
        revoked_at TEXT
      );
      INSERT INTO mcp_api_keys (
        id, workspace_id, key_hash, label, created_at, last_used_at, revoked_at
      ) VALUES ('legacy-key', 'ws-legacy', 'hash', 'Legacy', '2026-07-23T00:00:00.000Z', NULL, NULL);
    `);
    db.exec(migrationSql);
  });

  afterEach(() => db.close());

  it('adds a non-null profile that backfills existing credentials to full', () => {
    const profileColumn = db.prepare(`PRAGMA table_info(mcp_api_keys)`).all()
      .find((column: { name: string }) => column.name === 'profile') as {
        notnull: number;
        dflt_value: string | null;
      } | undefined;
    expect(profileColumn).toMatchObject({ notnull: 1, dflt_value: "'full'" });

    const legacy = db.prepare(`SELECT profile FROM mcp_api_keys WHERE id = 'legacy-key'`).get() as {
      profile: string;
    };
    expect(legacy.profile).toBe('full');
  });

  it('allows only full and client profiles while applying full by default', () => {
    const insert = db.prepare(`
      INSERT INTO mcp_api_keys (id, workspace_id, key_hash, label, created_at)
      VALUES (?, 'ws-new', ?, 'Key', '2026-07-23T00:00:00.000Z')
    `);
    insert.run('default-key', 'hash-default');
    const insertWithProfile = db.prepare(`
      INSERT INTO mcp_api_keys (id, workspace_id, key_hash, label, created_at, profile)
      VALUES (?, 'ws-new', ?, 'Key', '2026-07-23T00:00:00.000Z', ?)
    `);
    insertWithProfile.run('client-key', 'hash-client', 'client');

    expect(db.prepare(`SELECT profile FROM mcp_api_keys WHERE id = 'default-key'`).get())
      .toEqual({ profile: 'full' });
    expect(db.prepare(`SELECT profile FROM mcp_api_keys WHERE id = 'client-key'`).get())
      .toEqual({ profile: 'client' });
    expect(() => insertWithProfile.run('invalid-key', 'hash-invalid', 'operator'))
      .toThrow(/CHECK constraint failed/);
    expect(() => db.prepare(`
      INSERT INTO mcp_api_keys (id, workspace_id, key_hash, label, created_at, profile)
      VALUES ('null-key', 'ws-new', 'hash-null', 'Key', '2026-07-23T00:00:00.000Z', NULL)
    `).run()).toThrow();
  });
});
