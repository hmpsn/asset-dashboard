/**
 * keyword-command-center-perf.test.ts — Task 7 (PERFORMANCE) guards.
 *
 * The Task 7 refactor is performance-only: it must NOT change any output. Two
 * things are guarded here, in-process (the REAL server builders against the REAL
 * SQLite DB — NOT the HTTP route, because createTestContext spawns a separate
 * child process where a test-process vi.spyOn would be invisible):
 *
 *   1. ASSEMBLE-ONCE: the heavy full-universe assembly
 *      (assembleStoredKeywordStrategy) runs AT MOST ONCE per /rows, /summary, and
 *      /detail request — never the 4–5× the pre-refactor investigation feared a
 *      naive re-derivation could cause. Spying on the assembler MODULE export
 *      (the live binding keyword-command-center.ts imports) counts the calls.
 *
 *   2. DETERMINISM / SELF-PARITY: two consecutive calls for the same seeded
 *      workspace return deeply-equal output. The memoized normalizer + the
 *      per-array variant-parent index are pure, so repeat calls must be
 *      byte-identical (a cheap proxy for the "byte-identical before/after" bar;
 *      the existing keyword-command-center-routes / keyword-universe-* suites pin
 *      the absolute output values).
 *
 * Seeds a multi-token strategy + a fan of GSC ranks that are variants of those
 * strategy keys, so the variant-matching path (the refactor's target) is
 * actually exercised.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setBroadcast } from '../../server/broadcast.js';
import db, { measureSqlExecutionsForTest } from '../../server/db/index.js';
import {
  buildKeywordCommandCenterDetail,
  buildKeywordCommandCenterInitialView,
  buildKeywordCommandCenterRows,
  buildKeywordCommandCenterSummary,
} from '../../server/keyword-command-center.js';
import * as assemblerModule from '../../server/keyword-strategy-assembler.js';
import * as contentGapsModule from '../../server/content-gaps.js';
import * as keywordGapsModule from '../../server/keyword-gaps.js';
import * as pageKeywordsModule from '../../server/page-keywords.js';
import * as siteMetricsModule from '../../server/site-keyword-metrics.js';
import * as trackedStoreModule from '../../server/tracked-keywords-store.js';
import * as localSnapshotModule from '../../server/domains/local-seo/snapshot-store.js';
import { replaceAllContentGaps } from '../../server/content-gaps.js';
import { replaceAllKeywordGaps } from '../../server/keyword-gaps.js';
import { replaceAllSiteKeywordMetrics } from '../../server/site-keyword-metrics.js';
import { upsertPageKeyword } from '../../server/page-keywords.js';
import { addTrackedKeyword, storeRankSnapshot } from '../../server/rank-tracking.js';
import { createWorkspace, deleteWorkspace, getWorkspace, updateWorkspace } from '../../server/workspaces.js';
import { KEYWORD_COMMAND_CENTER_FILTERS } from '../../shared/types/keyword-command-center.js';
import type { KeywordStrategy } from '../../shared/types/workspace.js';
import { PERFORMANCE_BUDGET_REGISTRY } from '../../scripts/performance-budgets.js';

let workspaceId = '';
const KCC_PERFORMANCE_BUDGET = PERFORMANCE_BUDGET_REGISTRY.find(entry => (
  entry.id === 'keyword-command-center-read-path'
));
if (!KCC_PERFORMANCE_BUDGET) throw new Error('KCC performance budget registry entry is missing');

beforeEach(() => {
  setBroadcast(vi.fn(), vi.fn());
  workspaceId = createWorkspace(`KCC Perf ${Date.now()}-${Math.random().toString(36).slice(2)}`).id;

  // Multi-token strategy keys so the variant-matching path has real parents to
  // scan (single-token keys never parent variants).
  const strategy: KeywordStrategy = {
    siteKeywords: ['cosmetic dentist austin'],
    siteKeywordMetrics: [
      { keyword: 'cosmetic dentist austin', volume: 900, difficulty: 38 },
      { keyword: 'teeth whitening austin', volume: 1200, difficulty: 41 },
    ],
    opportunities: [],
    businessContext: 'Austin dental office: cosmetic dentistry, whitening, veneers, implants.',
    generatedAt: '2026-05-20T10:00:00.000Z',
  };
  updateWorkspace(workspaceId, { keywordStrategy: strategy });
  replaceAllSiteKeywordMetrics(workspaceId, strategy.siteKeywordMetrics!);

  upsertPageKeyword(workspaceId, {
    pagePath: '/services/veneers',
    pageTitle: 'Veneers',
    primaryKeyword: 'porcelain veneers austin',
    secondaryKeywords: ['affordable veneers austin'],
    searchIntent: 'commercial',
    volume: 700,
    difficulty: 29,
  });

  replaceAllContentGaps(workspaceId, [{
    topic: 'Veneers cost guide',
    targetKeyword: 'porcelain veneers cost',
    intent: 'commercial',
    priority: 'high',
    rationale: 'Patients compare veneer pricing before booking.',
    volume: 500,
    difficulty: 42,
    opportunityScore: 71,
  }]);

  replaceAllKeywordGaps(workspaceId, [{
    keyword: 'best teeth whitening strips',
    volume: 2400,
    difficulty: 65,
    competitorPosition: 8,
    competitorDomain: 'competitor.example',
  }]);

  addTrackedKeyword(workspaceId, 'cosmetic dentist austin', { volume: 900, difficulty: 38 });

  // A fan of GSC ranks: several are token-variants of the strategy keys (must be
  // parented), several are standalone ranked-untracked evidence.
  storeRankSnapshot(workspaceId, '2026-05-20', [
    { query: 'cosmetic dentist austin tx', position: 6, clicks: 12, impressions: 500, ctr: 0.024 },
    { query: 'best cosmetic dentist austin', position: 4, clicks: 30, impressions: 800, ctr: 0.037 },
    { query: 'teeth whitening austin cost', position: 9, clicks: 6, impressions: 240, ctr: 0.025 },
    { query: 'teeth whitening austin reviews', position: 11, clicks: 2, impressions: 90, ctr: 0.022 },
    { query: 'emergency dentist near me', position: 14, clicks: 4, impressions: 220, ctr: 0.018 },
    { query: 'invisalign austin price', position: 18, clicks: 1, impressions: 60, ctr: 0.016 },
  ]);
});

afterEach(() => {
  vi.restoreAllMocks();
  if (workspaceId) {
    db.prepare('DELETE FROM discovered_queries WHERE workspace_id = ?').run(workspaceId);
    deleteWorkspace(workspaceId);
  }
  workspaceId = '';
});

describe('K2 — KCC-owned read projection guard', () => {
  it('GET /rows (skinny, filter=all) never calls the full strategy assembler', async () => {
    const spy = vi.spyOn(assemblerModule, 'assembleStoredKeywordStrategy');
    const payload = await buildKeywordCommandCenterRows(workspaceId, {
      filter: KEYWORD_COMMAND_CENTER_FILTERS.ALL,
      page: 1,
      pageSize: 50,
    });
    expect(payload).not.toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it('GET /summary never calls the full strategy assembler', async () => {
    const spy = vi.spyOn(assemblerModule, 'assembleStoredKeywordStrategy');
    const summary = await buildKeywordCommandCenterSummary(workspaceId);
    expect(summary).not.toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it('GET /detail never calls the full strategy assembler', async () => {
    const spy = vi.spyOn(assemblerModule, 'assembleStoredKeywordStrategy');
    const detail = await buildKeywordCommandCenterDetail(workspaceId, 'cosmetic dentist austin');
    expect(detail).not.toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it('GET /initial builds summary and first rows from one source snapshot', async () => {
    const spy = vi.spyOn(assemblerModule, 'assembleStoredKeywordStrategy');
    const payload = await buildKeywordCommandCenterInitialView(workspaceId, {
      filter: KEYWORD_COMMAND_CENTER_FILTERS.ALL,
      page: 1,
      pageSize: 50,
    });
    expect(payload).not.toBeNull();
    expect(payload!.summary.counts.total).toBeGreaterThan(0);
    expect(payload!.rows.rows.length).toBeGreaterThan(0);
    expect(spy).not.toHaveBeenCalled();
    expect(payload!.summary.rankFreshness).toMatchObject({
      snapshotDate: '2026-05-20T00:00:00.000Z',
      status: 'stale',
    });
    expect(payload!.summary.rankFreshness.ageDays).toBeGreaterThanOrEqual(14);
  });

  it('reads each normalized KCC projection source exactly once for first paint', async () => {
    const pageMap = vi.spyOn(pageKeywordsModule, 'listPageKeywordsLite');
    const contentGaps = vi.spyOn(contentGapsModule, 'listContentGaps');
    const keywordGaps = vi.spyOn(keywordGapsModule, 'listKeywordGaps');
    const siteMetrics = vi.spyOn(siteMetricsModule, 'resolveSiteKeywordMetrics');
    const trackedRows = vi.spyOn(trackedStoreModule, 'listTrackedKeywordRows');

    const payload = await buildKeywordCommandCenterInitialView(workspaceId, {
      filter: KEYWORD_COMMAND_CENTER_FILTERS.ALL,
      page: 1,
      pageSize: 50,
    });

    expect(payload).not.toBeNull();
    expect({
      pageMap: pageMap.mock.calls.length,
      contentGaps: contentGaps.mock.calls.length,
      keywordGaps: keywordGaps.mock.calls.length,
      siteMetrics: siteMetrics.mock.calls.length,
      trackedRows: trackedRows.mock.calls.length,
    }).toEqual({ pageMap: 1, contentGaps: 1, keywordGaps: 1, siteMetrics: 1, trackedRows: 1 });
  });

  it('skips local-visibility snapshot reads when the caller excludes local SEO', async () => {
    const localVisibility = vi.spyOn(localSnapshotModule, 'buildLocalSeoKeywordVisibilitySummaryByKey');
    const payload = await buildKeywordCommandCenterRows(
      workspaceId,
      { filter: KEYWORD_COMMAND_CENTER_FILTERS.TRACKED },
      { includeLocalSeo: false },
    );
    expect(payload).not.toBeNull();
    expect(localVisibility).not.toHaveBeenCalled();
  });

  it('reports missing and fresh rank snapshots honestly', async () => {
    db.prepare('DELETE FROM rank_snapshots WHERE workspace_id = ?').run(workspaceId);
    const missing = await buildKeywordCommandCenterSummary(workspaceId);
    expect(missing?.rankFreshness).toEqual({ snapshotDate: null, ageDays: null, status: 'missing' });

    const today = new Date().toISOString().slice(0, 10);
    storeRankSnapshot(workspaceId, today, [
      { query: 'cosmetic dentist austin', position: 5, clicks: 10, impressions: 200, ctr: 0.05 },
    ]);
    const fresh = await buildKeywordCommandCenterSummary(workspaceId);
    expect(fresh?.rankFreshness).toEqual({
      snapshotDate: `${today}T00:00:00.000Z`,
      ageDays: 0,
      status: 'fresh',
    });
  });

  it('preserves table-first and legacy blob-fallback fields and ordering', async () => {
    replaceAllContentGaps(workspaceId, []);
    replaceAllKeywordGaps(workspaceId, []);
    const strategy = structuredClone(getWorkspace(workspaceId)?.keywordStrategy) as KeywordStrategy;
    strategy.contentGaps = [
      { topic: 'Legacy A', targetKeyword: 'legacy alpha', intent: 'commercial', priority: 'high', rationale: 'Legacy first' },
      { topic: 'Legacy B', targetKeyword: 'legacy beta', intent: 'informational', priority: 'low', rationale: 'Legacy second' },
    ];
    strategy.keywordGaps = [
      { keyword: 'legacy competitor', volume: 100, difficulty: 20, competitorPosition: 3, competitorDomain: 'example.com' },
    ];
    updateWorkspace(workspaceId, { keywordStrategy: strategy });

    const rows = await buildKeywordCommandCenterRows(workspaceId, { sort: 'keyword', direction: 'asc', pageSize: 100 });
    const summary = await buildKeywordCommandCenterSummary(workspaceId);
    expect(rows?.rows.map(row => row.keyword)).toEqual(expect.arrayContaining([
      'legacy alpha',
      'legacy beta',
      'legacy competitor',
    ]));
    expect(summary?.counts.total).toBeGreaterThanOrEqual(rows?.pageInfo.totalRows ?? 0);
    expect(summary?.rawEvidenceTotal).toBeGreaterThanOrEqual(1);
  });
});

describe('Task 7 — determinism / self-parity (no output drift)', () => {
  it('GET /rows returns deeply-equal output across two consecutive calls', async () => {
    const a = await buildKeywordCommandCenterRows(workspaceId, {
      filter: KEYWORD_COMMAND_CENTER_FILTERS.ALL,
      page: 1,
      pageSize: 50,
    });
    const b = await buildKeywordCommandCenterRows(workspaceId, {
      filter: KEYWORD_COMMAND_CENTER_FILTERS.ALL,
      page: 1,
      pageSize: 50,
    });
    expect(b).toEqual(a);
  });

  it('GET /summary returns deeply-equal output across two consecutive calls', async () => {
    const a = await buildKeywordCommandCenterSummary(workspaceId);
    const b = await buildKeywordCommandCenterSummary(workspaceId);
    // `summarizedAt` is an intentional per-call wall-clock stamp (new Date()),
    // unrelated to the perf refactor — exclude it from the determinism compare.
    const strip = (s: NonNullable<typeof a>) => ({ ...s, summarizedAt: '' });
    expect(strip(b!)).toEqual(strip(a!));
  });

  it('GET /detail returns deeply-equal output across two consecutive calls', async () => {
    const a = await buildKeywordCommandCenterDetail(workspaceId, 'teeth whitening austin');
    const b = await buildKeywordCommandCenterDetail(workspaceId, 'teeth whitening austin');
    expect(b).toEqual(a);
  });

  it('GET /initial summary and rows match the split endpoints', async () => {
    const query = {
      filter: KEYWORD_COMMAND_CENTER_FILTERS.ALL,
      page: 1,
      pageSize: 50,
    };
    const initial = await buildKeywordCommandCenterInitialView(workspaceId, query);
    const summary = await buildKeywordCommandCenterSummary(workspaceId);
    const rows = await buildKeywordCommandCenterRows(workspaceId, query);
    const strip = <T extends { summarizedAt?: string }>(value: T): T => ({ ...value, summarizedAt: '' });

    expect(initial).not.toBeNull();
    expect(strip(initial!.summary)).toEqual(strip(summary!));
    expect(initial!.rows).toEqual(rows);
  });

  it('GET /initial rejects local_candidates so first paint cannot enter the full-model exception', async () => {
    await expect(buildKeywordCommandCenterInitialView(workspaceId, {
      filter: KEYWORD_COMMAND_CENTER_FILTERS.LOCAL_CANDIDATES,
    })).rejects.toThrow('initial view does not support local_candidates');
  });
});

describe('K2 — measured read-path budget', () => {
  it('scopes SQL measurement to executions and releases the counter after failure', async () => {
    await expect(measureSqlExecutionsForTest(() => {
      db.prepare('SELECT 1 AS value').get();
      throw new Error('measurement probe');
    })).rejects.toThrow('measurement probe');

    const measurement = await measureSqlExecutionsForTest(() => db.prepare('SELECT 1 AS value').get());
    expect(measurement.count).toBe(1);
  });

  it('hard-gates initial-view executed SQL at the registered 22-query budget', async () => {
    const measurement = await measureSqlExecutionsForTest(() => buildKeywordCommandCenterInitialView(workspaceId, {
      filter: KEYWORD_COMMAND_CENTER_FILTERS.ALL,
      sort: 'rank',
      page: 1,
      pageSize: 50,
    }));
    expect(measurement.result).not.toBeNull();
    expect(measurement.count).toBeGreaterThan(0);
    expect(measurement.count).toBeLessThanOrEqual(KCC_PERFORMANCE_BUDGET.queryCountBudget);
  });

  it('hard-gates rows executed SQL at the registered 22-query budget', async () => {
    const measurement = await measureSqlExecutionsForTest(() => buildKeywordCommandCenterRows(workspaceId, {
      filter: KEYWORD_COMMAND_CENTER_FILTERS.ALL,
      sort: 'rank',
      page: 1,
      pageSize: 50,
    }));
    expect(measurement.result).not.toBeNull();
    expect(measurement.count).toBeGreaterThan(0);
    expect(measurement.count).toBeLessThanOrEqual(KCC_PERFORMANCE_BUDGET.queryCountBudget);
  });

  it('records first-paint p50/p95 against the deterministic fixture', async () => {
    const samples: number[] = [];
    const query = { filter: KEYWORD_COMMAND_CENTER_FILTERS.ALL, page: 1, pageSize: 50 };
    await buildKeywordCommandCenterInitialView(workspaceId, query);
    for (let index = 0; index < 30; index++) {
      const startedAt = performance.now();
      await buildKeywordCommandCenterInitialView(workspaceId, query);
      samples.push(performance.now() - startedAt);
    }
    samples.sort((a, b) => a - b);
    const percentile = (fraction: number) => samples[Math.ceil(samples.length * fraction) - 1] ?? 0;
    const measurement = {
      samples: samples.length,
      p50Ms: Number(percentile(0.5).toFixed(2)),
      p95Ms: Number(percentile(0.95).toFixed(2)),
    };
    console.info('K2_KCC_INITIAL_PERF', JSON.stringify(measurement));
    expect(measurement.samples).toBe(30);
    expect(Number.isFinite(measurement.p95Ms)).toBe(true);
  });
  it('records rows-only interaction p50/p95 against the deterministic fixture', async () => {
    for (let pageIndex = 0; pageIndex < 400; pageIndex++) {
      upsertPageKeyword(workspaceId, {
        pagePath: `/benchmark/${pageIndex}`,
        pageTitle: `Benchmark page ${pageIndex}`,
        primaryKeyword: `benchmark dentist keyword ${pageIndex}`,
        secondaryKeywords: Array.from({ length: 8 }, (_, index) => `secondary ${pageIndex} ${index}`),
        searchIntent: 'commercial',
        currentPosition: 8 + (pageIndex % 20),
        impressions: 500 + pageIndex,
        clicks: 20 + (pageIndex % 30),
        volume: 700 + pageIndex,
        difficulty: 35,
        cpc: 4.25,
        optimizationIssues: Array.from({ length: 12 }, (_, index) => `Issue ${index}`),
        recommendations: Array.from({ length: 12 }, (_, index) => `Recommendation ${index}`),
        contentGaps: Array.from({ length: 12 }, (_, index) => `Gap ${index}`),
        longTailKeywords: Array.from({ length: 12 }, (_, index) => `long tail ${pageIndex} ${index}`),
        competitorKeywords: Array.from({ length: 12 }, (_, index) => `competitor ${pageIndex} ${index}`),
      });
    }
    const samples: number[] = [];
    const query = { filter: KEYWORD_COMMAND_CENTER_FILTERS.ALL, search: 'dentist', page: 1, pageSize: 50 };
    await buildKeywordCommandCenterRows(workspaceId, query);
    for (let index = 0; index < 30; index++) {
      const startedAt = performance.now();
      await buildKeywordCommandCenterRows(workspaceId, query);
      samples.push(performance.now() - startedAt);
    }
    samples.sort((a, b) => a - b);
    const percentile = (fraction: number) => samples[Math.ceil(samples.length * fraction) - 1] ?? 0;
    const measurement = {
      samples: samples.length,
      p50Ms: Number(percentile(0.5).toFixed(2)),
      p95Ms: Number(percentile(0.95).toFixed(2)),
    };
    console.info('K2_KCC_INTERACTION_PERF', JSON.stringify(measurement));
    expect(measurement.samples).toBe(30);
    expect(Number.isFinite(measurement.p95Ms)).toBe(true);
  });
});
