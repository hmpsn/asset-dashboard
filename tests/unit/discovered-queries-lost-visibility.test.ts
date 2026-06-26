import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  LOST_VISIBILITY_READ_LIMIT,
  detectLostVisibility,
  getDiscoveredQuerySummary,
  getLostVisibilityCount,
  getLostVisibilityKeys,
  pruneDiscoveredQueries,
  pruneAllDiscoveredQueries,
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
  workspaceId = createWorkspace(`Discovered Query Test ${Date.now()}`).id;
});

afterEach(() => {
  db.prepare('DELETE FROM discovered_queries WHERE workspace_id = ?').run(workspaceId);
  deleteWorkspace(workspaceId);
});

describe('upsertDiscoveredQueries', () => {
  it('inserts new query rows', () => {
    upsertDiscoveredQueries(
      workspaceId,
      [{ query: 'teeth whitening', position: 8.2, clicks: 5, impressions: 120, ctr: 4.2 }],
      '2026-05-22',
    );
    const row = db.prepare(
      'SELECT * FROM discovered_queries WHERE workspace_id = ? AND query = ?',
    ).get(workspaceId, 'teeth whitening') as Record<string, unknown>;
    expect(row).toBeTruthy();
    expect(row.snapshot_count).toBe(1);
    expect(row.status).toBe('active');
    expect(row.total_impressions).toBe(120);
  });

  it('updates last_seen and accumulates impressions on second upsert', () => {
    upsertDiscoveredQueries(
      workspaceId,
      [{ query: 'teeth whitening', position: 8.2, clicks: 5, impressions: 120, ctr: 4.2 }],
      '2026-05-22',
    );
    upsertDiscoveredQueries(
      workspaceId,
      [{ query: 'teeth whitening', position: 7.5, clicks: 8, impressions: 150, ctr: 5.3 }],
      '2026-05-23',
    );
    const row = db.prepare(
      'SELECT * FROM discovered_queries WHERE workspace_id = ? AND query = ?',
    ).get(workspaceId, 'teeth whitening') as Record<string, unknown>;
    expect(row.snapshot_count).toBe(2);
    expect(row.total_impressions).toBe(270);
    expect(row.best_position).toBeCloseTo(7.5);
    expect(row.last_seen).toBe('2026-05-23');
  });

  it('reactivates a lost_visibility query when it reappears', () => {
    db.prepare(`
      INSERT INTO discovered_queries
        (workspace_id, query, first_seen, last_seen, snapshot_count, total_impressions, status)
      VALUES (?, 'teeth whitening', '2026-04-01', '2026-04-01', 5, 500, 'lost_visibility')
    `).run(workspaceId);
    upsertDiscoveredQueries(
      workspaceId,
      [{ query: 'teeth whitening', position: 9.0, clicks: 3, impressions: 80, ctr: 3.75 }],
      '2026-05-22',
    );
    const row = db.prepare(
      'SELECT status FROM discovered_queries WHERE workspace_id = ? AND query = ?',
    ).get(workspaceId, 'teeth whitening') as Record<string, unknown>;
    expect(row.status).toBe('active');
  });

  it('replaces same-date impressions instead of double-counting reruns', () => {
    upsertDiscoveredQueries(
      workspaceId,
      [{ query: 'teeth whitening', position: 8.2, clicks: 5, impressions: 120, ctr: 4.2, seenDate: '2026-05-20' }],
      '2026-05-22',
    );
    upsertDiscoveredQueries(
      workspaceId,
      [{ query: 'teeth whitening', position: 7.5, clicks: 8, impressions: 150, ctr: 5.3, seenDate: '2026-05-20' }],
      '2026-05-22',
    );
    const row = db.prepare(
      'SELECT snapshot_count, total_impressions, last_seen FROM discovered_queries WHERE workspace_id = ? AND query = ?',
    ).get(workspaceId, 'teeth whitening') as Record<string, unknown>;
    expect(row.snapshot_count).toBe(1);
    expect(row.total_impressions).toBe(150);
    expect(row.last_seen).toBe('2026-05-20');
  });
});

