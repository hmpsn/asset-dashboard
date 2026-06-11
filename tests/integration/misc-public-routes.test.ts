/**
 * Integration tests for misc public GET endpoints.
 *
 * Tests:
 * - GET /api/public/page-states/:workspaceId — 200 with object for known workspace
 * - GET /api/public/page-states/:workspaceId — 404 for unknown workspace
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';

const ctx = createTestContext(13674, { autoPublicAuth: true });
const { api } = ctx;
let wsId = '';

beforeAll(async () => {
  await ctx.startServer();
  wsId = createWorkspace('Misc Public Routes WS 13674').id;
}, 25_000);

afterAll(async () => {
  deleteWorkspace(wsId);
  await ctx.stopServer();
});

describe('Misc — page states (public)', () => {
  it('GET /api/public/page-states/:workspaceId returns 200 with object for known workspace', async () => {
    const res = await api(`/api/public/page-states/${wsId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    // getAllPageStates returns a Record<string, PageEditState> — an object
    expect(typeof body).toBe('object');
    expect(body).not.toBeNull();
    expect(Array.isArray(body)).toBe(false);
  });

  it('GET /api/public/page-states/:workspaceId returns empty object for fresh workspace', async () => {
    const res = await api(`/api/public/page-states/${wsId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    // No page states have been created, so the object should have no keys
    expect(Object.keys(body).length).toBe(0);
  });

  it('GET /api/public/page-states/:workspaceId returns 404 for unknown workspace', async () => {
    const res = await api('/api/public/page-states/ws_does_not_exist_9999');
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });
});
