/**
 * Integration tests for work-orders API endpoints.
 *
 * Tests the full HTTP request/response cycle for:
 * - GET /api/work-orders/:workspaceId (list)
 * - PATCH /api/work-orders/:workspaceId/:orderId (update)
 * - GET /api/public/work-orders/:workspaceId (public list)
 * - GET /api/public/fix-orders/:workspaceId (public fix orders)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';

const ctx = createTestContext(13219);
const { api, patchJson } = ctx;

let testWsId = '';

beforeAll(async () => {
  await ctx.startServer();
  const ws = createWorkspace('Work Orders Test Workspace');
  testWsId = ws.id;
}, 25_000);

afterAll(() => {
  deleteWorkspace(testWsId);
  ctx.stopServer();
});

describe('Work Orders — list', () => {
  it('GET /api/work-orders/:workspaceId returns array', async () => {
    const res = await api(`/api/work-orders/${testWsId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });
});

describe('Work Orders — update', () => {
  it('PATCH /api/work-orders/:workspaceId/:orderId with bad id returns 404', async () => {
    const res = await patchJson(`/api/work-orders/${testWsId}/order_nonexistent`, {
      status: 'in_progress',
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('Work order not found');
  });
});

describe('Work Orders — public endpoints', () => {
  it('GET /api/public/work-orders/:workspaceId returns array', async () => {
    const res = await api(`/api/public/work-orders/${testWsId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it('GET /api/public/fix-orders/:workspaceId returns array', async () => {
    const res = await api(`/api/public/fix-orders/${testWsId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });
});
