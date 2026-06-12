/**
 * Integration tests for content-requests and content-performance read paths.
 * Covers GET endpoints and PATCH not-found validation.
 *
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createEphemeralTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';

const ctx = createEphemeralTestContext(import.meta.url);
const { api, patchJson } = ctx;

let wsId = '';

beforeAll(async () => {
  await ctx.startServer();
  wsId = createWorkspace('Content Requests Read Routes WS 13649').id;
}, 25_000);

afterAll(async () => {
  deleteWorkspace(wsId);
  await ctx.stopServer();
});

describe('Content Requests — list endpoint', () => {
  it('GET /api/content-requests/:workspaceId returns 200 with empty array for a fresh workspace', async () => {
    const res = await api(`/api/content-requests/${wsId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(0);
  });

  it('GET /api/content-requests/:workspaceId with unknown workspaceId returns 200 with empty array (no workspace existence check)', async () => {
    // requireWorkspaceAccess passes through when no JWT user present (APP_PASSWORD auth).
    // listContentRequests on a nonexistent workspace simply returns an empty array.
    const res = await api('/api/content-requests/ws_nonexistent_cr_99999');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });
});

describe('Content Requests — get single endpoint', () => {
  it('GET /api/content-requests/:workspaceId/:id with unknown id returns 404', async () => {
    const res = await api(`/api/content-requests/${wsId}/req_nonexistent_cr_99999`);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('Request not found');
  });

  it('GET /api/content-requests/:workspaceId/:id with unknown workspaceId returns 404', async () => {
    const res = await api('/api/content-requests/ws_nonexistent_cr_99999/req_some_id');
    expect(res.status).toBe(404);
  });
});

describe('Content Requests — PATCH not-found validation', () => {
  it('PATCH /api/content-requests/:workspaceId/:id with unknown id returns 404', async () => {
    const res = await patchJson(`/api/content-requests/${wsId}/req_nonexistent_cr_99999`, {
      status: 'in_progress',
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('Request not found');
  });

  it('PATCH /api/content-requests/:workspaceId/:id with unknown workspaceId returns 404', async () => {
    const res = await patchJson('/api/content-requests/ws_nonexistent_cr_99999/req_some_id', {
      status: 'in_progress',
    });
    expect(res.status).toBe(404);
  });
});

describe('Content Performance — list endpoint', () => {
  it('GET /api/content-performance/:workspaceId returns 200 with items array for a fresh workspace', async () => {
    const res = await api(`/api/content-performance/${wsId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('items');
    expect(Array.isArray(body.items)).toBe(true);
  });

  it('GET /api/content-performance/:workspaceId with unknown workspaceId returns 404', async () => {
    const res = await api('/api/content-performance/ws_nonexistent_cr_99999');
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('Workspace not found');
  });
});
