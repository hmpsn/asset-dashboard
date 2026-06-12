/**
 * Wave 3b-ii (#19b) — siteKeywordMetrics BLOB STRIP survival gate (table-as-truth).
 *
 * This is the highest silent-data-loss-risk change in the wave: a wrong strip
 * destroys real SEMRush metric data. These tests prove the metrics SURVIVE the
 * strip through the table, and that the closed generation loop does not lose them.
 *
 *  - Closed-loop survival: persist a strategy with non-empty siteKeywordMetrics →
 *    the stored keyword_strategy blob column does NOT carry siteKeywordMetrics
 *    (strip happened) → the REAL public read path still returns the metrics (from
 *    the table) → an incremental re-persist that sources `existingStrategy` the
 *    SAME WAY generation does (a RAW blob read of ws.keywordStrategy, with
 *    siteKeywordMetrics resolved from the table) keeps the metrics. The loop
 *    closes through the table, not the blob.
 *  - Reconcile baseline: volume/difficulty still attach to STRATEGY_SITE_KEYWORD
 *    targets via the reconcile join after the strip.
 *
 * collides with tracked-keywords-row-table.test.ts (merged to staging via
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createEphemeralTestContext } from './helpers.js';
import db from '../../server/db/index.js';
import { setBroadcast } from '../../server/broadcast.js';
import { createWorkspace, getWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { persistKeywordStrategy } from '../../server/keyword-strategy-persistence.js';
import { resolveSiteKeywordMetrics, listSiteKeywordMetrics } from '../../server/site-keyword-metrics.js';
import { reconcileStrategyRankTracking } from '../../server/rank-tracking-reconciliation.js';
import { addTrackedKeyword, getTrackedKeywords, storeRankSnapshot } from '../../server/rank-tracking.js';
import { TRACKED_KEYWORD_SOURCE } from '../../shared/types/rank-tracking.js';
import type { KeywordStrategy } from '../../shared/types/workspace.js';
import type { KeywordStrategySiteKeywordMetric } from '../../server/keyword-strategy-enrichment.js';

const ctx = createEphemeralTestContext(import.meta.url, { autoPublicAuth: true });
const { api } = ctx;

const cleanupIds: string[] = [];

interface PublicStrategy {
  siteKeywordMetrics?: { keyword: string; volume: number; difficulty: number }[];
}

/** Read the RAW keyword_strategy JSON blob column straight from the DB. */
function rawStrategyBlob(workspaceId: string): Record<string, unknown> | null {
  const row = db.prepare('SELECT keyword_strategy FROM workspaces WHERE id = ?').get(workspaceId) as
    | { keyword_strategy: string | null }
    | undefined;
  if (!row?.keyword_strategy) return null;
  return JSON.parse(row.keyword_strategy) as Record<string, unknown>;
}

