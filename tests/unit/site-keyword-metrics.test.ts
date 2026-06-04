/**
 * Wave 3b-ii (#19b) — site_keyword_metrics store + boot backfill + table-only
 * resolver + reconcile baseline + CASCADE (table-as-truth, post-strip).
 *
 * STRIP half: the blob `siteKeywordMetrics` write is CUT (persist no longer
 * writes it); the resolver is table-only (no blob fallback). The boot backfill
 * still reads legacy blobs — it is the populate-only migration bridge.
 *
 * In-process DB store/migration coverage. The closed-loop survival through the
 * real HTTP public-read route is exercised in the integration test
 * `tests/integration/site-keyword-metrics-strip.test.ts`.
 */
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import db from '../../server/db/index.js';
import { setBroadcast } from '../../server/broadcast.js';
import { createWorkspace, deleteWorkspace, getWorkspace, updateWorkspace } from '../../server/workspaces.js';
import {
  listSiteKeywordMetrics,
  replaceAllSiteKeywordMetrics,
  resolveSiteKeywordMetrics,
  countSiteKeywordMetrics,
  deleteAllSiteKeywordMetrics,
  migrateSiteKeywordMetricsFromBlob,
} from '../../server/site-keyword-metrics.js';
import { persistKeywordStrategy } from '../../server/keyword-strategy-persistence.js';
import { reconcileStrategyRankTracking } from '../../server/rank-tracking-reconciliation.js';
import { getTrackedKeywords } from '../../server/rank-tracking.js';
import { TRACKED_KEYWORD_SOURCE } from '../../shared/types/rank-tracking.js';
import type { KeywordStrategy } from '../../shared/types/workspace.js';
import type { KeywordStrategySiteKeywordMetric } from '../../server/keyword-strategy-enrichment.js';

const cleanupWorkspaceIds: string[] = [];

beforeAll(() => {
  // persistKeywordStrategy broadcasts; the unit-test process never inits the WS layer.
  setBroadcast(() => {}, () => {});
});

afterAll(() => {
  for (const workspaceId of cleanupWorkspaceIds) {
    deleteAllSiteKeywordMetrics(workspaceId);
    deleteWorkspace(workspaceId);
  }
});

function metric(over: Partial<KeywordStrategySiteKeywordMetric> = {}): KeywordStrategySiteKeywordMetric {
  return { keyword: 'dental implants', volume: 3200, difficulty: 41, ...over };
}

// ── Store CRUD ──

describe('site-keyword-metrics store', () => {
  it('replaceAll then list round-trips the metrics', () => {
    const ws = createWorkspace(`SKM Store ${Date.now()}`);
    cleanupWorkspaceIds.push(ws.id);

    replaceAllSiteKeywordMetrics(ws.id, [
      metric({ keyword: 'teeth whitening', volume: 1800, difficulty: 22 }),
      metric({ keyword: 'dental implants', volume: 3200, difficulty: 41 }),
    ]);

    const rows = listSiteKeywordMetrics(ws.id);
    expect(rows).toHaveLength(2);
    // Stable ordering: volume DESC.
    expect(rows[0]).toEqual({ keyword: 'dental implants', volume: 3200, difficulty: 41 });
    expect(rows[1]).toEqual({ keyword: 'teeth whitening', volume: 1800, difficulty: 22 });
    expect(countSiteKeywordMetrics(ws.id)).toBe(2);
  });

  it('replaceAll with [] CLEARS existing rows (no staleness vs the blob)', () => {
    const ws = createWorkspace(`SKM EmptyClear ${Date.now()}`);
    cleanupWorkspaceIds.push(ws.id);

    replaceAllSiteKeywordMetrics(ws.id, [metric({ keyword: 'will be cleared', volume: 500, difficulty: 20 })]);
    expect(countSiteKeywordMetrics(ws.id)).toBe(1);

    // A subsequent persist whose metrics became empty must DELETE the stale rows.
    // The table is now the sole store, so leaving stale rows would serve stale data.
    replaceAllSiteKeywordMetrics(ws.id, []);
    expect(countSiteKeywordMetrics(ws.id)).toBe(0);
    expect(listSiteKeywordMetrics(ws.id)).toEqual([]);

    // The table-only resolver returns [] — no blob fallback.
    expect(resolveSiteKeywordMetrics(ws.id)).toEqual([]);
  });

  it('deduplicates by normalized_query (keywordComparisonKey), last wins', () => {
    const ws = createWorkspace(`SKM Dedupe ${Date.now()}`);
    cleanupWorkspaceIds.push(ws.id);

    replaceAllSiteKeywordMetrics(ws.id, [
      metric({ keyword: 'Dental Implants', volume: 100, difficulty: 10 }),
      metric({ keyword: 'dental implants!', volume: 999, difficulty: 50 }),
    ]);

    const rows = listSiteKeywordMetrics(ws.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].volume).toBe(999);
  });
});

