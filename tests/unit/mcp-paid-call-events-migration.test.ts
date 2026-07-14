import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const migrationSql = readFileSync(
  new URL('../../server/db/migrations/188-mcp-paid-call-events.sql', import.meta.url),
  'utf8',
);

describe('188 MCP paid-call event migration', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(migrationSql);
  });

  afterEach(() => db.close());

  it('creates a generic durable event ledger with a workspace lookup index', () => {
    const table = db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name = 'mcp_paid_call_events'
    `).get();
    const index = db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'index' AND name = 'idx_mcp_paid_call_events_workspace_recorded'
    `).get();

    expect(table).toBeDefined();
    expect(index).toBeDefined();
  });

  it('uses the event key as the exactly-once authority and rejects invalid increments', () => {
    const insert = db.prepare(`
      INSERT INTO mcp_paid_call_events (
        event_key, workspace_id, increment, recorded_at
      ) VALUES (?, ?, ?, '2026-07-14T12:00:00.000Z')
    `);

    insert.run('mcp:test:accepted-command:job-1', 'ws-1', 1);

    expect(() => insert.run('mcp:test:accepted-command:job-1', 'ws-1', 1)).toThrow();
    expect(() => insert.run('mcp:test:accepted-command:job-2', 'ws-1', 0)).toThrow();
    expect(() => insert.run('   ', 'ws-1', 1)).toThrow();
  });
});