/** Minimal persist invocation that mirrors the real persist contract. */
function persist(workspaceId: string, siteKeywordMetrics: KeywordStrategySiteKeywordMetric[], siteKeywords: string[]) {
  persistKeywordStrategy({
    ws: getWorkspace(workspaceId)!,
    strategy: { siteKeywords, pageMap: [], contentGaps: [], quickWins: [] } as never,
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
}

beforeAll(async () => {
  // persistKeywordStrategy broadcasts; this in-process test never inits the WS layer.
  setBroadcast(() => {}, () => {});
  await ctx.startServer();
}, 25_000);

afterAll(async () => {
  for (const id of cleanupIds) deleteWorkspace(id);
  await ctx.stopServer();
});

describe('Wave 3b-ii — siteKeywordMetrics blob strip survival', () => {
  it('strips the blob, serves metrics from the table, and survives the closed generation loop', async () => {
    const wsId = createWorkspace(`SKM Strip Loop ${ctx.PORT}`).id;
    cleanupIds.push(wsId);

    const metrics: KeywordStrategySiteKeywordMetric[] = [
      { keyword: 'emergency dentist', volume: 5400, difficulty: 38 },
      { keyword: 'invisalign cost', volume: 2900, difficulty: 33 },
    ];

    // 1. Persist a strategy with non-empty siteKeywordMetrics.
    persist(wsId, metrics, ['emergency dentist', 'invisalign cost']);

    // 2. The stored keyword_strategy blob column does NOT carry siteKeywordMetrics.
    const blob = rawStrategyBlob(wsId);
    expect(blob).toBeTruthy();
    expect(blob).not.toHaveProperty('siteKeywordMetrics');
    // And the read-boundary view (ws.keywordStrategy, a raw blob parse) confirms it.
    expect(getWorkspace(wsId)?.keywordStrategy?.siteKeywordMetrics).toBeUndefined();

    // The table is the sole store and carries them.
    expect(listSiteKeywordMetrics(wsId).map(m => m.keyword).sort()).toEqual(['emergency dentist', 'invisalign cost']);

    // 3. The REAL public read path still returns the metrics (from the table).
    const res1 = await api(`/api/public/seo-strategy/${wsId}`);
    expect(res1.status).toBe(200);
    const body1 = await res1.json() as PublicStrategy;
    expect(body1.siteKeywordMetrics).toEqual([
      { keyword: 'emergency dentist', volume: 5400, difficulty: 38 },
      { keyword: 'invisalign cost', volume: 2900, difficulty: 33 },
    ]);

    // 4. Simulate an incremental re-persist sourcing `existingStrategy` the SAME
    //    WAY generation does: existingStrategy = ws.keywordStrategy (a RAW blob
    //    read whose siteKeywordMetrics is now undefined), with siteKeywordMetrics
    //    resolved from the table via resolveSiteKeywordMetrics(ws.id). This is the
    //    exact carry-forward path from keyword-strategy-generation.ts.
    const existingStrategy = getWorkspace(wsId)?.keywordStrategy;
    expect(existingStrategy?.siteKeywordMetrics).toBeUndefined(); // blob is empty — the hazard
    const carriedForward = resolveSiteKeywordMetrics(wsId);       // table is the source of truth
    persist(wsId, carriedForward, existingStrategy?.siteKeywords ?? []);

    // 5. Metrics STILL present after the loop — it closed through the table.
    expect(listSiteKeywordMetrics(wsId).map(m => m.keyword).sort()).toEqual(['emergency dentist', 'invisalign cost']);
    const res2 = await api(`/api/public/seo-strategy/${wsId}`);
    const body2 = await res2.json() as PublicStrategy;
    expect(body2.siteKeywordMetrics).toEqual([
      { keyword: 'emergency dentist', volume: 5400, difficulty: 38 },
      { keyword: 'invisalign cost', volume: 2900, difficulty: 33 },
    ]);

    // Re-confirm the blob is still stripped after the re-persist.
    expect(rawStrategyBlob(wsId)).not.toHaveProperty('siteKeywordMetrics');
  });

  it('reconcile baseline: volume/difficulty attach to STRATEGY_SITE_KEYWORD via the table join after the strip', () => {
    const wsId = createWorkspace(`SKM Strip Reconcile ${ctx.PORT}`).id;
    cleanupIds.push(wsId);

    // Persist so the table (sole store) carries the metric; blob is stripped.
    persist(wsId, [{ keyword: 'dental implants', volume: 4444, difficulty: 27 }], ['dental implants']);
    expect(rawStrategyBlob(wsId)).not.toHaveProperty('siteKeywordMetrics');

    // A GSC baseline for the keyword so the reconcile join has a position to attach.
    storeRankSnapshot(wsId, '2026-06-01', [
      { query: 'dental implants', position: 4, clicks: 9, impressions: 300, ctr: 0.03 },
    ]);

    // Reconcile sources siteKeywordMetrics from the table (table-as-truth) — the
    // keywordStrategy Pick no longer carries it.
    reconcileStrategyRankTracking({
      workspaceId: wsId,
      keywordStrategy: {
        siteKeywords: ['dental implants'],
        generatedAt: '2026-06-01T00:00:00.000Z',
      },
      pageMap: [],
      generatedAt: '2026-06-01T00:00:00.000Z',
    });

    const tracked = getTrackedKeywords(wsId, { includeInactive: true });
    const siteKw = tracked.find(t => t.source === TRACKED_KEYWORD_SOURCE.STRATEGY_SITE_KEYWORD);
    expect(siteKw).toBeDefined();
    // Volume/difficulty came from the site_keyword_metrics table after the strip.
    expect(siteKw?.volume).toBe(4444);
    expect(siteKw?.difficulty).toBe(27);
  });

  it('an empty table yields no metrics on the public read — the blob is never a fallback', async () => {
    const wsId = createWorkspace(`SKM Strip NoFallback ${ctx.PORT}`).id;
    cleanupIds.push(wsId);

    // Persist with EMPTY metrics. The blob is stripped, the table is cleared.
    persist(wsId, [], ['orphan keyword']);
    expect(rawStrategyBlob(wsId)).not.toHaveProperty('siteKeywordMetrics');
    expect(listSiteKeywordMetrics(wsId)).toEqual([]);

    // A leftover tracked-keyword inference must NOT resurrect metrics from a blob.
    addTrackedKeyword(wsId, 'orphan keyword', { source: TRACKED_KEYWORD_SOURCE.UNKNOWN });

    const res = await api(`/api/public/seo-strategy/${wsId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as PublicStrategy;
    expect(body.siteKeywordMetrics).toBeUndefined();
  });
});
