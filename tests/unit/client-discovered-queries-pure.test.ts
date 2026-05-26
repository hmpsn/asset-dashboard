/**
 * Unit tests for server/client-discovered-queries.ts
 *
 * Tests focus on the complex upsert merge logic:
 *   - best_position minimization (lower position = better rank)
 *   - best_impressions maximization
 *   - total_impressions accumulation vs same-snapshot dedup
 *   - detectLostVisibility qualification criteria
 *   - workspace isolation
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import db from '../../server/db/index.js';
import {
  upsertDiscoveredQueries,
  detectLostVisibility,
  getLostVisibilityKeys,
  getLostVisibilityCount,
  getDiscoveredQuerySummary,
  getLostVisibilityQueries,
} from '../../server/client-discovered-queries.js';

// ── helpers ────────────────────────────────────────────────────────────────

const testWsId = `ws_dcq_${Date.now()}`;
const testWsId2 = `ws_dcq2_${Date.now()}`;

/** Read a single row directly from SQLite for assertions. */
function readRow(workspaceId: string, query: string) {
  return db.prepare(
    `SELECT * FROM discovered_queries WHERE workspace_id = ? AND query = ?`,
  ).get(workspaceId, query) as {
    workspace_id: string;
    query: string;
    first_seen: string;
    last_seen: string;
    best_position: number | null;
    best_impressions: number;
    total_impressions: number;
    snapshot_count: number;
    last_snapshot_date: string | null;
    last_snapshot_impressions: number;
    status: string;
  } | undefined;
}

/** Minimal LatestRank-compatible observation builder. */
function obs(query: string, position: number | null, impressions: number) {
  return {
    query,
    position: position as number, // actual column type allows null via REAL
    clicks: 0,
    impressions,
    ctr: 0,
  };
}

// ── lifecycle ───────────────────────────────────────────────────────────────

beforeAll(() => {
  db.prepare(
    `INSERT OR IGNORE INTO workspaces (id, name, folder, created_at)
     VALUES (?, ?, ?, ?)`,
  ).run(testWsId, 'DCQ Test WS', testWsId, new Date().toISOString());

  db.prepare(
    `INSERT OR IGNORE INTO workspaces (id, name, folder, created_at)
     VALUES (?, ?, ?, ?)`,
  ).run(testWsId2, 'DCQ Test WS 2', testWsId2, new Date().toISOString());
});

afterAll(() => {
  db.prepare(`DELETE FROM discovered_queries WHERE workspace_id IN (?, ?)`).run(testWsId, testWsId2);
  db.prepare(`DELETE FROM workspaces WHERE id IN (?, ?)`).run(testWsId, testWsId2);
});

// ── upsertDiscoveredQueries — first insert ──────────────────────────────────

describe('upsertDiscoveredQueries — first insert', () => {
  it('inserts a new row with correct fields', () => {
    const wsId = testWsId;
    upsertDiscoveredQueries(wsId, [obs('first insert query', 5, 100)], '2026-01-01');

    const row = readRow(wsId, 'first insert query');
    expect(row).toBeDefined();
    expect(row!.best_position).toBe(5);
    expect(row!.best_impressions).toBe(100);
    expect(row!.total_impressions).toBe(100);
    expect(row!.snapshot_count).toBe(1);
    expect(row!.status).toBe('active');
    expect(row!.last_snapshot_date).toBe('2026-01-01');
    expect(row!.last_snapshot_impressions).toBe(100);
  });

  it('sets first_seen and last_seen to the snapshot date', () => {
    upsertDiscoveredQueries(testWsId, [obs('seen date query', 3, 50)], '2026-02-15');

    const row = readRow(testWsId, 'seen date query');
    expect(row!.first_seen).toBe('2026-02-15');
    expect(row!.last_seen).toBe('2026-02-15');
  });

  it('skips observations whose query normalizes to an empty string', () => {
    upsertDiscoveredQueries(testWsId, [obs('   ', 5, 100)], '2026-01-01');
    // empty query normalizes to '' which is falsy → skipped
    const count = (db.prepare(
      `SELECT COUNT(*) as c FROM discovered_queries WHERE workspace_id = ? AND query = '   '`,
    ).get(testWsId) as { c: number }).c;
    expect(count).toBe(0);
  });
});