describe('detectLostVisibility', () => {
  function insertQuery(query: string, lastSeen: string, snapshotCount: number, totalImpressions: number) {
    db.prepare(`
      INSERT INTO discovered_queries
        (workspace_id, query, first_seen, last_seen, snapshot_count, total_impressions, status)
      VALUES (?, ?, '2026-01-01', ?, ?, ?, 'active')
    `).run(workspaceId, query, lastSeen, snapshotCount, totalImpressions);
  }

  it('marks query as lost_visibility when 14+ days elapsed and quality gate passes', () => {
    insertQuery('teeth whitening', '2026-05-01', 3, 50);
    detectLostVisibility(workspaceId, '2026-05-22');
    const row = db.prepare(
      'SELECT status FROM discovered_queries WHERE workspace_id = ? AND query = ?',
    ).get(workspaceId, 'teeth whitening') as Record<string, unknown>;
    expect(row.status).toBe('lost_visibility');
  });

  it('does not flag when gap is only 13 days', () => {
    insertQuery('teeth whitening', '2026-05-09', 3, 50);
    detectLostVisibility(workspaceId, '2026-05-22');
    const row = db.prepare(
      'SELECT status FROM discovered_queries WHERE workspace_id = ? AND query = ?',
    ).get(workspaceId, 'teeth whitening') as Record<string, unknown>;
    expect(row.status).toBe('active');
  });

  it('does not flag when snapshot_count is below the quality gate', () => {
    insertQuery('teeth whitening', '2026-05-01', 1, 50);
    detectLostVisibility(workspaceId, '2026-05-22');
    const row = db.prepare(
      'SELECT status FROM discovered_queries WHERE workspace_id = ? AND query = ?',
    ).get(workspaceId, 'teeth whitening') as Record<string, unknown>;
    expect(row.status).toBe('active');
  });

  it('does not flag when total_impressions is below the quality gate', () => {
    insertQuery('teeth whitening', '2026-05-01', 5, 9);
    detectLostVisibility(workspaceId, '2026-05-22');
    const row = db.prepare(
      'SELECT status FROM discovered_queries WHERE workspace_id = ? AND query = ?',
    ).get(workspaceId, 'teeth whitening') as Record<string, unknown>;
    expect(row.status).toBe('active');
  });

  it('is idempotent for already lost queries', () => {
    db.prepare(`
      INSERT INTO discovered_queries
        (workspace_id, query, first_seen, last_seen, snapshot_count, total_impressions, status)
      VALUES (?, 'already lost', '2026-01-01', '2026-01-01', 5, 100, 'lost_visibility')
    `).run(workspaceId);
    detectLostVisibility(workspaceId, '2026-05-22');
    const row = db.prepare(
      'SELECT status FROM discovered_queries WHERE workspace_id = ? AND query = ?',
    ).get(workspaceId, 'already lost') as Record<string, unknown>;
    expect(row.status).toBe('lost_visibility');
  });
});

describe('lost visibility reads', () => {
  it('returns normalized query keys for lost_visibility rows', () => {
    db.prepare(`
      INSERT INTO discovered_queries
        (workspace_id, query, first_seen, last_seen, snapshot_count, total_impressions, status)
      VALUES (?, 'Teeth Whitening', '2026-01-01', '2026-01-01', 5, 100, 'lost_visibility')
    `).run(workspaceId);
    const keys = getLostVisibilityKeys(workspaceId);
    expect(keys.has('teeth whitening')).toBe(true);
    expect(getLostVisibilityCount(workspaceId)).toBe(1);
  });

  it('returns an empty set when no lost_visibility rows exist', () => {
    expect(getLostVisibilityKeys(workspaceId).size).toBe(0);
    expect(getLostVisibilityCount(workspaceId)).toBe(0);
  });

  it('caps normalized lost visibility keys to bounded highest-impression rows', () => {
    for (let i = 0; i < LOST_VISIBILITY_READ_LIMIT + 3; i += 1) {
      db.prepare(`
        INSERT INTO discovered_queries
          (workspace_id, query, first_seen, last_seen, snapshot_count, total_impressions, status)
        VALUES (?, ?, '2026-01-01', '2026-01-01', 5, ?, 'lost_visibility')
      `).run(workspaceId, `Query ${i}`, i);
    }

    const keys = getLostVisibilityKeys(workspaceId);
    expect(keys.size).toBe(LOST_VISIBILITY_READ_LIMIT);
    expect(keys.has(`query ${LOST_VISIBILITY_READ_LIMIT + 2}`)).toBe(true);
    expect(keys.has('query 0')).toBe(false);
  });
});

