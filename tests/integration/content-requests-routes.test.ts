/**
 * Integration tests for content-requests API endpoints.
 *
 * Tests the full HTTP request/response cycle for:
 * - GET /api/content-requests/:workspaceId (list)
 * - GET /api/content-requests/:workspaceId/:id (get single)
 * - PATCH /api/content-requests/:workspaceId/:id (update)
 * - DELETE /api/content-requests/:workspaceId/:id (delete)
 * - GET /api/content-performance/:workspaceId (content performance)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';

const ctx = createTestContext(13218);
const { api, patchJson, del } = ctx;

let testWsId = '';

beforeAll(async () => {
  await ctx.startServer();
  const ws = createWorkspace('Content Requests Test Workspace');
  testWsId = ws.id;
}, 25_000);

afterAll(() => {
  deleteWorkspace(testWsId);
  ctx.stopServer();
});

describe('Content Requests — list', () => {
  it('GET /api/content-requests/:workspaceId returns array', async () => {
    const res = await api(`/api/content-requests/${testWsId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });
});

describe('Content Requests — get single', () => {
  it('GET /api/content-requests/:workspaceId/:id with bad id returns 404', async () => {
    const res = await api(`/api/content-requests/${testWsId}/req_nonexistent`);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('Request not found');
  });
});

describe('Content Requests — update', () => {
  it('PATCH /api/content-requests/:workspaceId/:id with bad id returns 404', async () => {
    const res = await patchJson(`/api/content-requests/${testWsId}/req_nonexistent`, {
      status: 'in_progress',
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('Request not found');
  });
});

describe('Content Requests — delete', () => {
  it('DELETE /api/content-requests/:workspaceId/:id with bad id returns 404', async () => {
    const res = await del(`/api/content-requests/${testWsId}/req_nonexistent`);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('Request not found');
  });
});

describe('Content Performance', () => {
  it('GET /api/content-performance/:workspaceId returns items', async () => {
    const res = await api(`/api/content-performance/${testWsId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('items');
    expect(Array.isArray(body.items)).toBe(true);
  });

  it('GET /api/content-performance/:workspaceId with bad id returns 404', async () => {
    const res = await api('/api/content-performance/ws_nonexistent_999');
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('Workspace not found');
  });
});