// ── upsertDiscoveredQueries — best_position minimization ──────────────────

describe('upsertDiscoveredQueries — best_position minimization', () => {
  it('keeps the lower (better) position when an update has a smaller value', () => {
    const q = 'position min query';
    upsertDiscoveredQueries(testWsId, [obs(q, 5, 100)], '2026-03-01');
    upsertDiscoveredQueries(testWsId, [obs(q, 3, 80)], '2026-03-02');

    const row = readRow(testWsId, q);
    expect(row!.best_position).toBe(3);
  });

  it('does not worsen best_position when an update has a larger value', () => {
    const q = 'position no worsen query';
    upsertDiscoveredQueries(testWsId, [obs(q, 3, 100)], '2026-03-01');
    upsertDiscoveredQueries(testWsId, [obs(q, 8, 80)], '2026-03-02');

    const row = readRow(testWsId, q);
    expect(row!.best_position).toBe(3);
  });

  it('accepts a non-null position when existing best_position is null', () => {
    const q = 'position from null query';
    // Insert with null position: pass null cast to satisfy the type signature used by callers
    upsertDiscoveredQueries(testWsId, [obs(q, null, 50)], '2026-03-01');

    let row = readRow(testWsId, q);
    expect(row!.best_position).toBeNull();

    // Second upsert with a real position should fill in the null
    upsertDiscoveredQueries(testWsId, [obs(q, 4, 60)], '2026-03-02');
    row = readRow(testWsId, q);
    expect(row!.best_position).toBe(4);
  });

  it('keeps null best_position when both inserts have null positions', () => {
    const q = 'position stays null query';
    upsertDiscoveredQueries(testWsId, [obs(q, null, 40)], '2026-03-01');
    upsertDiscoveredQueries(testWsId, [obs(q, null, 40)], '2026-03-02');

    const row = readRow(testWsId, q);
    expect(row!.best_position).toBeNull();
  });
});

// ── upsertDiscoveredQueries — best_impressions maximization ───────────────

describe('upsertDiscoveredQueries — best_impressions maximization', () => {
  it('keeps the higher best_impressions when an update has a smaller value', () => {
    const q = 'impressions max query';
    upsertDiscoveredQueries(testWsId, [obs(q, 5, 100)], '2026-04-01');
    upsertDiscoveredQueries(testWsId, [obs(q, 5, 50)], '2026-04-02');

    const row = readRow(testWsId, q);
    expect(row!.best_impressions).toBe(100);
  });

  it('increases best_impressions when an update has a higher value', () => {
    const q = 'impressions grows query';
    upsertDiscoveredQueries(testWsId, [obs(q, 5, 100)], '2026-04-01');
    upsertDiscoveredQueries(testWsId, [obs(q, 5, 250)], '2026-04-02');

    const row = readRow(testWsId, q);
    expect(row!.best_impressions).toBe(250);
  });
});

// ── upsertDiscoveredQueries — total_impressions accumulation ──────────────