// ── (a) Strip-write: a persist populates the table and STRIPS the blob ──

describe('site-keyword-metrics strip-write via persistKeywordStrategy', () => {
  it('populates the table on persist AND strips siteKeywordMetrics from the blob', () => {
    const ws = createWorkspace(`SKM DualWrite ${Date.now()}`);
    cleanupWorkspaceIds.push(ws.id);

    const siteKeywordMetrics: KeywordStrategySiteKeywordMetric[] = [
      { keyword: 'emergency dentist', volume: 5400, difficulty: 38 },
      { keyword: 'invisalign cost', volume: 2900, difficulty: 33 },
    ];

    persistKeywordStrategy({
      ws: getWorkspace(ws.id)!,
      strategy: { siteKeywords: ['emergency dentist', 'invisalign cost'], pageMap: [], contentGaps: [], quickWins: [] } as never,
      strategyMode: 'full',
      pagesToAnalyze: [],
      siteKeywordMetrics,
      keywordGaps: [],
      competitorKeywordData: [],
      topicClusters: [],
      cannibalization: [],
      questionKeywords: [],
      businessContext: 'A dental clinic.',
      seoDataMode: 'full',
      seoDataStatus: { mode: 'full', status: 'available' },
      searchData: { deviceBreakdown: [], countryBreakdown: [], periodComparison: undefined, organicLandingPages: [], organicOverview: undefined },
    });

    // Table is the sole store.
    const rows = listSiteKeywordMetrics(ws.id);
    expect(rows.map(r => r.keyword).sort()).toEqual(['emergency dentist', 'invisalign cost']);

    // Blob NO LONGER carries siteKeywordMetrics (Wave 3b-ii strip).
    const reloaded = getWorkspace(ws.id);
    expect(reloaded?.keywordStrategy?.siteKeywordMetrics).toBeUndefined();

    // Belt-and-suspenders: assert the raw stored JSON column has no such key.
    const rawRow = db.prepare('SELECT keyword_strategy FROM workspaces WHERE id = ?').get(ws.id) as { keyword_strategy: string | null };
    expect(rawRow.keyword_strategy).toBeTruthy();
    expect(JSON.parse(rawRow.keyword_strategy as string)).not.toHaveProperty('siteKeywordMetrics');

    // But the resolver still serves the metrics from the table.
    expect(resolveSiteKeywordMetrics(ws.id).map(m => m.keyword).sort())
      .toEqual(['emergency dentist', 'invisalign cost']);
  });
});

// ── (b) Boot backfill: legacy blob-only workspace gets its table populated ──

describe('migrateSiteKeywordMetricsFromBlob (boot backfill)', () => {
  it('populates the table from a legacy blob-only workspace and KEEPS the blob', () => {
    const ws = createWorkspace(`SKM Backfill ${Date.now()}`);
    cleanupWorkspaceIds.push(ws.id);

    // Legacy state: blob has metrics, table is empty.
    updateWorkspace(ws.id, { keywordStrategy: {
      siteKeywords: ['legacy keyword'],
      siteKeywordMetrics: [{ keyword: 'legacy keyword', volume: 700, difficulty: 12 }],
      opportunities: [],
      generatedAt: '2026-01-01T00:00:00.000Z',
    } as KeywordStrategy });
    expect(countSiteKeywordMetrics(ws.id)).toBe(0);

    migrateSiteKeywordMetricsFromBlob();

    expect(listSiteKeywordMetrics(ws.id)).toEqual([{ keyword: 'legacy keyword', volume: 700, difficulty: 12 }]);
    // NO strip: blob array still present after backfill.
    expect(getWorkspace(ws.id)?.keywordStrategy?.siteKeywordMetrics)
      .toEqual([{ keyword: 'legacy keyword', volume: 700, difficulty: 12 }]);
  });

  it('is idempotent — a second run does not duplicate or error', () => {
    const ws = createWorkspace(`SKM BackfillIdem ${Date.now()}`);
    cleanupWorkspaceIds.push(ws.id);
    updateWorkspace(ws.id, { keywordStrategy: {
      siteKeywords: ['idem keyword'],
      siteKeywordMetrics: [{ keyword: 'idem keyword', volume: 1, difficulty: 1 }],
      opportunities: [],
      generatedAt: '2026-01-01T00:00:00.000Z',
    } as KeywordStrategy });
    migrateSiteKeywordMetricsFromBlob();
    migrateSiteKeywordMetricsFromBlob();
    expect(listSiteKeywordMetrics(ws.id)).toHaveLength(1);
  });
});

