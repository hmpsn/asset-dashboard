/**
 * Integration tests for SEMRush / SEO-provider status endpoints.
 *
 * Tests the full HTTP request/response cycle for:
 * - GET /api/seo/status      — no auth / no workspace required
 * - GET /api/seo/providers/status — no auth / no workspace required
 * - GET /api/seo/diagnose/:workspaceId — diagnostic (zero provider API calls)
 *
 * Deliberately excluded: /api/seo/competitive-intel and
 * /api/seo/discover-competitors — they make real external API calls.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';

const ctx = createTestContext(13664);
const { api } = ctx;

let wsId = '';

beforeAll(async () => {
  await ctx.startServer();
  wsId = createWorkspace('Semrush Status WS 13664').id;
}, 25_000);

afterAll(async () => {
  deleteWorkspace(wsId);
  await ctx.stopServer();
});

describe('GET /api/seo/status', () => {
  it('returns 200 with a configured boolean field', async () => {
    const res = await api('/api/seo/status');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('configured');
    expect(typeof body.configured).toBe('boolean');
  });
});

describe('GET /api/seo/providers/status', () => {
  it('returns 200 with a providers object', async () => {
    const res = await api('/api/seo/providers/status');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('providers');
    // providers should be an object (map of provider names to their status)
    expect(typeof body.providers).toBe('object');
    expect(body.providers).not.toBeNull();
  });
});

describe('GET /api/seo/diagnose/:workspaceId', () => {
  it('returns 200 with diagnostic object for valid workspace', async () => {
    const res = await api(`/api/seo/diagnose/${wsId}`);
    expect(res.status).toBe(200);
    const body = await res.json();

    // Must have all expected diagnostic fields
    expect(body).toHaveProperty('configured');
    expect(body).toHaveProperty('rawLiveDomain');
    expect(body).toHaveProperty('resolvedDomain');
    expect(body).toHaveProperty('wwwStripped');
    expect(body).toHaveProperty('competitors');
    expect(body).toHaveProperty('cacheDir');
    expect(body).toHaveProperty('cacheFileCount');
    expect(body).toHaveProperty('allCacheKeys');
    expect(body).toHaveProperty('cachedData');
    expect(body).toHaveProperty('note');

    // Fresh workspace has no competitors
    expect(Array.isArray(body.competitors)).toBe(true);

    // The note confirms no external SEO provider calls are made
    expect(body.note).toContain('ZERO external SEO provider calls');
  });

  it('returns 404 for an unknown workspaceId', async () => {
    const res = await api('/api/seo/diagnose/nonexistent-workspace-id');
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });
});