describe('upsertDiscoveredQueries — total_impressions accumulation', () => {
  it('accumulates total_impressions when snapshot dates differ', () => {
    const q = 'total accum query';
    upsertDiscoveredQueries(testWsId, [obs(q, 5, 100)], '2026-05-01');
    upsertDiscoveredQueries(testWsId, [obs(q, 5, 200)], '2026-05-02');

    const row = readRow(testWsId, q);
    expect(row!.total_impressions).toBe(300);
    expect(row!.snapshot_count).toBe(2);
  });

  it('does not double-count when the same snapshot date is re-upserted', () => {
    const q = 'total dedup query';
    upsertDiscoveredQueries(testWsId, [obs(q, 5, 100)], '2026-05-10');
    // Same date — should replace the snapshot contribution, not add
    upsertDiscoveredQueries(testWsId, [obs(q, 5, 100)], '2026-05-10');

    const row = readRow(testWsId, q);
    expect(row!.total_impressions).toBe(100);
    expect(row!.snapshot_count).toBe(1);
  });

  it('replaces the same-snapshot contribution when re-upserted with a different impression count', () => {
    // SQL: total_impressions = MAX(0, total - last_snapshot_impressions + new_impressions)
    // This effectively replaces the previous snapshot contribution for the same date.
    const q = 'total replace snapshot query';
    upsertDiscoveredQueries(testWsId, [obs(q, 5, 100)], '2026-05-15');
    // Same date but different impression value: should substitute 80 for 100
    upsertDiscoveredQueries(testWsId, [obs(q, 5, 80)], '2026-05-15');

    const row = readRow(testWsId, q);
    expect(row!.total_impressions).toBe(80);
    expect(row!.snapshot_count).toBe(1);
  });

  it('accumulates across three distinct snapshot dates', () => {
    const q = 'total three snapshots query';
    upsertDiscoveredQueries(testWsId, [obs(q, 5, 100)], '2026-06-01');
    upsertDiscoveredQueries(testWsId, [obs(q, 5, 200)], '2026-06-02');
    upsertDiscoveredQueries(testWsId, [obs(q, 5, 300)], '2026-06-03');

    const row = readRow(testWsId, q);
    expect(row!.total_impressions).toBe(600);
    expect(row!.snapshot_count).toBe(3);
  });
});

// ── upsertDiscoveredQueries — first_seen / last_seen ──────────────────────

describe('upsertDiscoveredQueries — first_seen / last_seen tracking', () => {
  it('preserves the earliest first_seen across updates', () => {
    const q = 'first seen tracking query';
    upsertDiscoveredQueries(testWsId, [obs(q, 5, 100)], '2026-07-10');
    upsertDiscoveredQueries(testWsId, [obs(q, 5, 100)], '2026-07-20');

    const row = readRow(testWsId, q);
    // MIN(first_seen, excluded.first_seen)
    expect(row!.first_seen).toBe('2026-07-10');
    expect(row!.last_seen).toBe('2026-07-20');
  });

  it('updates last_seen to the newer snapshot date', () => {
    const q = 'last seen update query';
    upsertDiscoveredQueries(testWsId, [obs(q, 5, 100)], '2026-08-01');
    upsertDiscoveredQueries(testWsId, [obs(q, 5, 100)], '2026-08-15');

    const row = readRow(testWsId, q);
    expect(row!.last_seen).toBe('2026-08-15');
  });
});

// ── workspace isolation ────────────────────────────────────────────────────

describe('workspace isolation', () => {
  it('returns no summary data for a workspace that has no queries', () => {
    const summary = getDiscoveredQuerySummary(testWsId2);
    expect(summary.totalDiscovered).toBe(0);
    expect(summary.lostVisibilityCount).toBe(0);
    expect(summary.topLostQueries).toHaveLength(0);
  });

  it('does not return queries belonging to another workspace in getLostVisibilityKeys', () => {
    const q = 'ws isolation query';
    // Insert into workspace 1
    upsertDiscoveredQueries(testWsId, [obs(q, 5, 100)], '2026-01-01');

    // Workspace 2 should have no lost-visibility keys from workspace 1
    const keys = getLostVisibilityKeys(testWsId2);
    expect(keys.has(q)).toBe(false);
  });
});

// ── detectLostVisibility ──────────────────────────────────────────────────

