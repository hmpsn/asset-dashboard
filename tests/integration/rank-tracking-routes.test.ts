/**
 * Integration tests for rank-tracking API endpoints.
 *
 * Tests the full HTTP request/response cycle for:
 * - GET /api/rank-tracking/:workspaceId/keywords (list tracked keywords)
 * - POST /api/rank-tracking/:workspaceId/keywords (add keyword)
 * - PATCH /api/rank-tracking/:workspaceId/keywords/:query/pin (toggle pin)
 * - GET /api/rank-tracking/:workspaceId/history (rank history)
 * - GET /api/rank-tracking/:workspaceId/latest (latest ranks)
 * - POST /api/rank-tracking/:workspaceId/snapshot (capture — needs GSC)
 * - GET /api/public/rank-tracking/:workspaceId/history (public)
 * - GET /api/public/rank-tracking/:workspaceId/latest (public)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace, updateWorkspace } from '../../server/workspaces.js';
import { keywordComparisonKey } from '../../shared/keyword-normalization.js';

const ctx = createTestContext(13213, { autoPublicAuth: true });
const { api, postJson, patchJson } = ctx;

let testWsId = '';

beforeAll(async () => {
  await ctx.startServer();
  const ws = createWorkspace('Rank Tracking Test Workspace');
  testWsId = ws.id;
  // Public rank-tracking endpoints now use requireAuthenticatedClientPortalAuth
  // (see sprint-platform-health-wave8-audit-drift-closure Plan A Task 1).
  // Seed a portal password and authenticate so the test client gets a session
  // cookie. Without this the public GETs return 401 even on a fresh workspace.
  updateWorkspace(testWsId, { clientPassword: 'test-password' });
  const authRes = await postJson(`/api/public/auth/${testWsId}`, { password: 'test-password' });
  expect(authRes.status).toBe(200);
}, 25_000);

afterAll(async () => {
  deleteWorkspace(testWsId);
  await ctx.stopServer();
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

  it('POST dedupes canonical keyword variants', async () => {
    const first = await postJson(`/api/rank-tracking/${testWsId}/keywords`, {
      query: 'Emergency Dentist - Near-Me',
    });
    expect(first.status).toBe(200);

    const second = await postJson(`/api/rank-tracking/${testWsId}/keywords`, {
      query: ' emergency dentist near me ',
    });
    expect(second.status).toBe(200);
    const body = await second.json();
    const matches = body.filter((k: { query: string }) => keywordComparisonKey(k.query) === 'emergency dentist near me');
    expect(matches).toHaveLength(1);
    expect(matches[0].query).toBe('Emergency Dentist - Near-Me');
  });
});

describe('Rank Tracking — history and latest', () => {
  it('GET /api/rank-tracking/:workspaceId/history returns array', async () => {
    const res = await api(`/api/rank-tracking/${testWsId}/history`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it('GET /api/rank-tracking/:workspaceId/history rejects non-positive limit', async () => {
    const res = await api(`/api/rank-tracking/${testWsId}/history?limit=0`);
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'limit must be a positive integer' });
  });

  it('GET /api/rank-tracking/:workspaceId/history rejects non-integer limit', async () => {
    const res = await api(`/api/rank-tracking/${testWsId}/history?limit=1.5`);
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'limit must be a positive integer' });
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

  it('GET /api/public/rank-tracking/:workspaceId/history rejects non-positive limit', async () => {
    const res = await api(`/api/public/rank-tracking/${testWsId}/history?limit=0`);
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'limit must be a positive integer' });
  });

  it('GET /api/public/rank-tracking/:workspaceId/history rejects non-integer limit', async () => {
    const res = await api(`/api/public/rank-tracking/${testWsId}/history?limit=2.5`);
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'limit must be a positive integer' });
  });

  it('GET /api/public/rank-tracking/:workspaceId/latest returns array', async () => {
    const res = await api(`/api/public/rank-tracking/${testWsId}/latest`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });
});
