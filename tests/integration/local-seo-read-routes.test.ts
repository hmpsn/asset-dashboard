/**
 * Integration tests for local-seo read endpoints.
 *
 * Tests the full HTTP request/response cycle for:
 * - GET /api/local-seo/:workspaceId — read model (feature can be enabled or disabled)
 * - GET /api/local-seo/:workspaceId/locations — client locations list
 *
 * NOTE: The `local-seo-visibility` feature flag defaults to false in test
 * environments. As a result:
 *   - GET /api/local-seo/:workspaceId still returns 200 with featureEnabled:false
 *     (the read model is always available — just gated at the data level).
 *   - GET /api/local-seo/:workspaceId/locations returns 403 because the feature
 *     flag check runs first and the route enforces it is enabled.
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

    // Core read-model shape — always present regardless of feature flag state
    expect(body).toHaveProperty('featureEnabled');
    expect(typeof body.featureEnabled).toBe('boolean');
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
  it('returns 200 or 403 depending on feature flag state', async () => {
    const res = await api(`/api/local-seo/${wsId}/locations`);
    // When local-seo-visibility flag is disabled (default), the endpoint returns 403.
    // When it is enabled (e.g. via env override in CI), it returns 200 with a locations array.
    expect([200, 403]).toContain(res.status);

    const body = await res.json();
    if (res.status === 200) {
      expect(body).toHaveProperty('locations');
      expect(Array.isArray(body.locations)).toBe(true);
    } else {
      expect(body).toHaveProperty('error');
    }
  });

  it('returns 404 for unknown workspaceId when feature is enabled, or 403 when disabled', async () => {
    const res = await api('/api/local-seo/nonexistent-workspace-id/locations');
    // Feature disabled → 403 (flag check runs first inside ensureLocalSeoLocationsAvailable)
    // Feature enabled → 404 (workspace not found)
    expect([403, 404]).toContain(res.status);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });
});
