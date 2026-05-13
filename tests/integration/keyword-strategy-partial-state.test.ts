/**
 * Regression test — GET /api/webflow/keyword-strategy/:wsId must surface
 * page_keywords rows even when the workspace has no top-level strategy blob.
 *
 * Bug (pre-fix): the endpoint short-circuited with `res.json(null)` whenever
 * `ws.keywordStrategy` was missing, even if `page_keywords` had analyzed rows
 * from per-page SEO Editor "Analyze" runs. Consequence: after running page
 * analysis from the SEO Editor, Page Intelligence would show empty state
 * despite having real stored data.
 *
 * Port: 13320
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace, getWorkspace, updateWorkspace } from '../../server/workspaces.js';
import db from '../../server/db/index.js';
import { upsertPageKeyword } from '../../server/page-keywords.js';
import { listQuickWins, replaceAllQuickWins } from '../../server/quick-wins.js';
import { listKeywordGaps, replaceAllKeywordGaps } from '../../server/keyword-gaps.js';
import { listTopicClusters, replaceAllTopicClusters } from '../../server/topic-clusters.js';
import { listCannibalizationIssues, replaceAllCannibalizationIssues } from '../../server/cannibalization-issues.js';
import { persistKeywordStrategy } from '../../server/keyword-strategy-persistence.js';
import type { PageKeywordMap } from '../../shared/types/workspace.js';

const PORT = 13320;
const ctx = createTestContext(PORT);

let partialWsId = '';   // has page_keywords, no ws.keywordStrategy
let emptyWsId = '';     // no page_keywords, no ws.keywordStrategy

beforeAll(async () => {
  await ctx.startServer();

  partialWsId = createWorkspace('Partial Strategy (page_keywords only)').id;
  emptyWsId = createWorkspace('Empty Strategy').id;

  const pageEntries: PageKeywordMap[] = [
    {
      pagePath: '/services/seo',
      pageTitle: 'SEO Services',
      primaryKeyword: 'seo services',
      secondaryKeywords: ['seo agency', 'search optimization'],
      analysisGeneratedAt: new Date().toISOString(),
      optimizationScore: 72,
    },
    {
      pagePath: '/about',
      pageTitle: 'About',
      primaryKeyword: 'about us',
      secondaryKeywords: [],
      analysisGeneratedAt: new Date().toISOString(),
      optimizationScore: 60,
    },
  ];
  for (const entry of pageEntries) {
    upsertPageKeyword(partialWsId, entry);
  }
}, 30_000);

afterAll(async () => {
  if (partialWsId) deleteWorkspace(partialWsId);
  if (emptyWsId) deleteWorkspace(emptyWsId);
  await ctx.stopServer();
});

describe('GET /api/webflow/keyword-strategy/:wsId — partial state coverage', () => {
  it('returns pageMap when page_keywords has rows but ws.keywordStrategy is absent', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/webflow/keyword-strategy/${partialWsId}`);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body).not.toBeNull();
    expect(Array.isArray(body.pageMap)).toBe(true);
    expect(body.pageMap).toHaveLength(2);

    const paths = body.pageMap.map((p: { pagePath: string }) => p.pagePath).sort();
    expect(paths).toEqual(['/about', '/services/seo']);

    const seoEntry = body.pageMap.find((p: { pagePath: string }) => p.pagePath === '/services/seo');
    expect(seoEntry.primaryKeyword).toBe('seo services');
    expect(seoEntry.analysisGeneratedAt).toBeTruthy();
  });

  it('returns null when neither ws.keywordStrategy nor page_keywords has data', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/webflow/keyword-strategy/${emptyWsId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toBeNull();
  });

  it('synthesized shell has generatedAt: null so client can distinguish from real strategy', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/webflow/keyword-strategy/${partialWsId}`);
    const body = await res.json();
    expect(body.generatedAt).toBeNull();
    expect(body.siteKeywords).toEqual([]);
    expect(body.opportunities).toEqual([]);
  });
});

describe('PATCH /api/webflow/keyword-strategy/:wsId — shell promotion guard', () => {
  // Each test owns its own workspace so state mutations do not leak between tests
  // or back into the GET describe block above (which asserts generatedAt: null).
  const createdPatchWsIds: string[] = [];

  function freshShellWorkspace(label: string): string {
    const wsId = createWorkspace(label).id;
    createdPatchWsIds.push(wsId);
    upsertPageKeyword(wsId, {
      pagePath: '/services/seo',
      pageTitle: 'SEO Services',
      primaryKeyword: 'seo services',
      secondaryKeywords: ['seo agency'],
      analysisGeneratedAt: new Date().toISOString(),
      optimizationScore: 70,
    });
    return wsId;
  }

  afterAll(() => {
    for (const id of createdPatchWsIds) deleteWorkspace(id);
  });

  it('pure-pageMap PATCH on shell-state workspace does NOT create a strategy blob', async () => {
    const wsId = freshShellWorkspace('PATCH pure-pageMap shell');
    const patchRes = await fetch(`http://localhost:${PORT}/api/webflow/keyword-strategy/${wsId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pageMap: [
          {
            pagePath: '/services/seo',
            pageTitle: 'SEO Services',
            primaryKeyword: 'seo services',
            secondaryKeywords: ['seo agency'],
          },
        ],
      }),
    });
    expect(patchRes.status).toBe(200);
    const body = await patchRes.json();
    expect(body.generatedAt).toBeNull();
    expect(body.siteKeywords).toEqual([]);

    const ws = getWorkspace(wsId);
    expect(ws?.keywordStrategy).toBeFalsy();
  });

  it('pure quickWins PATCH updates table-backed rows without creating a strategy blob', async () => {
    const wsId = freshShellWorkspace('PATCH quickWins shell');
    const patchRes = await fetch(`http://localhost:${PORT}/api/webflow/keyword-strategy/${wsId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        quickWins: [
          { pagePath: '/services/seo', action: 'Improve title tag', estimatedImpact: 'high', rationale: 'Boost CTR' },
        ],
      }),
    });
    expect(patchRes.status).toBe(200);
    const body = await patchRes.json();
    expect(body.generatedAt).toBeNull();

    const ws = getWorkspace(wsId);
    expect(ws?.keywordStrategy).toBeFalsy();

    const wins = listQuickWins(wsId);
    expect(wins).toHaveLength(1);
    expect(wins[0].action).toBe('Improve title tag');
  });

  it('pure keywordGaps PATCH updates table-backed rows without creating a strategy blob', async () => {
    const wsId = freshShellWorkspace('PATCH keywordGaps shell');
    const patchRes = await fetch(`http://localhost:${PORT}/api/webflow/keyword-strategy/${wsId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        keywordGaps: [
          {
            keyword: 'seo audit tool',
            volume: 2400,
            difficulty: 48,
            competitorPosition: 3,
            competitorDomain: 'competitor.com',
          },
        ],
      }),
    });
    expect(patchRes.status).toBe(200);
    const body = await patchRes.json();
    expect(body.generatedAt).toBeNull();

    const ws = getWorkspace(wsId);
    expect(ws?.keywordStrategy).toBeFalsy();

    const gaps = listKeywordGaps(wsId);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].keyword).toBe('seo audit tool');
  });

  it('pure topicClusters PATCH updates table-backed rows without creating a strategy blob', async () => {
    const wsId = freshShellWorkspace('PATCH topicClusters shell');
    const patchRes = await fetch(`http://localhost:${PORT}/api/webflow/keyword-strategy/${wsId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        topicClusters: [
          {
            topic: 'seo services',
            keywords: ['seo services', 'enterprise seo'],
            ownedCount: 1,
            totalCount: 4,
            coveragePercent: 25,
            avgPosition: 10,
            topCompetitor: 'competitor.com',
            topCompetitorCoverage: 75,
            gap: ['technical seo', 'local seo'],
          },
        ],
      }),
    });
    expect(patchRes.status).toBe(200);
    const body = await patchRes.json();
    expect(body.generatedAt).toBeNull();
    expect(Array.isArray(body.topicClusters)).toBe(true);
    expect(body.topicClusters).toHaveLength(1);
    expect(body.topicClusters[0].topic).toBe('seo services');

    const ws = getWorkspace(wsId);
    expect(ws?.keywordStrategy).toBeFalsy();

    const clusters = listTopicClusters(wsId);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].topic).toBe('seo services');
  });

  it('pure cannibalization PATCH updates table-backed rows without creating a strategy blob', async () => {
    const wsId = freshShellWorkspace('PATCH cannibalization shell');
    const patchRes = await fetch(`http://localhost:${PORT}/api/webflow/keyword-strategy/${wsId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cannibalization: [
          {
            keyword: 'seo services',
            pages: [
              { path: '/services', position: 6, source: 'keyword_map' },
              { path: '/seo-services', position: 9, source: 'gsc' },
            ],
            severity: 'high',
            recommendation: 'Consolidate overlapping pages.',
            canonicalPath: '/services',
            canonicalUrl: 'https://example.com/services',
            action: 'canonical_tag',
          },
        ],
      }),
    });
    expect(patchRes.status).toBe(200);
    const body = await patchRes.json();
    expect(body.generatedAt).toBeNull();
    expect(Array.isArray(body.cannibalization)).toBe(true);
    expect(body.cannibalization).toHaveLength(1);
    expect(body.cannibalization[0].keyword).toBe('seo services');

    const ws = getWorkspace(wsId);
    expect(ws?.keywordStrategy).toBeFalsy();

    const issues = listCannibalizationIssues(wsId);
    expect(issues).toHaveLength(1);
    expect(issues[0].keyword).toBe('seo services');
    expect(issues[0].severity).toBe('high');
    expect(issues[0].canonicalPath).toBe('/services');
    expect(issues[0].canonicalUrl).toBe('https://example.com/services');
    expect(issues[0].action).toBe('canonical_tag');
  });

  it('rejects invalid quickWins payload and preserves existing table rows', async () => {
    const wsId = freshShellWorkspace('PATCH invalid quickWins payload');
    replaceAllQuickWins(wsId, [
      { pagePath: '/services/seo', action: 'Keep me', estimatedImpact: 'medium', rationale: 'baseline' },
    ]);

    const patchRes = await fetch(`http://localhost:${PORT}/api/webflow/keyword-strategy/${wsId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        quickWins: [42],
      }),
    });
    expect(patchRes.status).toBe(400);

    const wins = listQuickWins(wsId);
    expect(wins).toHaveLength(1);
    expect(wins[0].action).toBe('Keep me');
  });

  it('rejects invalid keywordGaps payload and preserves existing table rows', async () => {
    const wsId = freshShellWorkspace('PATCH invalid keywordGaps payload');
    replaceAllKeywordGaps(wsId, [
      {
        keyword: 'keep keyword',
        volume: 999,
        difficulty: 22,
        competitorPosition: 4,
        competitorDomain: 'example.com',
      },
    ]);

    const patchRes = await fetch(`http://localhost:${PORT}/api/webflow/keyword-strategy/${wsId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        keywordGaps: [42],
      }),
    });
    expect(patchRes.status).toBe(400);

    const gaps = listKeywordGaps(wsId);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].keyword).toBe('keep keyword');
  });

  it('rejects invalid topicClusters payload and preserves existing table rows', async () => {
    const wsId = freshShellWorkspace('PATCH invalid topicClusters payload');
    replaceAllTopicClusters(wsId, [
      {
        topic: 'keep cluster',
        keywords: ['keep keyword'],
        ownedCount: 1,
        totalCount: 3,
        coveragePercent: 33,
        gap: ['missing keyword'],
      },
    ]);

    const patchRes = await fetch(`http://localhost:${PORT}/api/webflow/keyword-strategy/${wsId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        topicClusters: [42],
      }),
    });
    expect(patchRes.status).toBe(400);

    const clusters = listTopicClusters(wsId);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].topic).toBe('keep cluster');
  });

  it('rejects invalid cannibalization payload and preserves existing table rows', async () => {
    const wsId = freshShellWorkspace('PATCH invalid cannibalization payload');
    replaceAllCannibalizationIssues(wsId, [
      {
        keyword: 'keep keyword',
        pages: [{ path: '/services', source: 'keyword_map' }],
        severity: 'medium',
        recommendation: 'Keep current canonical target.',
      },
    ]);

    const patchRes = await fetch(`http://localhost:${PORT}/api/webflow/keyword-strategy/${wsId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cannibalization: [42],
      }),
    });
    expect(patchRes.status).toBe(400);

    const issues = listCannibalizationIssues(wsId);
    expect(issues).toHaveLength(1);
    expect(issues[0].keyword).toBe('keep keyword');
  });

  it('PATCH with non-pageMap fields DOES create/update the strategy blob', async () => {
    const wsId = freshShellWorkspace('PATCH siteKeywords promote');
    const patchRes = await fetch(`http://localhost:${PORT}/api/webflow/keyword-strategy/${wsId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        siteKeywords: ['primary keyword', 'secondary keyword'],
      }),
    });
    expect(patchRes.status).toBe(200);
    const body = await patchRes.json();
    expect(body.generatedAt).toBeTruthy();
    expect(body.siteKeywords).toEqual(['primary keyword', 'secondary keyword']);

    const ws = getWorkspace(wsId);
    expect(ws?.keywordStrategy).toBeTruthy();
    expect((ws!.keywordStrategy as { siteKeywords: string[] }).siteKeywords).toEqual([
      'primary keyword',
      'secondary keyword',
    ]);
  });

  it('pure-pageMap PATCH on workspace with existing blob PRESERVES original generatedAt', async () => {
    // Seed the workspace with a real blob via a non-pageMap PATCH first.
    const wsId = freshShellWorkspace('PATCH timestamp preservation');
    const seedRes = await fetch(`http://localhost:${PORT}/api/webflow/keyword-strategy/${wsId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ siteKeywords: ['original'] }),
    });
    const seeded = await seedRes.json();
    const originalGeneratedAt = seeded.generatedAt as string;
    expect(originalGeneratedAt).toBeTruthy();

    // Wait a beat so any timestamp bump would be observable.
    await new Promise(r => setTimeout(r, 10));

    // Pure-pageMap patch — must preserve the original timestamp.
    const patchRes = await fetch(`http://localhost:${PORT}/api/webflow/keyword-strategy/${wsId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pageMap: [
          { pagePath: '/services/seo', pageTitle: 'SEO Services', primaryKeyword: 'seo services', secondaryKeywords: [] },
        ],
      }),
    });
    const body = await patchRes.json();
    expect(body.generatedAt).toBe(originalGeneratedAt);

    // Non-pageMap patch — SHOULD bump the timestamp.
    await new Promise(r => setTimeout(r, 10));
    const bumpRes = await fetch(`http://localhost:${PORT}/api/webflow/keyword-strategy/${wsId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ siteKeywords: ['updated'] }),
    });
    const bumped = await bumpRes.json();
    expect(bumped.generatedAt).not.toBe(originalGeneratedAt);
  });

  it('strategy persistence rolls back normalized table writes when a later table write fails', () => {
    const wsId = freshShellWorkspace('Persist atomic rollback');
    updateWorkspace(wsId, {
      keywordStrategy: {
        siteKeywords: ['baseline'],
        opportunities: ['baseline opportunity'],
        generatedAt: '2026-01-01T00:00:00.000Z',
      },
    });
    replaceAllQuickWins(wsId, [
      { pagePath: '/baseline', action: 'Keep baseline', estimatedImpact: 'medium', rationale: 'Existing data' },
    ]);

    db.exec(`
      DROP TRIGGER IF EXISTS strategy_atomic_cannibalization_abort;
      CREATE TEMP TRIGGER strategy_atomic_cannibalization_abort
      BEFORE INSERT ON cannibalization_issues
      WHEN NEW.keyword = 'explode'
      BEGIN
        SELECT RAISE(ABORT, 'forced cannibalization failure');
      END;
    `);

    try {
      const ws = getWorkspace(wsId);
      expect(ws).toBeTruthy();
      expect(() => persistKeywordStrategy({
        ws: ws!,
        strategy: {
          siteKeywords: ['new strategy'],
          opportunities: ['new opportunity'],
          pageMap: [
            {
              pagePath: '/services/seo',
              pageTitle: 'SEO Services',
              primaryKeyword: 'seo services',
              secondaryKeywords: ['seo agency'],
            },
          ],
          quickWins: [
            { pagePath: '/services/seo', action: 'New quick win', estimatedImpact: 'high', rationale: 'Should roll back' },
          ],
        },
        strategyMode: 'full',
        pagesToAnalyze: [{
          path: '/services/seo',
          title: 'SEO Services',
          seoTitle: 'SEO Services',
          seoDesc: 'SEO service page',
          contentSnippet: 'SEO service content',
        }],
        siteKeywordMetrics: [],
        keywordGaps: [],
        competitorKeywordData: [],
        topicClusters: [
          {
            topic: 'seo services',
            keywords: ['seo services'],
            ownedCount: 1,
            totalCount: 1,
            coveragePercent: 100,
            gap: [],
          },
        ],
        cannibalization: [
          {
            keyword: 'explode',
            pages: [{ path: '/services/seo', source: 'keyword_map' }],
            severity: 'high',
            recommendation: 'This insert is forced to fail.',
          },
        ],
        questionKeywords: [],
        businessContext: '',
        seoDataMode: 'quick',
        seoDataStatus: { mode: 'quick', provider: 'dataforseo', status: 'degraded', reasons: ['test_failure'] },
        searchData: {
          deviceBreakdown: [],
          countryBreakdown: [],
          periodComparison: null,
          organicLandingPages: [],
          organicOverview: null,
        },
      })).toThrow(/forced cannibalization failure/);
    } finally {
      db.exec('DROP TRIGGER IF EXISTS strategy_atomic_cannibalization_abort;');
    }

    expect(listQuickWins(wsId)).toEqual([
      expect.objectContaining({ pagePath: '/baseline', action: 'Keep baseline' }),
    ]);
    expect(listTopicClusters(wsId)).toEqual([]);
    expect(listCannibalizationIssues(wsId)).toEqual([]);
    expect(getWorkspace(wsId)?.keywordStrategy?.siteKeywords).toEqual(['baseline']);
  });
});
