/**
 * Integration tests for local-seo read endpoints.
 *
 * Tests the full HTTP request/response cycle for:
 * - GET /api/local-seo/:workspaceId — read model
 * - GET /api/local-seo/:workspaceId/locations — client locations list
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';

const ctx = createTestContext(13666);
const { api } = ctx;

let wsId = '';

beforeAll(async () => {
  await ctx.startServer();
  wsId = createWorkspace('Local SEO Read WS 13666').id;
}, 25_000);

afterAll(async () => {
  deleteWorkspace(wsId);
  await ctx.stopServer();
});

describe('GET /api/local-seo/:workspaceId', () => {
  it('returns 200 with a read model object for a fresh workspace', async () => {
    const res = await api(`/api/local-seo/${wsId}`);
    expect(res.status).toBe(200);
    const body = await res.json();

    // Core read-model shape
    expect(body).toHaveProperty('featureEnabled');
    expect(body.featureEnabled).toBe(true);
    expect(body).toHaveProperty('settings');
    expect(body).toHaveProperty('markets');
    expect(Array.isArray(body.markets)).toBe(true);
    expect(body).toHaveProperty('report');
  });

  it('returns 404 for an unknown workspaceId', async () => {
    const res = await api('/api/local-seo/nonexistent-workspace-id');
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });
});

describe('GET /api/local-seo/:workspaceId/locations', () => {
  it('returns 200 with a locations array for an existing workspace', async () => {
    const res = await api(`/api/local-seo/${wsId}/locations`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('locations');
    expect(Array.isArray(body.locations)).toBe(true);
  });

  it('returns 404 for unknown workspaceId', async () => {
    const res = await api('/api/local-seo/nonexistent-workspace-id/locations');
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });
});
