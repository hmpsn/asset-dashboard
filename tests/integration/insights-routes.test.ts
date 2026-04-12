/**
 * Integration tests for GET /api/public/insights/:workspaceId
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { upsertInsight } from '../../server/analytics-insights-store.js';

const ctx = createTestContext(13242);
const { api } = ctx;

let testWsId = '';

beforeAll(async () => {
  await ctx.startServer();
  const ws = createWorkspace('Insights Test Workspace');
  testWsId = ws.id;
}, 25_000);

afterAll(() => {
  deleteWorkspace(testWsId);
  ctx.stopServer();
});

describe('GET /api/public/insights/:workspaceId', () => {
  it('returns empty array when no insights exist', async () => {
    const ws = createWorkspace('Empty Insights WS');
    const res = await api(`/api/public/insights/${ws.id}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([]);
    deleteWorkspace(ws.id);
  });

  it('returns insights for workspace', async () => {
    upsertInsight({
      workspaceId: testWsId,
      pageId: '/blog/seo-tips',
      insightType: 'ranking_opportunity',
      data: { query: 'seo tips', currentPosition: 8, estimatedTrafficGain: 120 },
      severity: 'opportunity',
    });
    upsertInsight({
      workspaceId: testWsId,
      pageId: '/services',
      insightType: 'page_health',
      data: { score: 85, trend: 'improving' },
      severity: 'positive',
    });

    const res = await api(`/api/public/insights/${testWsId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThanOrEqual(2);
    expect(body[0]).toHaveProperty('id');
    expect(body[0]).toHaveProperty('insightType');
    expect(body[0]).toHaveProperty('severity');
    expect(body[0]).toHaveProperty('data');
    expect(body[0]).toHaveProperty('computedAt');
  });

  it('can filter by insightType query param', async () => {
    const res = await api(`/api/public/insights/${testWsId}?type=ranking_opportunity`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
    expect(body.length > 0 && body.every((i: { insightType: string }) => i.insightType === 'ranking_opportunity')).toBe(true);
  });

  it('returns 404 for unknown workspace', async () => {
    const res = await api('/api/public/insights/ws_nobody_xyz');
    expect(res.status).toBe(404);
  });
});
