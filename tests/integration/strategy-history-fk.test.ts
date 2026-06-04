/**
 * Wave 3e-i (#18) — strategy_history typed schema + FK rebuild (migration 119).
 *
 * strategy_history (030) was the lone strategy-path table created WITHOUT a
 * foreign key on workspace_id, so deleting a workspace orphaned its history rows.
 * Migration 119 rebuilds the table with
 * `workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE`,
 * preserving every existing id + generated_at (AUTOINCREMENT → explicit column
 * list) and cleaning orphans first.
 *
 * Coverage:
 *  - CASCADE: deleting a workspace removes its strategy_history rows (RED against
 *    a no-FK clone built inline to prove the pre-119 bug).
 *  - FK enforcement: a raw INSERT with a non-existent workspace_id is rejected.
 *  - Orphan-cleanup: the migration's exact cleanup DELETE removes a seeded orphan
 *    (approach: a focused no-FK clone table is seeded with an orphan, then the
 *    cleanup DELETE statement copied verbatim from the migration is run against
 *    it — a full pre-119 DB harness is impractical on the shared singleton DB).
 *  - Typed-read shape: a real strategy round-trip (persist x2) makes both
 *    buildLatestKeywordStrategyRefreshSummary AND GET /diff surface siteKeywords +
 *    contentGaps[].targetKeyword (+ page_map {pagePath, primaryKeyword}); a
 *    malformed/sparse strategy_json degrades to the fallback (no throw).
 *  - seo-context-slice: the strategyHistory summary still counts rows + reports
 *    lastRevisedAt after the rebuild.
 *
 * Port: 13893 (exclusive; reserved for this file by the Wave-3e port allocation;
 * 13886 reserved for tracked-keywords-concurrency).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace, getWorkspace } from '../../server/workspaces.js';
import db from '../../server/db/index.js';
import { setBroadcast } from '../../server/broadcast.js';
import { persistKeywordStrategy } from '../../server/keyword-strategy-persistence.js';
import { buildLatestKeywordStrategyRefreshSummary } from '../../server/keyword-strategy-ux.js';
import { assembleSeoContext } from '../../server/intelligence/seo-context-slice.js';
import { listContentGaps } from '../../server/content-gaps.js';
import { listPageKeywords } from '../../server/page-keywords.js';
import type { PersistKeywordStrategyOptions } from '../../server/keyword-strategy-persistence.js';

const PORT = 13893;
const ctx = createTestContext(PORT);

const baseSearchData: PersistKeywordStrategyOptions['searchData'] = {
  deviceBreakdown: [],
  countryBreakdown: [],
  periodComparison: null,
  organicLandingPages: [],
  organicOverview: null,
};

function persistGeneration(wsId: string, siteKeywords: string[], primaryKeyword: string) {
  const ws = getWorkspace(wsId);
  if (!ws) throw new Error('workspace missing');
  persistKeywordStrategy({
    ws,
    strategy: {
      siteKeywords,
      opportunities: [],
      pageMap: [
        {
          pagePath: '/services/seo',
          pageTitle: 'SEO Services',
          primaryKeyword,
          secondaryKeywords: ['seo agency'],
        },
      ],
      contentGaps: [
        {
          topic: 'local seo',
          targetKeyword: `${primaryKeyword} near me`,
          intent: 'commercial',
          priority: 'high',
          rationale: 'High-intent local query gap.',
          suggestedPageType: 'service',
        },
      ],
      quickWins: [],
    } as PersistKeywordStrategyOptions['strategy'],
    strategyMode: 'full',
    pagesToAnalyze: [
      { path: '/services/seo', title: 'SEO Services', seoTitle: 'SEO Services', seoDesc: '', contentSnippet: '' },
    ] as PersistKeywordStrategyOptions['pagesToAnalyze'],
    siteKeywordMetrics: [],
    keywordGaps: [],
    competitorKeywordData: [],
    topicClusters: [],
    cannibalization: [],
    questionKeywords: [],
    businessContext: '',
    seoDataMode: 'quick',
    seoDataStatus: { mode: 'quick', provider: 'dataforseo', status: 'degraded', reasons: ['test'] },
    searchData: baseSearchData,
  });
}

/**
 * Persist twice. The history INSERT only fires when the workspace already has a
 * keywordStrategy blob with generatedAt — the first persist seeds that blob, the
 * second snapshots it into strategy_history.
 */
function seedHistory(wsId: string) {
  persistGeneration(wsId, ['seo services', 'enterprise seo'], 'seo services');
  persistGeneration(wsId, ['seo services', 'technical seo'], 'seo audit');
}

beforeAll(async () => {
  setBroadcast(vi.fn(), vi.fn());
  await ctx.startServer();
}, 30_000);

afterAll(async () => {
  await ctx.stopServer();
});

