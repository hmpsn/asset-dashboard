/**
 * Wave 24-A21 — Pure/integration unit tests for server/client-discovered-queries.ts
 *
 * Covers functions not tested in discovered-queries-lost-visibility.test.ts:
 *   - getLostVisibilityQueries (full row shape + ordering)
 *   - upsertDiscoveredQueries with seenDate override
 *   - edge cases: blank keyword skipping, best_position NULL handling
 *
 * Uses real SQLite DB (same pattern as discovered-queries-lost-visibility.test.ts).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  LOST_VISIBILITY_READ_LIMIT,
  getLostVisibilityCount,
  getLostVisibilityQueries,
  upsertDiscoveredQueries,
} from '../../server/client-discovered-queries.js';
import db from '../../server/db/index.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';

let workspaceId = '';

beforeEach(() => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS discovered_queries (
      workspace_id      TEXT NOT NULL,
      query             TEXT NOT NULL,
      first_seen        TEXT NOT NULL,
      last_seen         TEXT NOT NULL,
      best_position     REAL,
      best_impressions  INTEGER NOT NULL DEFAULT 0,
      total_impressions INTEGER NOT NULL DEFAULT 0,
      snapshot_count    INTEGER NOT NULL DEFAULT 1,
      last_snapshot_date TEXT,
      last_snapshot_impressions INTEGER NOT NULL DEFAULT 0,
      status            TEXT NOT NULL DEFAULT 'active',
      PRIMARY KEY (workspace_id, query)
    );
  `);
  for (const sql of [
    'ALTER TABLE discovered_queries ADD COLUMN last_snapshot_date TEXT',
    'ALTER TABLE discovered_queries ADD COLUMN last_snapshot_impressions INTEGER NOT NULL DEFAULT 0',
  ]) {
    try {
      db.exec(sql);
    } catch {
      // Column already exists in migrated test databases.
    }
  }
  workspaceId = createWorkspace(`Discovered Query Pure Test ${Date.now()}`).id;
});

afterEach(() => {
  db.prepare('DELETE FROM discovered_queries WHERE workspace_id = ?').run(workspaceId);
  deleteWorkspace(workspaceId);
});

// ════════════════════════════════════════════════════════════════════════════
// getLostVisibilityQueries
// ════════════════════════════════════════════════════════════════════════════

describe('getLostVisibilityQueries', () => {
  function insertLostQuery(
    query: string,
    bestPosition: number | null,
    lastSeen: string,
    totalImpressions: number,
  ) {
    db.prepare(`
      INSERT INTO discovered_queries
        (workspace_id, query, first_seen, last_seen, best_position, snapshot_count, total_impressions, status)
      VALUES (?, ?, '2026-01-01', ?, ?, 3, ?, 'lost_visibility')
    `).run(workspaceId, query, lastSeen, bestPosition, totalImpressions);
  }

  it('returns empty array when no lost_visibility rows exist', () => {
    const result = getLostVisibilityQueries(workspaceId);
    expect(result).toHaveLength(0);
  });

  it('returns the correct shape for a lost query', () => {
    insertLostQuery('local seo services', 12.5, '2026-04-01', 300);
    const result = getLostVisibilityQueries(workspaceId);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(
      expect.objectContaining({
        query: 'local seo services',
        lastPosition: 12.5,
        lastSeen: '2026-04-01',
        totalImpressions: 300,
      }),
    );
  });

  it('returns null for lastPosition when best_position is NULL in DB', () => {
    insertLostQuery('no position query', null, '2026-03-15', 100);
    const result = getLostVisibilityQueries(workspaceId);
    expect(result).toHaveLength(1);
    expect(result[0].lastPosition).toBeNull();
  });

  it('orders results by total_impressions descending', () => {
    insertLostQuery('low traffic query', 8.0, '2026-04-01', 50);
    insertLostQuery('high traffic query', 3.2, '2026-04-02', 800);
    insertLostQuery('medium traffic query', 5.5, '2026-04-03', 200);

    const result = getLostVisibilityQueries(workspaceId);
    expect(result).toHaveLength(3);
    expect(result[0].query).toBe('high traffic query');
    expect(result[0].totalImpressions).toBe(800);
    expect(result[1].query).toBe('medium traffic query');
    expect(result[1].totalImpressions).toBe(200);
    expect(result[2].query).toBe('low traffic query');
    expect(result[2].totalImpressions).toBe(50);
  });

  it('caps lost visibility rows to the highest-impression queries', () => {
    for (let i = 0; i < LOST_VISIBILITY_READ_LIMIT + 5; i += 1) {
      insertLostQuery(`query ${i}`, 10 + i, '2026-04-01', i);
    }

    const result = getLostVisibilityQueries(workspaceId);
    expect(result).toHaveLength(LOST_VISIBILITY_READ_LIMIT);
    expect(result[0].query).toBe(`query ${LOST_VISIBILITY_READ_LIMIT + 4}`);
    expect(result.some(row => row.query === 'query 0')).toBe(false);
    expect(getLostVisibilityCount(workspaceId)).toBe(LOST_VISIBILITY_READ_LIMIT + 5);
  });

  it('does not return active queries', () => {
    insertLostQuery('lost query', 10.0, '2026-02-01', 400);
    db.prepare(`
      INSERT INTO discovered_queries
        (workspace_id, query, first_seen, last_seen, best_position, snapshot_count, total_impressions, status)
      VALUES (?, 'active query', '2026-01-01', '2026-05-22', 5.0, 10, 500, 'active')
    `).run(workspaceId);

    const result = getLostVisibilityQueries(workspaceId);
    expect(result).toHaveLength(1);
    expect(result[0].query).toBe('lost query');
  });

  it('is scoped to the correct workspace', () => {
    const otherWorkspaceId = createWorkspace(`Other Workspace ${Date.now()}`).id;
    try {
      insertLostQuery('owned lost query', 7.0, '2026-04-01', 150);
      // Insert a lost query for the other workspace directly
      db.prepare(`
        INSERT INTO discovered_queries
          (workspace_id, query, first_seen, last_seen, best_position, snapshot_count, total_impressions, status)
        VALUES (?, 'other workspace query', '2026-01-01', '2026-04-01', 4.0, 3, 200, 'lost_visibility')
      `).run(otherWorkspaceId);

      const result = getLostVisibilityQueries(workspaceId);
      expect(result).toHaveLength(1);
      expect(result[0].query).toBe('owned lost query');

      const otherResult = getLostVisibilityQueries(otherWorkspaceId);
      expect(otherResult).toHaveLength(1);
      expect(otherResult[0].query).toBe('other workspace query');
    } finally {
      db.prepare('DELETE FROM discovered_queries WHERE workspace_id = ?').run(otherWorkspaceId);
      deleteWorkspace(otherWorkspaceId);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// upsertDiscoveredQueries — edge cases not in discovered-queries-lost-visibility.test.ts
// ════════════════════════════════════════════════════════════════════════════

describe('upsertDiscoveredQueries — edge cases', () => {
  it('skips blank/empty queries', () => {
    upsertDiscoveredQueries(
      workspaceId,
      [
        { query: '', position: 5.0, clicks: 1, impressions: 10, ctr: 10 },
        { query: 'valid keyword', position: 4.0, clicks: 3, impressions: 50, ctr: 6 },
      ],
      '2026-05-22',
    );
    const all = db
      .prepare('SELECT query FROM discovered_queries WHERE workspace_id = ?')
      .all(workspaceId) as Array<{ query: string }>;
    expect(all).toHaveLength(1);
    expect(all[0].query).toBe('valid keyword');
  });

  it('handles null position gracefully (stores NULL for best_position)', () => {
    upsertDiscoveredQueries(
      workspaceId,
      [{ query: 'no position keyword', position: null as unknown as number, clicks: 0, impressions: 20, ctr: 0 }],
      '2026-05-22',
    );
    const row = db
      .prepare('SELECT best_position FROM discovered_queries WHERE workspace_id = ? AND query = ?')
      .get(workspaceId, 'no position keyword') as Record<string, unknown>;
    expect(row).toBeTruthy();
    expect(row.best_position).toBeNull();
  });

  it('uses seenDate from observation when provided, overriding snapshotDate for first/last_seen', () => {
    const overrideDate = '2026-05-10';
    upsertDiscoveredQueries(
      workspaceId,
      [{ query: 'date override test', position: 8.0, clicks: 2, impressions: 40, ctr: 5, seenDate: overrideDate }],
      '2026-05-22',
    );
    const row = db
      .prepare('SELECT first_seen, last_seen FROM discovered_queries WHERE workspace_id = ? AND query = ?')
      .get(workspaceId, 'date override test') as Record<string, unknown>;
    expect(row.first_seen).toBe(overrideDate);
    expect(row.last_seen).toBe(overrideDate);
  });

  it('processes multiple queries in a single call (transaction)', () => {
    upsertDiscoveredQueries(
      workspaceId,
      [
        { query: 'keyword one', position: 3.0, clicks: 10, impressions: 100, ctr: 10 },
        { query: 'keyword two', position: 7.0, clicks: 5, impressions: 60, ctr: 8.3 },
        { query: 'keyword three', position: 12.0, clicks: 2, impressions: 30, ctr: 6.7 },
      ],
      '2026-05-22',
    );
    const count = (
      db.prepare('SELECT COUNT(*) AS count FROM discovered_queries WHERE workspace_id = ?')
        .get(workspaceId) as { count: number }
    ).count;
    expect(count).toBe(3);
  });

  it('keeps best (lowest) position across upserts', () => {
    upsertDiscoveredQueries(
      workspaceId,
      [{ query: 'position tracking', position: 15.0, clicks: 1, impressions: 20, ctr: 5 }],
      '2026-05-20',
    );
    upsertDiscoveredQueries(
      workspaceId,
      [{ query: 'position tracking', position: 8.0, clicks: 3, impressions: 50, ctr: 6 }],
      '2026-05-22',
    );
    // Third upsert with worse position
    upsertDiscoveredQueries(
      workspaceId,
      [{ query: 'position tracking', position: 20.0, clicks: 1, impressions: 15, ctr: 5 }],
      '2026-05-23',
    );
    const row = db
      .prepare('SELECT best_position FROM discovered_queries WHERE workspace_id = ? AND query = ?')
      .get(workspaceId, 'position tracking') as Record<string, unknown>;
    expect(row.best_position).toBeCloseTo(8.0);
  });
});
