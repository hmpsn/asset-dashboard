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
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
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
});
