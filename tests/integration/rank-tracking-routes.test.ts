/**
 * Integration tests for rank-tracking API endpoints.
 *
 * Tests the full HTTP request/response cycle for:
 * - GET /api/rank-tracking/:workspaceId/keywords (list tracked keywords)
 * - POST /api/rank-tracking/:workspaceId/keywords (add keyword)
 * - DELETE /api/rank-tracking/:workspaceId/keywords/:query (remove keyword)
 * - PATCH /api/rank-tracking/:workspaceId/keywords/:query/pin (toggle pin)
 * - GET /api/rank-tracking/:workspaceId/history (rank history)
 * - GET /api/rank-tracking/:workspaceId/latest (latest ranks)
 * - POST /api/rank-tracking/:workspaceId/snapshot (capture — needs GSC)
 * - GET /api/public/rank-tracking/:workspaceId/history (public)
 * - GET /api/public/rank-tracking/:workspaceId/latest (public)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';

const ctx = createTestContext(13213);
const { api, postJson, patchJson, del } = ctx;

let testWsId = '';

beforeAll(async () => {
  await ctx.startServer();
  const ws = createWorkspace('Rank Tracking Test Workspace');
  testWsId = ws.id;
}, 25_000);

afterAll(() => {
  deleteWorkspace(testWsId);
  ctx.stopServer();
});

describe('Rank Tracking — keywords CRUD', () => {
  it('GET /api/rank-tracking/:workspaceId/keywords returns array', async () => {
    const res = await api(`/api/rank-tracking/${testWsId}/keywords`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it('POST without query returns 400', async () => {
    const res = await postJson(`/api/rank-tracking/${testWsId}/keywords`, {});
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('query required');
  });

  it('POST adds a tracked keyword', async () => {
    const res = await postJson(`/api/rank-tracking/${testWsId}/keywords`, {
      query: 'seo audit tool',
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    // addTrackedKeyword returns the full keywords array
    const added = Array.isArray(body)
      ? body.find((k: { query: string }) => k.query === 'seo audit tool')
      : body;
    expect(added).toBeDefined();
    expect(added.query).toBe('seo audit tool');
  });

  it('GET keywords now includes the added keyword', async () => {
    const res = await api(`/api/rank-tracking/${testWsId}/keywords`);
    expect(res.status).toBe(200);
    const body = await res.json();
    const kw = body.find((k: { query: string }) => k.query === 'seo audit tool');
    expect(kw).toBeDefined();
  });

  it('PATCH toggles pin on keyword', async () => {
    const res = await patchJson(
      `/api/rank-tracking/${testWsId}/keywords/${encodeURIComponent('seo audit tool')}/pin`,
      {},
    );
    expect(res.status).toBe(200);
  });

  it('DELETE removes the keyword', async () => {
    const res = await del(
      `/api/rank-tracking/${testWsId}/keywords/${encodeURIComponent('seo audit tool')}`,
    );
    expect(res.status).toBe(200);
  });
});

describe('Rank Tracking — history and latest', () => {
  it('GET /api/rank-tracking/:workspaceId/history returns array', async () => {
    const res = await api(`/api/rank-tracking/${testWsId}/history`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it('GET /api/rank-tracking/:workspaceId/latest returns array', async () => {
    const res = await api(`/api/rank-tracking/${testWsId}/latest`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });
});

describe('Rank Tracking — snapshot capture', () => {
  it('POST /api/rank-tracking/:workspaceId/snapshot without GSC returns 400', async () => {
    const res = await postJson(`/api/rank-tracking/${testWsId}/snapshot`, {});
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('No GSC property linked');
  });
});

describe('Rank Tracking — public endpoints', () => {
  it('GET /api/public/rank-tracking/:workspaceId/history returns array', async () => {
    const res = await api(`/api/public/rank-tracking/${testWsId}/history`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it('GET /api/public/rank-tracking/:workspaceId/latest returns array', async () => {
    const res = await api(`/api/public/rank-tracking/${testWsId}/latest`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });
});
