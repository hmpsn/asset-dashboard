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
import { createWorkspace, deleteWorkspace, getWorkspace } from '../../server/workspaces.js';
import { upsertPageKeyword } from '../../server/page-keywords.js';
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

afterAll(() => {
  if (partialWsId) deleteWorkspace(partialWsId);
  if (emptyWsId) deleteWorkspace(emptyWsId);
  ctx.stopServer();
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
});
