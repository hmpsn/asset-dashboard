/**
 * Integration tests for provider-neutral SEO routes.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';

const ctx = createTestContext(13244);
const { api, postJson, del } = ctx;

let testWsId = '';

beforeAll(async () => {
  await ctx.startServer();
  const ws = createWorkspace('SEO Provider Test Workspace');
  testWsId = ws.id;
}, 30_000);

afterAll(async () => {
  deleteWorkspace(testWsId);
  await ctx.stopServer();
});

describe('SEO provider HTTP routes', () => {
  describe('GET /api/seo/status', () => {
    it('returns 200 with a configured boolean', async () => {
      const res = await api('/api/seo/status');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty('configured');
      expect(typeof body.configured).toBe('boolean');
    });
  });

  describe('POST /api/seo/estimate', () => {
    it('returns DataForSEO-backed call estimates for quick mode', async () => {
      const res = await postJson('/api/seo/estimate', { mode: 'quick', keywordCount: 10 });
      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({ provider: 'dataforseo', estimatedCalls: 1 });
    });

    it('returns DataForSEO-backed call estimates for full mode', async () => {
      const res = await postJson('/api/seo/estimate', { mode: 'full', competitorCount: 2, keywordCount: 20 });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.provider).toBe('dataforseo');
      expect(body.estimatedCalls).toBeGreaterThan(0);
    });
  });

  describe('DELETE /api/seo/cache/:workspaceId', () => {
    it('returns 200 ok: true', async () => {
      const res = await del(`/api/seo/cache/${testWsId}`);
      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({ ok: true });
    });
  });

  describe('GET /api/seo/clear-cache/:workspaceId', () => {
    it('returns 200 with ok: true and a message', async () => {
      const res = await api(`/api/seo/clear-cache/${testWsId}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(typeof body.message).toBe('string');
    });
  });

  describe('GET /api/seo/diagnose/:workspaceId', () => {
    it('returns 200 with diagnostic fields for a known workspace', async () => {
      const res = await api(`/api/seo/diagnose/${testWsId}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty('configured');
      expect(body).toHaveProperty('rawLiveDomain');
      expect(body).toHaveProperty('resolvedDomain');
      expect(body).toHaveProperty('cacheFileCount');
      expect(body).toHaveProperty('allCacheKeys');
      expect(Array.isArray(body.allCacheKeys)).toBe(true);
      expect(body.note).toContain('ZERO external SEO provider calls');
    });

    it('returns 404 for an unknown workspace', async () => {
      const res = await api('/api/seo/diagnose/does-not-exist');
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body).toHaveProperty('error');
    });
  });

  describe('POST /api/seo/competitors/:workspaceId', () => {
    it('saves a list of competitor domains', async () => {
      const res = await postJson(`/api/seo/competitors/${testWsId}`, {
        domains: ['competitor1.com', 'competitor2.com'],
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.competitors).toContain('competitor1.com');
      expect(body.competitors).toContain('competitor2.com');
    });

    it('returns 400 when domains is not an array', async () => {
      const res = await postJson(`/api/seo/competitors/${testWsId}`, { domains: 'not-an-array' });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body).toHaveProperty('error');
    });
  });

  describe('GET /api/seo/competitive-intel/:workspaceId', () => {
    it('returns 400 when competitors query param is missing', async () => {
      const res = await api(`/api/seo/competitive-intel/${testWsId}`);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('competitors');
    });

    it('returns 404 for unknown workspace', async () => {
      const res = await api('/api/seo/competitive-intel/no-such-ws?competitors=rival.com');
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body).toHaveProperty('error');
    });
  });

  describe('GET /api/seo/discover-competitors/:workspaceId', () => {
    it('returns 404 for unknown workspace', async () => {
      const res = await api('/api/seo/discover-competitors/no-such-ws');
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body).toHaveProperty('error');
    });
  });

  describe('GET /api/seo/providers/status', () => {
    it('returns 200 with providers array', async () => {
      const res = await api('/api/seo/providers/status');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body.providers)).toBe(true);
    });
  });
});