describe('detectLostVisibility', () => {
  it('marks qualifying queries as lost_visibility', () => {
    const q = 'qualify for lost query';
    // Insert with old date (>14 days ago) via two snapshot dates
    // to satisfy: snapshot_count >= 2, total_impressions >= 10, last_seen >= 14 days ago
    upsertDiscoveredQueries(testWsId, [obs(q, 5, 50)], '2024-01-01');
    upsertDiscoveredQueries(testWsId, [obs(q, 5, 50)], '2024-01-05');

    // "today" is well beyond 14 days from 2024-01-05
    detectLostVisibility(testWsId, '2026-01-01');

    const row = readRow(testWsId, q);
    expect(row!.status).toBe('lost_visibility');
  });

  it('does not mark queries that are too recent (< 14 days since last_seen)', () => {
    const q = 'too recent for lost query';
    const recentDate = '2026-05-24'; // 2 days before 2026-05-26
    upsertDiscoveredQueries(testWsId, [obs(q, 5, 50)], '2024-01-01');
    upsertDiscoveredQueries(testWsId, [obs(q, 5, 50)], recentDate);

    detectLostVisibility(testWsId, '2026-05-26');

    const row = readRow(testWsId, q);
    // last_seen is 2026-05-24 → 2 days ago → not >= 14 → stays active
    expect(row!.status).toBe('active');
  });

  it('does not mark queries with snapshot_count < 2', () => {
    const q = 'single snapshot lost query';
    // Only one upsert → snapshot_count = 1
    upsertDiscoveredQueries(testWsId, [obs(q, 5, 50)], '2024-01-01');

    detectLostVisibility(testWsId, '2026-01-01');

    const row = readRow(testWsId, q);
    expect(row!.status).toBe('active');
  });

  it('does not mark queries with total_impressions < 10', () => {
    const q = 'low impressions lost query';
    upsertDiscoveredQueries(testWsId, [obs(q, 5, 4)], '2024-01-01');
    upsertDiscoveredQueries(testWsId, [obs(q, 5, 4)], '2024-01-05');
    // total_impressions = 8 → below 10 threshold

    detectLostVisibility(testWsId, '2026-01-01');

    const row = readRow(testWsId, q);
    expect(row!.status).toBe('active');
  });
});

// ── getLostVisibilityKeys ──────────────────────────────────────────────────

describe('getLostVisibilityKeys', () => {
  it('returns a Set containing normalized query keys for lost queries', () => {
    const q = 'lost key query ABC';
    upsertDiscoveredQueries(testWsId, [obs(q, 5, 50)], '2024-02-01');
    upsertDiscoveredQueries(testWsId, [obs(q, 5, 50)], '2024-02-05');
    detectLostVisibility(testWsId, '2026-01-01');

    const keys = getLostVisibilityKeys(testWsId);
    // keywordComparisonKey lowercases and strips punctuation
    expect(keys.has('lost key query abc')).toBe(true);
  });

  it('returns an empty Set when no queries are lost', () => {
    const keys = getLostVisibilityKeys(testWsId2);
    expect(keys.size).toBe(0);
  });
});

// ── getLostVisibilityCount ─────────────────────────────────────────────────

describe('getLostVisibilityCount', () => {
  it('returns 0 for a workspace with no lost queries', () => {
    expect(getLostVisibilityCount(testWsId2)).toBe(0);
  });

  it('returns the correct count of lost queries', () => {
    const beforeCount = getLostVisibilityCount(testWsId);

    const qA = `count lost A ${Date.now()}`;
    const qB = `count lost B ${Date.now()}`;
    upsertDiscoveredQueries(testWsId, [obs(qA, 5, 50)], '2024-03-01');
    upsertDiscoveredQueries(testWsId, [obs(qA, 5, 50)], '2024-03-05');
    upsertDiscoveredQueries(testWsId, [obs(qB, 5, 50)], '2024-03-01');
    upsertDiscoveredQueries(testWsId, [obs(qB, 5, 50)], '2024-03-05');
    detectLostVisibility(testWsId, '2026-06-01');

    const afterCount = getLostVisibilityCount(testWsId);
    expect(afterCount).toBeGreaterThanOrEqual(beforeCount + 2);
  });
});

// ── getDiscoveredQuerySummary ─────────────────────────────────────────────

