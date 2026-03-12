/**
 * Integration tests for miscellaneous API endpoints.
 *
 * Tests endpoints not covered by other integration test files:
 * - GET /api/roadmap
 * - GET /api/jobs
 * - GET /api/settings
 * - GET /api/metadata
 * - GET /api/presence
 * - GET /api/queue
 * - GET /api/requests
 * - GET /api/google/status
 * - GET /api/semrush/status
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';

const ctx = createTestContext(13209);
const { api, postJson, del } = ctx;

let testWsId = '';

beforeAll(async () => {
  await ctx.startServer();
  const ws = createWorkspace('Misc Test Workspace');
  testWsId = ws.id;
}, 25_000);

afterAll(() => {
  deleteWorkspace(testWsId);
  ctx.stopServer();
});

describe('Miscellaneous read-only endpoints', () => {
  it('GET /api/roadmap returns 200', async () => {
    const res = await api('/api/roadmap');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toBeDefined();
  });

  it('GET /api/jobs returns 200', async () => {
    const res = await api('/api/jobs');
    expect(res.status).toBe(200);
  });

  it('GET /api/settings returns 200', async () => {
    const res = await api('/api/settings');
    expect(res.status).toBe(200);
  });

  it('GET /api/metadata returns 200', async () => {
    const res = await api('/api/metadata');
    expect(res.status).toBe(200);
  });

  it('GET /api/presence returns 200 with object', async () => {
    const res = await api('/api/presence');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body).toBe('object');
  });

  it('GET /api/queue returns 200', async () => {
    const res = await api('/api/queue');
    expect(res.status).toBe(200);
  });

  it('GET /api/google/status returns 200', async () => {
    const res = await api('/api/google/status');
    expect(res.status).toBe(200);
  });

  it('GET /api/semrush/status returns 200', async () => {
    const res = await api('/api/semrush/status');
    expect(res.status).toBe(200);
  });
});

describe('Requests CRUD via API', () => {
  let requestId = '';

  it('GET /api/requests returns 200 with array', async () => {
    const res = await api('/api/requests');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it('POST /api/requests creates a request', async () => {
    const res = await postJson('/api/requests', {
      workspaceId: testWsId,
      title: 'Integration test request',
      description: 'Created by integration test',
      category: 'seo',
      priority: 'medium',
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('id');
    expect(body.title).toBe('Integration test request');
    expect(body.workspaceId).toBe(testWsId);
    requestId = body.id;
  });

  it('POST /api/requests without required fields returns 400', async () => {
    const res = await postJson('/api/requests', {});
    expect(res.status).toBe(400);
  });

  it('GET /api/requests/:id returns the created request', async () => {
    const res = await api(`/api/requests/${requestId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(requestId);
    expect(body.title).toBe('Integration test request');
  });

  it('GET /api/requests?workspaceId= filters by workspace', async () => {
    const res = await api(`/api/requests?workspaceId=${testWsId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.length).toBeGreaterThanOrEqual(1);
    for (const req of body) {
      expect(req.workspaceId).toBe(testWsId);
    }
  });

  it('DELETE /api/requests/:id removes the request', async () => {
    const res = await del(`/api/requests/${requestId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it('GET /api/requests/:id after delete returns 404', async () => {
    const res = await api(`/api/requests/${requestId}`);
    expect(res.status).toBe(404);
  });
});
