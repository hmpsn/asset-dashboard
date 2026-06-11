/**
 * Wave 3a — admin GET byte-identity guard for the assembler swap (#2).
 *
 * Exercises GET /api/webflow/keyword-strategy/:id (the admin read path) for a
 * table-backed workspace and asserts the strategy payload's array fields + the
 * synthesized-shell short-circuit stay exactly as before the swap that routes
 * the route through assembleStoredKeywordStrategy and deletes the redundant
 * re-strip in serializeKeywordStrategy.
 *
 * Port: 13889 (exclusive; 13886 reserved; 13888 used by the public-read gate).
 *
 * F1 (#7c) — DIVERGENT siteKeywordMetrics fixtures. The blob carries a STALE/wrong
 * value while the site_keyword_metrics table carries the REAL value. This pins the
 * admin route's re-attach: the response must equal the TABLE value (resolved by the
 * assembler), proving the route does NOT fall back to the blob `...strategy` spread
 * (the masking bug — identical fixtures could not detect the omission). A parallel
 * public-route assertion confirms both read paths agree on the table value.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import { createWorkspace, updateWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { replaceAllContentGaps } from '../../server/content-gaps.js';
import { replaceAllQuickWins } from '../../server/quick-wins.js';
import { replaceAllKeywordGaps } from '../../server/keyword-gaps.js';
import { replaceAllTopicClusters } from '../../server/topic-clusters.js';
import { replaceAllCannibalizationIssues } from '../../server/cannibalization-issues.js';
import { replaceAllSiteKeywordMetrics } from '../../server/site-keyword-metrics.js';
import { upsertAndCleanPageKeywords } from '../../server/page-keywords.js';
import type { KeywordStrategy, ContentGap, QuickWin, KeywordGapItem, TopicCluster, CannibalizationItem, PageKeywordMap } from '../../shared/types/workspace.js';

const PORT = 13889;
const ctx = createTestContext(PORT, { autoPublicAuth: true });
const { api } = ctx;

let fullWs = '';
let shellWs = '';

const gap: ContentGap = { topic: 't', targetKeyword: 'admin gap keyword', intent: 'informational', priority: 'high', rationale: 'r', volume: 400, backfilled: true };
const win: QuickWin = { pagePath: '/p', action: 'do it', estimatedImpact: 'high', rationale: 'easy', roiScore: 60 };
const kgap: KeywordGapItem = { keyword: 'admin kw gap', volume: 200, difficulty: 15, competitorPosition: 4, competitorDomain: 'rival.com' };
const cluster: TopicCluster = { topic: 'admin tc', keywords: ['a'], ownedCount: 0, totalCount: 1, coveragePercent: 0, gap: ['a'] };
const cannibal: CannibalizationItem = { keyword: 'admin cn', pages: [{ path: '/x', source: 'gsc' }], severity: 'low', recommendation: 'fix' };
const page: PageKeywordMap = { pagePath: '/p', pageTitle: 'P', primaryKeyword: 'admin page keyword', secondaryKeywords: [] };

beforeAll(async () => {
  await ctx.startServer();
  fullWs = createWorkspace(`Admin Assembler Full ${PORT}`).id;
  // DIVERGENT (#7c): the blob carries a STALE siteKeywordMetrics value (volume 1,
  // difficulty 1) — what an un-stripped legacy blob would hold. The table is the
  // SOLE store post-strip and carries the REAL value (volume 1000, difficulty 30).
  // The route must return the TABLE value; if it falls back to the blob spread the
  // test fails, catching the silent-omission regression that identical fixtures hid.
  updateWorkspace(fullWs, { keywordStrategy: {
    siteKeywords: ['admin site kw'], opportunities: ['opp'],
    siteKeywordMetrics: [{ keyword: 'admin site kw', volume: 1, difficulty: 1 }],
    businessContext: 'ctx', generatedAt: '2026-06-01T00:00:00.000Z',
  } as KeywordStrategy });
  upsertAndCleanPageKeywords(fullWs, [page]);
  replaceAllContentGaps(fullWs, [gap]);
  replaceAllQuickWins(fullWs, [win]);
  replaceAllKeywordGaps(fullWs, [kgap]);
  replaceAllTopicClusters(fullWs, [cluster]);
  replaceAllCannibalizationIssues(fullWs, [cannibal]);
  // The REAL metrics live ONLY in the table (table-as-truth post-strip).
  replaceAllSiteKeywordMetrics(fullWs, [{ keyword: 'admin site kw', volume: 1000, difficulty: 30 }]);

  // Shell case: no strategy blob, but table rows exist → synthesized shell (generatedAt null).
  shellWs = createWorkspace(`Admin Assembler Shell ${PORT}`).id;
  upsertAndCleanPageKeywords(shellWs, [page]);
  replaceAllContentGaps(shellWs, [gap]);
}, 25_000);

afterAll(async () => {
  if (fullWs) deleteWorkspace(fullWs);
  if (shellWs) deleteWorkspace(shellWs);
  await ctx.stopServer();
});

describe('GET /api/webflow/keyword-strategy/:id — admin assembler byte-identity', () => {
  it('returns the table-backed arrays + blob scalars for a full workspace', async () => {
    const res = await api(`/api/webflow/keyword-strategy/${fullWs}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.siteKeywords).toEqual(['admin site kw']);
    // #7c: the response carries the TABLE value (volume 1000), NOT the stale blob
    // value (volume 1) — proving the admin route re-attaches the assembled metrics
    // and does not silently drop them in favor of the `...strategy` blob spread.
    expect(body.siteKeywordMetrics).toEqual([{ keyword: 'admin site kw', volume: 1000, difficulty: 30 }]);
    expect(body.opportunities).toEqual(['opp']);
    expect(body.businessContext).toBe('ctx');
    expect(body.generatedAt).toBe('2026-06-01T00:00:00.000Z');
    // The five normalized arrays come from their tables (full admin shape — no public whitelist).
    expect(body.contentGaps).toHaveLength(1);
    expect(body.contentGaps[0].targetKeyword).toBe('admin gap keyword');
    expect(body.contentGaps[0].backfilled).toBe(true);
    expect(body.quickWins).toHaveLength(1);
    expect(body.quickWins[0].action).toBe('do it');
    expect(body.keywordGaps).toHaveLength(1);
    expect(body.keywordGaps[0].keyword).toBe('admin kw gap');
    expect(body.topicClusters).toHaveLength(1);
    expect(body.topicClusters[0].topic).toBe('admin tc');
    expect(body.cannibalization).toHaveLength(1);
    expect(body.cannibalization[0].keyword).toBe('admin cn');
    expect(body.pageMap).toHaveLength(1);
    expect(body.pageMap[0].primaryKeyword).toBe('admin page keyword');
    // strategyUx is present (route-layer projection) and the stale-array strip kept the blob clean.
    expect(body.strategyUx).toBeTruthy();
    // semrushMode never leaks (the re-strip removed it; assembler never carries it).
    expect(body.semrushMode).toBeUndefined();
  });

  it('#7c: admin and public read paths agree on the TABLE siteKeywordMetrics (neither reads the stale blob)', async () => {
    const [adminRes, publicRes] = await Promise.all([
      api(`/api/webflow/keyword-strategy/${fullWs}`),
      api(`/api/public/seo-strategy/${fullWs}`),
    ]);
    expect(adminRes.status).toBe(200);
    expect(publicRes.status).toBe(200);
    const adminBody = await adminRes.json();
    const publicBody = await publicRes.json();
    const real = [{ keyword: 'admin site kw', volume: 1000, difficulty: 30 }];
    expect(adminBody.siteKeywordMetrics).toEqual(real);
    expect(publicBody.siteKeywordMetrics).toEqual(real);
    // The stale blob value (volume 1) appears in NEITHER response.
    expect(adminBody.siteKeywordMetrics).toEqual(publicBody.siteKeywordMetrics);
  });

  it('returns the synthesized shell (generatedAt null) when no blob but tables have rows', async () => {
    const res = await api(`/api/webflow/keyword-strategy/${shellWs}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).not.toBeNull();
    expect(body.generatedAt).toBeNull();
    expect(body.siteKeywords).toEqual([]);
    expect(body.opportunities).toEqual([]);
    expect(body.contentGaps).toHaveLength(1);
    expect(body.pageMap).toHaveLength(1);
    expect(body.strategyUx).toBeTruthy();
  });

  it('returns null for a fresh workspace with no blob and empty tables', async () => {
    const empty = createWorkspace(`Admin Assembler Empty ${PORT}`).id;
    try {
      const res = await api(`/api/webflow/keyword-strategy/${empty}`);
      expect(res.status).toBe(200);
      expect(await res.json()).toBeNull();
    } finally {
      deleteWorkspace(empty);
    }
  });

  it('Bug 1 — strategyUx site_keyword explanations carry TABLE-sourced volume/difficulty, not undefined', async () => {
    // The blob carries stale siteKeywordMetrics (volume 1, difficulty 1) and the table
    // carries the REAL values (volume 1000, difficulty 30). The strategyUx explanation
    // for the site keyword must reference the TABLE values — proving buildKeywordStrategyUxPayload
    // receives options.siteKeywordMetrics from the table, not options.strategy?.siteKeywordMetrics
    // (which is always undefined post-strip).
    const res = await api(`/api/webflow/keyword-strategy/${fullWs}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { strategyUx?: { explanations?: Array<{ keyword: string; role: string; sourceEvidence?: string[] }> } };
    const explanations = body.strategyUx?.explanations ?? [];
    const siteKwExplanation = explanations.find(e => e.role === 'site_keyword' && e.keyword === 'admin site kw');
    expect(siteKwExplanation).toBeTruthy();
    // Volume 1,000 must appear in sourceEvidence — proves the TABLE value (1000) is used,
    // not the stale blob value (1) or undefined.
    expect(siteKwExplanation?.sourceEvidence?.some(s => s.includes('1,000'))).toBe(true);
    expect(siteKwExplanation?.sourceEvidence?.some(s => s.includes('30'))).toBe(true);
  });

  it('Bug 1 — public /api/public/seo-strategy strategyUx site_keyword explanations also carry TABLE metrics', async () => {
    const res = await api(`/api/public/seo-strategy/${fullWs}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { strategyUx?: { explanations?: Array<{ keyword: string; role: string; sourceEvidence?: string[] }> } };
    const explanations = body.strategyUx?.explanations ?? [];
    const siteKwExplanation = explanations.find(e => e.role === 'site_keyword' && e.keyword === 'admin site kw');
    expect(siteKwExplanation).toBeTruthy();
    // TABLE volume 1,000 must appear in the public route's explanation too.
    expect(siteKwExplanation?.sourceEvidence?.some(s => s.includes('1,000'))).toBe(true);
  });
});