describe('getDiscoveredQuerySummary', () => {
  it('returns zero counts for a workspace with no data', () => {
    const summary = getDiscoveredQuerySummary(testWsId2);
    expect(summary.totalDiscovered).toBe(0);
    expect(summary.lostVisibilityCount).toBe(0);
    expect(summary.topLostQueries).toEqual([]);
  });

  it('includes both active and lost queries in totalDiscovered', () => {
    const isolatedWsId = `ws_dcq_summary_${Date.now()}`;
    db.prepare(
      `INSERT OR IGNORE INTO workspaces (id, name, folder, created_at) VALUES (?, ?, ?, ?)`,
    ).run(isolatedWsId, 'Summary WS', isolatedWsId, new Date().toISOString());

    try {
      upsertDiscoveredQueries(isolatedWsId, [obs('summary active query', 5, 100)], '2026-01-01');
      upsertDiscoveredQueries(isolatedWsId, [obs('summary lost query', 5, 50)], '2024-04-01');
      upsertDiscoveredQueries(isolatedWsId, [obs('summary lost query', 5, 50)], '2024-04-05');
      detectLostVisibility(isolatedWsId, '2026-06-01');

      const summary = getDiscoveredQuerySummary(isolatedWsId);
      expect(summary.totalDiscovered).toBe(2);
      expect(summary.lostVisibilityCount).toBe(1);
      expect(summary.topLostQueries).toHaveLength(1);
      expect(summary.topLostQueries[0].query).toBe('summary lost query');
    } finally {
      db.prepare(`DELETE FROM discovered_queries WHERE workspace_id = ?`).run(isolatedWsId);
      db.prepare(`DELETE FROM workspaces WHERE id = ?`).run(isolatedWsId);
    }
  });

  it('sorts topLostQueries by total_impressions descending', () => {
    const isolatedWsId = `ws_dcq_topsort_${Date.now()}`;
    db.prepare(
      `INSERT OR IGNORE INTO workspaces (id, name, folder, created_at) VALUES (?, ?, ?, ?)`,
    ).run(isolatedWsId, 'TopSort WS', isolatedWsId, new Date().toISOString());

    try {
      // Query A has lower impressions, Query B has higher
      upsertDiscoveredQueries(isolatedWsId, [obs('query low impressions', 5, 20)], '2024-04-01');
      upsertDiscoveredQueries(isolatedWsId, [obs('query low impressions', 5, 20)], '2024-04-05');
      upsertDiscoveredQueries(isolatedWsId, [obs('query high impressions', 5, 500)], '2024-04-01');
      upsertDiscoveredQueries(isolatedWsId, [obs('query high impressions', 5, 500)], '2024-04-05');
      detectLostVisibility(isolatedWsId, '2026-06-01');

      const summary = getDiscoveredQuerySummary(isolatedWsId);
      expect(summary.topLostQueries[0].query).toBe('query high impressions');
      expect(summary.topLostQueries[1].query).toBe('query low impressions');
    } finally {
      db.prepare(`DELETE FROM discovered_queries WHERE workspace_id = ?`).run(isolatedWsId);
      db.prepare(`DELETE FROM workspaces WHERE id = ?`).run(isolatedWsId);
    }
  });
});

// ── getLostVisibilityQueries ──────────────────────────────────────────────

