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
import db from '../../server/db/index.js';
import {
  buildKeywordCommandCenterDetail,
  buildKeywordCommandCenterInitialView,
  buildKeywordCommandCenterRows,
  buildKeywordCommandCenterSummary,
} from '../../server/keyword-command-center.js';
import * as assemblerModule from '../../server/keyword-strategy-assembler.js';
import { replaceAllContentGaps } from '../../server/content-gaps.js';
import { replaceAllKeywordGaps } from '../../server/keyword-gaps.js';
import { replaceAllSiteKeywordMetrics } from '../../server/site-keyword-metrics.js';
import { upsertPageKeyword } from '../../server/page-keywords.js';
import { addTrackedKeyword, storeRankSnapshot } from '../../server/rank-tracking.js';
import { createWorkspace, deleteWorkspace, updateWorkspace } from '../../server/workspaces.js';
import { KEYWORD_COMMAND_CENTER_FILTERS } from '../../shared/types/keyword-command-center.js';
import type { KeywordStrategy } from '../../shared/types/workspace.js';

let workspaceId = '';

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
