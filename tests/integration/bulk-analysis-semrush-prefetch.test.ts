import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createTestContext } from './helpers.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import { upsertPageKeyword } from '../../server/page-keywords.js';

const ctx = createTestContext(13324);

vi.doMock('../../server/seo-data-provider.js', async (orig) => {
  const actual = await orig<typeof import('../../server/seo-data-provider.js')>();
  return {
    ...actual,
    getConfiguredProvider: () => ({
      name: 'semrush',
      getKeywordMetrics: async (kws: string[]) =>
        kws.map(k => ({ keyword: k, volume: 1000, difficulty: 40, cpc: 2.5, competition: 0.5 })),
      getRelatedKeywords: async () => [],
    }),
  };
});

describe('prefetchSemrushForTopPages — bulk analysis enrichment', () => {
  let wsId: string;
  let cleanup: () => void;
  beforeAll(async () => {
    await ctx.startServer();
    const s = seedWorkspace();
    wsId = s.workspaceId;
    cleanup = s.cleanup;
    upsertPageKeyword(wsId, { pagePath: '/plumbing',  primaryKeyword: 'best plumber', secondaryKeywords: [] });
    upsertPageKeyword(wsId, { pagePath: '/hvac',      primaryKeyword: 'hvac service', secondaryKeywords: [] });
  });
  afterAll(async () => { cleanup(); ctx.stopServer(); vi.resetModules(); });

  it('returns a Map keyed by page path with REAL KEYWORD DATA blocks for pages with primary keywords', async () => {
    const { prefetchSemrushForTopPages } = await import('../../server/routes/jobs.js');
    const cache = await prefetchSemrushForTopPages(wsId, 10);
    expect(cache.get('/plumbing')).toContain('REAL KEYWORD DATA');
    expect(cache.get('/plumbing')).toContain('best plumber');
    expect(cache.get('/hvac')).toContain('hvac service');
  });
});
