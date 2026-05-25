import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestContext } from './helpers.js';
import { seedWorkspace, type SeededFullWorkspace } from '../fixtures/workspace-seed.js';
import type { LocalSeoReadResponse } from '../../shared/types/local-seo.js';

process.env.FEATURE_LOCAL_SEO_VISIBILITY = 'true';

const ctx = createTestContext(13363); // port-ok: next free after 13362
const { api } = ctx;

let seeded: SeededFullWorkspace;
let workspaceId = '';
let market1Id = '';
let market2Id = '';

async function readLocalSeo(): Promise<LocalSeoReadResponse> {
  const res = await api(`/api/local-seo/${workspaceId}`);
  expect(res.status).toBe(200);
  return await res.json() as LocalSeoReadResponse;
}

describe('Local SEO primary market', () => {
  beforeAll(async () => {
    await ctx.startServer();
    await api('/api/admin/feature-flags/local-seo-visibility', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    });
    seeded = seedWorkspace({ seoDataProvider: 'dataforseo' });
    workspaceId = seeded.workspaceId;

    const res = await api(`/api/local-seo/${workspaceId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        markets: [
          {
            label: 'Austin Downtown',
            city: 'Austin',
            stateOrRegion: 'TX',
            country: 'US',
            providerLocationCode: 1022162,
            status: 'active',
          },
          {
            label: 'Round Rock',
            city: 'Round Rock',
            stateOrRegion: 'TX',
            country: 'US',
            providerLocationCode: 1027603,
            status: 'active',
          },
        ],
      }),
    });
    expect(res.status).toBe(200);
    const data = await res.json() as LocalSeoReadResponse;
    market1Id = data.markets[0]?.id ?? '';
    market2Id = data.markets[1]?.id ?? '';
    expect(market1Id).not.toBe('');
    expect(market2Id).not.toBe('');
  }, 25_000);

  afterAll(async () => {
    seeded.cleanup();
    await api('/api/admin/feature-flags/local-seo-visibility', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: null }),
    });
    await ctx.stopServer();
  });

  it('PUT /set-primary returns 200 and market becomes primary', async () => {
    const res = await api(`/api/local-seo/${workspaceId}/markets/${market1Id}/set-primary`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });

    const localSeo = await readLocalSeo();
    const m1 = localSeo.markets.find(market => market.id === market1Id);
    const m2 = localSeo.markets.find(market => market.id === market2Id);
    expect(m1?.isPrimary).toBe(true);
    expect(m2?.isPrimary).toBe(false);
  });

  it('switching primary clears the previous primary', async () => {
    const res = await api(`/api/local-seo/${workspaceId}/markets/${market2Id}/set-primary`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);

    const localSeo = await readLocalSeo();
    const m1 = localSeo.markets.find(market => market.id === market1Id);
    const m2 = localSeo.markets.find(market => market.id === market2Id);
    expect(m1?.isPrimary).toBe(false);
    expect(m2?.isPrimary).toBe(true);
  });

  it('rejects inactive or code-less primary markets without clearing the current primary', async () => {
    const createInactive = await api(`/api/local-seo/${workspaceId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        markets: [{
          label: 'Inactive Market',
          city: 'Georgetown',
          stateOrRegion: 'TX',
          country: 'US',
          status: 'inactive',
        }],
      }),
    });
    expect(createInactive.status).toBe(200);
    const localSeo = await createInactive.json() as LocalSeoReadResponse;
    const inactive = localSeo.markets.find(market => market.label === 'Inactive Market');
    expect(inactive?.id).toBeTruthy();

    const res = await api(`/api/local-seo/${workspaceId}/markets/${inactive!.id}/set-primary`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);

    const after = await readLocalSeo();
    expect(after.markets.find(market => market.id === market2Id)?.isPrimary).toBe(true);
  });

  it('clears primary status when a primary market becomes inactive', async () => {
    const res = await api(`/api/local-seo/${workspaceId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        markets: [{
          id: market2Id,
          label: 'Round Rock',
          city: 'Round Rock',
          stateOrRegion: 'TX',
          country: 'US',
          providerLocationCode: 1027603,
          status: 'inactive',
        }],
      }),
    });
    expect(res.status).toBe(200);

    const localSeo = await readLocalSeo();
    expect(localSeo.markets.find(market => market.id === market2Id)?.isPrimary).toBe(false);
  });

  it('PUT /set-primary returns 403 while Local SEO visibility is disabled', async () => {
    await api('/api/admin/feature-flags/local-seo-visibility', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    });
    try {
      const res = await api(`/api/local-seo/${workspaceId}/markets/${market1Id}/set-primary`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(403);
    } finally {
      await api('/api/admin/feature-flags/local-seo-visibility', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: true }),
      });
    }
  });

  it('PUT /set-primary with unknown marketId returns 404', async () => {
    const res = await api(`/api/local-seo/${workspaceId}/markets/does-not-exist/set-primary`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(404);
  });
});
