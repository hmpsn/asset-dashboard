import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import { upsertInsight } from '../../server/analytics-insights-store.js';

const PORT = 13341;
const STALE_DATE = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString();

const ctx = createTestContext(PORT);

describe('content freshness detection', () => {
  let seed: ReturnType<typeof seedWorkspace>;

  beforeAll(async () => {
    await ctx.startServer();
    seed = seedWorkspace({ tier: 'growth', clientPassword: '' });
    upsertInsight({
      workspaceId: seed.workspaceId,
      pageId: '/stale-page',
      insightType: 'freshness_alert',
      severity: 'warning',
      data: {
        pagePath: '/stale-page',
        lastAnalyzedAt: STALE_DATE,
        daysSinceLastAnalysis: 100,
        impressions: 500,
        clicks: 30,
      },
    });
  }, 30_000);

  afterAll(async () => {
    seed?.cleanup();
    await ctx.stopServer();
  });

  it('GET /api/public/insights/:workspaceId returns array (freshness schema accepted)', async () => {
    const res = await ctx.api(`/api/public/insights/${seed.workspaceId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toEqual(expect.arrayContaining([
      expect.objectContaining({
        insightType: 'freshness_alert',
        data: expect.objectContaining({
          pagePath: '/stale-page',
          daysSinceLastAnalysis: 100,
        }),
      }),
    ]));
  });
});