describe('pruneDiscoveredQueries', () => {
  it('deletes stale rows while retaining recent rows and top lost-visibility history', () => {
    db.prepare(`
      INSERT INTO discovered_queries
        (workspace_id, query, first_seen, last_seen, snapshot_count, total_impressions, status)
      VALUES
        (?, 'old active', '2024-01-01', '2024-01-01', 1, 1, 'active'),
        (?, 'recent active', '2026-05-01', '2026-05-01', 1, 1, 'active'),
        (?, 'old top lost', '2024-01-01', '2024-01-01', 5, 999, 'lost_visibility')
    `).run(workspaceId, workspaceId, workspaceId);

    const deleted = pruneDiscoveredQueries(workspaceId, '2026-06-26');
    expect(deleted).toBe(1);

    const rows = db.prepare(`
      SELECT query FROM discovered_queries WHERE workspace_id = ? ORDER BY query
    `).all(workspaceId) as Array<{ query: string }>;
    expect(rows.map(row => row.query)).toEqual(['old top lost', 'recent active']);
  });

  it('prunes stale lost rows outside the retained top lost set', () => {
    for (let i = 0; i < LOST_VISIBILITY_READ_LIMIT + 2; i += 1) {
      db.prepare(`
        INSERT INTO discovered_queries
          (workspace_id, query, first_seen, last_seen, snapshot_count, total_impressions, status)
        VALUES (?, ?, '2024-01-01', '2024-01-01', 5, ?, 'lost_visibility')
      `).run(workspaceId, `old lost ${i}`, i);
    }

    const deleted = pruneDiscoveredQueries(workspaceId, '2026-06-26');
    expect(deleted).toBe(2);

    const remaining = db.prepare(`
      SELECT COUNT(*) AS count FROM discovered_queries WHERE workspace_id = ?
    `).get(workspaceId) as { count: number };
    expect(remaining.count).toBe(LOST_VISIBILITY_READ_LIMIT);
  });

  it('can prune stale rows globally outside the rank-tracking success path', () => {
    const otherWorkspaceId = createWorkspace(`Other Global Prune ${Date.now()}`).id;
    try {
      db.prepare(`
        INSERT INTO discovered_queries
          (workspace_id, query, first_seen, last_seen, snapshot_count, total_impressions, status)
        VALUES
          (?, 'old active local', '2024-01-01', '2024-01-01', 1, 1, 'active'),
          (?, 'old active other', '2024-01-01', '2024-01-01', 1, 1, 'active')
      `).run(workspaceId, otherWorkspaceId);

      const deleted = pruneAllDiscoveredQueries('2026-06-26');
      expect(deleted).toBeGreaterThanOrEqual(2);

      const remaining = db.prepare(`
        SELECT COUNT(*) AS count
        FROM discovered_queries
        WHERE workspace_id IN (?, ?)
      `).get(workspaceId, otherWorkspaceId) as { count: number };
      expect(remaining.count).toBe(0);
    } finally {
      db.prepare('DELETE FROM discovered_queries WHERE workspace_id = ?').run(otherWorkspaceId);
      deleteWorkspace(otherWorkspaceId);
    }
  });
});

describe('getDiscoveredQuerySummary', () => {
  it('returns totalDiscovered count and lostVisibilityCount', () => {
    db.prepare(`
      INSERT INTO discovered_queries
        (workspace_id, query, first_seen, last_seen, best_position, snapshot_count, total_impressions, status)
      VALUES
        (?, 'query a', '2026-01-01', '2026-01-01', 12.4, 5, 200, 'lost_visibility'),
        (?, 'query b', '2026-01-01', '2026-05-22', 4.2, 10, 500, 'active')
    `).run(workspaceId, workspaceId);
    const summary = getDiscoveredQuerySummary(workspaceId);
    expect(summary.totalDiscovered).toBe(2);
    expect(summary.lostVisibilityCount).toBe(1);
    expect(summary.topLostQueries).toHaveLength(1);
    expect(summary.topLostQueries[0]).toEqual(expect.objectContaining({
      query: 'query a',
      lastPosition: 12.4,
      totalImpressions: 200,
    }));
  });

  it('orders topLostQueries by total_impressions DESC', () => {
    db.prepare(`
      INSERT INTO discovered_queries
        (workspace_id, query, first_seen, last_seen, best_position, snapshot_count, total_impressions, status)
      VALUES
        (?, 'low impressions query', '2026-01-01', '2026-01-01', 15.0, 3, 50, 'lost_visibility'),
        (?, 'high impressions query', '2026-01-01', '2026-01-01', 8.0, 5, 500, 'lost_visibility')
    `).run(workspaceId, workspaceId);
    const summary = getDiscoveredQuerySummary(workspaceId);
    expect(summary.topLostQueries).toHaveLength(2);
    expect(summary.topLostQueries[0].query).toBe('high impressions query');
    expect(summary.topLostQueries[0].totalImpressions).toBe(500);
    expect(summary.topLostQueries[1].query).toBe('low impressions query');
    expect(summary.topLostQueries[1].totalImpressions).toBe(50);
  });
});