describe('getLostVisibilityQueries', () => {
  it('returns an empty array when no queries are lost', () => {
    const result = getLostVisibilityQueries(testWsId2);
    expect(result).toEqual([]);
  });

  it('returns lost queries with correct shape', () => {
    const isolatedWsId = `ws_dcq_lostq_${Date.now()}`;
    db.prepare(
      `INSERT OR IGNORE INTO workspaces (id, name, folder, created_at) VALUES (?, ?, ?, ?)`,
    ).run(isolatedWsId, 'LostQ WS', isolatedWsId, new Date().toISOString());

    try {
      upsertDiscoveredQueries(isolatedWsId, [obs('lostq shape query', 7, 300)], '2024-05-01');
      upsertDiscoveredQueries(isolatedWsId, [obs('lostq shape query', 7, 300)], '2024-05-05');
      detectLostVisibility(isolatedWsId, '2026-06-01');

      const results = getLostVisibilityQueries(isolatedWsId);
      expect(results).toHaveLength(1);
      const item = results[0];
      expect(item.query).toBe('lostq shape query');
      expect(item.lastPosition).toBe(7);
      expect(item.totalImpressions).toBe(600);
      expect(item.lastSeen).toBeDefined();
    } finally {
      db.prepare(`DELETE FROM discovered_queries WHERE workspace_id = ?`).run(isolatedWsId);
      db.prepare(`DELETE FROM workspaces WHERE id = ?`).run(isolatedWsId);
    }
  });

  it('sorts results by total_impressions descending', () => {
    const isolatedWsId = `ws_dcq_lostsort_${Date.now()}`;
    db.prepare(
      `INSERT OR IGNORE INTO workspaces (id, name, folder, created_at) VALUES (?, ?, ?, ?)`,
    ).run(isolatedWsId, 'LostSort WS', isolatedWsId, new Date().toISOString());

    try {
      upsertDiscoveredQueries(isolatedWsId, [obs('small lost', 5, 10)], '2024-05-01');
      upsertDiscoveredQueries(isolatedWsId, [obs('small lost', 5, 10)], '2024-05-05');
      upsertDiscoveredQueries(isolatedWsId, [obs('big lost', 5, 1000)], '2024-05-01');
      upsertDiscoveredQueries(isolatedWsId, [obs('big lost', 5, 1000)], '2024-05-05');
      detectLostVisibility(isolatedWsId, '2026-06-01');

      const results = getLostVisibilityQueries(isolatedWsId);
      expect(results[0].query).toBe('big lost');
      expect(results[1].query).toBe('small lost');
    } finally {
      db.prepare(`DELETE FROM discovered_queries WHERE workspace_id = ?`).run(isolatedWsId);
      db.prepare(`DELETE FROM workspaces WHERE id = ?`).run(isolatedWsId);
    }
  });
});

// ── batch upsert ───────────────────────────────────────────────────────────

describe('upsertDiscoveredQueries — batch', () => {
  it('upserts multiple queries in a single call', () => {
    const wsId = `ws_dcq_batch_${Date.now()}`;
    db.prepare(
      `INSERT OR IGNORE INTO workspaces (id, name, folder, created_at) VALUES (?, ?, ?, ?)`,
    ).run(wsId, 'Batch WS', wsId, new Date().toISOString());

    try {
      upsertDiscoveredQueries(
        wsId,
        [
          obs('batch query 1', 1, 500),
          obs('batch query 2', 2, 300),
          obs('batch query 3', 3, 100),
        ],
        '2026-01-01',
      );

      const r1 = readRow(wsId, 'batch query 1');
      const r2 = readRow(wsId, 'batch query 2');
      const r3 = readRow(wsId, 'batch query 3');

      expect(r1!.best_position).toBe(1);
      expect(r2!.best_position).toBe(2);
      expect(r3!.best_position).toBe(3);
    } finally {
      db.prepare(`DELETE FROM discovered_queries WHERE workspace_id = ?`).run(wsId);
      db.prepare(`DELETE FROM workspaces WHERE id = ?`).run(wsId);
    }
  });

  it('uses seenDate from observation when provided, overriding snapshotDate for first_seen/last_seen', () => {
    const wsId = `ws_dcq_seendate_${Date.now()}`;
    db.prepare(
      `INSERT OR IGNORE INTO workspaces (id, name, folder, created_at) VALUES (?, ?, ?, ?)`,
    ).run(wsId, 'SeenDate WS', wsId, new Date().toISOString());

    try {
      const observation = { ...obs('seen date obs query', 5, 100), seenDate: '2025-12-01' };
      upsertDiscoveredQueries(wsId, [observation], '2026-01-01');

      const row = readRow(wsId, 'seen date obs query');
      // seenDate on the observation overrides snapshotDate for first_seen/last_seen
      expect(row!.first_seen).toBe('2025-12-01');
      expect(row!.last_seen).toBe('2025-12-01');
      // last_snapshot_date uses the snapshotDate argument
      expect(row!.last_snapshot_date).toBe('2026-01-01');
    } finally {
      db.prepare(`DELETE FROM discovered_queries WHERE workspace_id = ?`).run(wsId);
      db.prepare(`DELETE FROM workspaces WHERE id = ?`).run(wsId);
    }
  });
});
