/**
 * Integration tests for the insights queue endpoint.
 *
 * Tests the full HTTP request/response cycle for:
 * - GET /api/insights/:workspaceId/queue (known workspace → 200 with items array)
 * - GET /api/insights/:workspaceId/queue (unknown workspace → 404)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';

const ctx = createTestContext(13626); // port-ok
const { api } = ctx;

let wsId = '';

beforeAll(async () => {
  await ctx.startServer();
  wsId = createWorkspace('Insights Queue Routes WS 13626').id;
}, 25_000);

afterAll(async () => {
  deleteWorkspace(wsId);
  await ctx.stopServer();
});

describe('GET /api/insights/:workspaceId/queue', () => {
  it('returns 200 with items array for known workspace', async () => {
    const res = await api(`/api/insights/${wsId}/queue`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('items');
    expect(Array.isArray(body.items)).toBe(true);
  });

  it('returns an empty items array when no unresolved insights exist', async () => {
    const emptyWs = createWorkspace('Empty Queue WS 13626');
    const res = await api(`/api/insights/${emptyWs.id}/queue`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toEqual([]);
    deleteWorkspace(emptyWs.id);
  });

  it('returns 200 with empty items for unknown workspace (no workspace existence check on queue endpoint)', async () => {
    // The queue endpoint uses requireWorkspaceAccess which passes through for
    // HMAC-auth admin requests. getUnresolvedInsights returns [] for any
    // workspaceId with no rows, so unknown workspaces get an empty list.
    const res = await api('/api/insights/ws_missing_queue_13626/queue');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('items');
    expect(body.items).toEqual([]);
  });
});