// FK enforcement is globally OFF in the test process (tests/db-setup.ts:28 —
// legacy fixtures insert ad-hoc workspace IDs). To exercise the real CASCADE /
// FK behaviour we toggle foreign_keys ON for the assertion, then restore OFF so
// later tests in this worker keep the legacy-fixture relaxation. Same pattern as
// tracked-keywords-row-table.test.ts '(d) … CASCADE'.
function withForeignKeysOn<T>(fn: () => T): T {
  db.pragma('foreign_keys = ON');
  try {
    return fn();
  } finally {
    db.pragma('foreign_keys = OFF');
  }
}

describe('strategy_history — FK CASCADE (migration 119)', () => {
  it('deleting a workspace cascades away its strategy_history rows', () => {
    const wsId = createWorkspace('strategy-history cascade').id;
    seedHistory(wsId);

    const before = db.prepare('SELECT COUNT(*) AS n FROM strategy_history WHERE workspace_id = ?').get(wsId) as { n: number };
    expect(before.n).toBeGreaterThanOrEqual(1);

    withForeignKeysOn(() => {
      // Raw DELETE (not deleteWorkspace) so the ON DELETE CASCADE FK is the only
      // mechanism removing the history rows.
      db.prepare('DELETE FROM workspaces WHERE id = ?').run(wsId);
    });

    const after = db.prepare('SELECT COUNT(*) AS n FROM strategy_history WHERE workspace_id = ?').get(wsId) as { n: number };
    expect(after.n).toBe(0);
  });

  it('RED-proof: a no-FK clone (pre-119 schema) does NOT cascade — the orphan survives', () => {
    // Build the EXACT pre-119 table shape (no foreign key) and demonstrate that
    // deleting the workspace leaves the row orphaned even with foreign_keys ON.
    // This is the bug migration 119 fixes; the real FK table (asserted above)
    // cascades. Proves the CASCADE test fails against the pre-119 schema.
    const wsId = createWorkspace('strategy-history nofk red').id;
    db.exec(`
      CREATE TEMP TABLE IF NOT EXISTS strategy_history_nofk (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        workspace_id TEXT NOT NULL,
        strategy_json TEXT NOT NULL,
        page_map_json TEXT NOT NULL,
        generated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    db.prepare('DELETE FROM strategy_history_nofk').run();
    db.prepare('INSERT INTO strategy_history_nofk (workspace_id, strategy_json, page_map_json) VALUES (?, ?, ?)')
      .run(wsId, '{}', '[]');

    withForeignKeysOn(() => {
      db.prepare('DELETE FROM workspaces WHERE id = ?').run(wsId);
    });

    const survived = db.prepare('SELECT COUNT(*) AS n FROM strategy_history_nofk WHERE workspace_id = ?').get(wsId) as { n: number };
    expect(survived.n).toBe(1); // orphan survives the no-FK schema — proves the pre-119 bug

    db.exec('DROP TABLE IF EXISTS strategy_history_nofk');
  });
});

describe('strategy_history — FK enforcement is live', () => {
  it('rejects a raw INSERT referencing a non-existent workspace_id', () => {
    withForeignKeysOn(() => {
      expect(() => {
        db.prepare('INSERT INTO strategy_history (workspace_id, strategy_json, page_map_json, generated_at) VALUES (?, ?, ?, ?)')
          .run('does-not-exist', '{}', '[]', new Date().toISOString());
      }).toThrow(/FOREIGN KEY constraint failed/);
    });
  });
});

describe('strategy_history — orphan-cleanup DELETE (migration 119)', () => {
  it('the migration cleanup DELETE removes a seeded orphan row', () => {
    // Approach: exercise the migration's exact cleanup statement against a no-FK
    // clone seeded with an orphan (workspace_id pointing at no workspace) plus a
    // valid row. A full pre-119 DB rebuild is impractical on the shared singleton
    // DB, so we assert the cleanup DELETE itself behaves correctly.
    const validWsId = createWorkspace('strategy-history cleanup valid').id;
    db.exec(`
      CREATE TEMP TABLE IF NOT EXISTS strategy_history_cleanup (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        workspace_id TEXT NOT NULL,
        strategy_json TEXT NOT NULL,
        page_map_json TEXT NOT NULL,
        generated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    db.prepare('DELETE FROM strategy_history_cleanup').run();
    db.prepare('INSERT INTO strategy_history_cleanup (workspace_id, strategy_json, page_map_json) VALUES (?, ?, ?)')
      .run('orphan-workspace-id', '{}', '[]');
    db.prepare('INSERT INTO strategy_history_cleanup (workspace_id, strategy_json, page_map_json) VALUES (?, ?, ?)')
      .run(validWsId, '{}', '[]');

    // Verbatim cleanup statement from 119-strategy-history-fk.sql (table name swapped).
    db.exec('DELETE FROM strategy_history_cleanup WHERE workspace_id NOT IN (SELECT id FROM workspaces);');

    const orphanCount = db.prepare('SELECT COUNT(*) AS n FROM strategy_history_cleanup WHERE workspace_id = ?').get('orphan-workspace-id') as { n: number };
    const validCount = db.prepare('SELECT COUNT(*) AS n FROM strategy_history_cleanup WHERE workspace_id = ?').get(validWsId) as { n: number };
    expect(orphanCount.n).toBe(0); // orphan cleaned
    expect(validCount.n).toBe(1);  // valid row preserved

    db.exec('DROP TABLE IF EXISTS strategy_history_cleanup');
    deleteWorkspace(validWsId);
  });
});

describe('strategy_history — typed reads round-trip', () => {
  it('buildLatestKeywordStrategyRefreshSummary surfaces siteKeywords + contentGap diffs from the typed read', () => {
    const wsId = createWorkspace('strategy-history typed summary').id;
    try {
      seedHistory(wsId);
      const current = getWorkspace(wsId)?.keywordStrategy;
      expect(current).toBeTruthy();

      const summary = buildLatestKeywordStrategyRefreshSummary({
        workspaceId: wsId,
        strategy: current,
        pageMap: listPageKeywords(wsId),
        contentGaps: listContentGaps(wsId),
      });
      expect(summary).toBeTruthy();
      // The previous generation's site keyword "enterprise seo" was dropped in the
      // current generation; the typed read must have surfaced it so the diff is non-trivial.
      expect(summary!.added + summary!.retained).toBeGreaterThan(0);
      // previousGeneratedAt comes from the history row generated_at.
      expect(summary!.previousGeneratedAt).toBeTruthy();
    } finally {
      deleteWorkspace(wsId);
    }
  });

  it('GET /diff returns site keyword + content gap + page-map diffs for the round-tripped row', async () => {
    const wsId = createWorkspace('strategy-history typed diff').id;
    try {
      seedHistory(wsId);
      const res = await fetch(`http://localhost:${PORT}/api/webflow/keyword-strategy/${wsId}/diff`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).not.toBeNull();
      // siteKeywords diff: "technical seo" is new vs prior, "enterprise seo" was lost.
      expect(body.newKeywords).toContain('technical seo');
      expect(body.lostKeywords).toContain('enterprise seo');
      // content gap diff (targetKeyword pulled from the typed strategy_json read).
      expect(Array.isArray(body.newGaps)).toBe(true);
      expect(Array.isArray(body.resolvedGaps)).toBe(true);
      // The prior gap "seo services near me" is resolved by the current "seo audit near me".
      expect(body.resolvedGaps).toContain('seo services near me');
      // page-map diff: the prior primaryKeyword "seo services" → "seo audit" on /services/seo.
      const change = (body.keywordChanges as Array<{ pagePath: string; oldKeyword: string; newKeyword: string }>)
        .find(c => c.pagePath === '/services/seo');
      expect(change).toBeTruthy();
      expect(change!.oldKeyword).toBe('seo services');
    } finally {
      deleteWorkspace(wsId);
    }
  });

  it('a malformed/sparse strategy_json degrades to the fallback instead of throwing', async () => {
    const wsId = createWorkspace('strategy-history malformed').id;
    try {
      seedHistory(wsId);
      // Corrupt the latest history row's strategy_json to non-JSON garbage.
      db.prepare('UPDATE strategy_history SET strategy_json = ? WHERE workspace_id = ?')
        .run('{ not valid json', wsId);

      const current = getWorkspace(wsId)?.keywordStrategy;
      // Summary path must not throw — degrades to empty previous-strategy fallback.
      expect(() => buildLatestKeywordStrategyRefreshSummary({
        workspaceId: wsId,
        strategy: current,
        pageMap: listPageKeywords(wsId),
        contentGaps: listContentGaps(wsId),
      })).not.toThrow();

      // /diff route must still respond 200 (degraded), not 500.
      const res = await fetch(`http://localhost:${PORT}/api/webflow/keyword-strategy/${wsId}/diff`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).not.toBeNull();
      // With a garbage prevStrategy, every current site keyword reads as "new".
      expect(body.newKeywords).toContain('seo services');
    } finally {
      deleteWorkspace(wsId);
    }
  });
});

describe('strategy_history — seo-context slice post-rebuild', () => {
  it('strategyHistory summary still counts rows + reports lastRevisedAt', async () => {
    const wsId = createWorkspace('strategy-history seo-context').id;
    try {
      seedHistory(wsId);
      const rows = db.prepare('SELECT COUNT(*) AS n, MAX(generated_at) AS last FROM strategy_history WHERE workspace_id = ?').get(wsId) as { n: number; last: string };
      expect(rows.n).toBeGreaterThanOrEqual(1);

      const slice = await assembleSeoContext(wsId);
      expect(slice.strategyHistory).toBeTruthy();
      expect(slice.strategyHistory!.revisionsCount).toBe(rows.n);
      expect(slice.strategyHistory!.lastRevisedAt).toBe(rows.last);
    } finally {
      deleteWorkspace(wsId);
    }
  });
});