// ── (c) Table-only resolver: resolveSiteKeywordMetrics reads the table, no fallback ──

describe('resolveSiteKeywordMetrics (table-only, no blob fallback)', () => {
  it('returns table values when the table is populated', () => {
    const ws = createWorkspace(`SKM ResolveTable ${Date.now()}`);
    cleanupWorkspaceIds.push(ws.id);
    replaceAllSiteKeywordMetrics(ws.id, [metric({ keyword: 'from table', volume: 10, difficulty: 5 })]);
    expect(resolveSiteKeywordMetrics(ws.id)).toEqual([{ keyword: 'from table', volume: 10, difficulty: 5 }]);
  });

  it('returns [] when the table is empty (NO blob fallback after the strip)', () => {
    const ws = createWorkspace(`SKM ResolveEmpty ${Date.now()}`);
    cleanupWorkspaceIds.push(ws.id);
    // Even if a legacy blob still carried metrics, the resolver ignores it.
    updateWorkspace(ws.id, { keywordStrategy: {
      siteKeywords: ['ignored'],
      siteKeywordMetrics: [{ keyword: 'from blob', volume: 99, difficulty: 99 }],
      opportunities: [],
      generatedAt: '2026-01-01T00:00:00.000Z',
    } as KeywordStrategy });
    expect(resolveSiteKeywordMetrics(ws.id)).toEqual([]);
  });
});

// ── (d) Reconcile baseline: volume/difficulty still attach to STRATEGY_SITE_KEYWORD ──

describe('reconcile baseline attaches volume/difficulty from metrics', () => {
  it('STRATEGY_SITE_KEYWORD targets carry the metric baseline', () => {
    const ws = createWorkspace(`SKM Reconcile ${Date.now()}`);
    cleanupWorkspaceIds.push(ws.id);

    // The reconcile join resolves siteKeywordMetrics from the table (table-as-truth).
    replaceAllSiteKeywordMetrics(ws.id, [{ keyword: 'site keyword one', volume: 4444, difficulty: 27 }]);

    reconcileStrategyRankTracking({
      workspaceId: ws.id,
      keywordStrategy: {
        siteKeywords: ['site keyword one'],
        generatedAt: '2026-06-01T00:00:00.000Z',
      },
      pageMap: [],
      generatedAt: '2026-06-01T00:00:00.000Z',
    });

    const tracked = getTrackedKeywords(ws.id, { includeInactive: true });
    const siteKw = tracked.find(t => t.source === TRACKED_KEYWORD_SOURCE.STRATEGY_SITE_KEYWORD);
    expect(siteKw).toBeDefined();
    expect(siteKw?.volume).toBe(4444);
    expect(siteKw?.difficulty).toBe(27);
  });
});

// ── (e) Schema: columns + CASCADE ──

describe('site_keyword_metrics schema', () => {
  it('has the expected columns', () => {
    const cols = (db.prepare('PRAGMA table_info(site_keyword_metrics)').all() as Array<{ name: string }>).map(c => c.name);
    for (const col of ['workspace_id', 'normalized_query', 'keyword', 'volume', 'difficulty']) {
      expect(cols, `site_keyword_metrics.${col} should exist`).toContain(col);
    }
  });

  it('cascades on workspace delete', () => {
    const ws = createWorkspace(`SKM Cascade ${Date.now()}`);
    replaceAllSiteKeywordMetrics(ws.id, [metric()]);
    expect(countSiteKeywordMetrics(ws.id)).toBe(1);

    db.pragma('foreign_keys = ON');
    db.prepare('DELETE FROM workspaces WHERE id = ?').run(ws.id);

    const after = db.prepare('SELECT COUNT(*) as cnt FROM site_keyword_metrics WHERE workspace_id = ?').get(ws.id) as { cnt: number };
    expect(after.cnt).toBe(0);
  });
});
