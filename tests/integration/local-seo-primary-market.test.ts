import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEphemeralTestContext } from './helpers.js';
import { seedWorkspace, type SeededFullWorkspace } from '../fixtures/workspace-seed.js';
import type { LocalSeoReadResponse } from '../../shared/types/local-seo.js';

const ctx = createEphemeralTestContext(import.meta.url);
const { api } = ctx;

let seeded: SeededFullWorkspace;
let workspaceId = '';
let market1Id = '';
let market2Id = '';
let market3Id = '';

async function readLocalSeo(): Promise<LocalSeoReadResponse> {
  const res = await api(`/api/local-seo/${workspaceId}`);
  expect(res.status).toBe(200);
  return await res.json() as LocalSeoReadResponse;
}

describe('Local SEO primary market', () => {
  beforeAll(async () => {
    await ctx.startServer();
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

  it('PUT /set-primary remains available without a feature-flag precondition', async () => {
    const res = await api(`/api/local-seo/${workspaceId}/markets/${market1Id}/set-primary`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
  });

  it('PUT /set-primary with unknown marketId returns 404', async () => {
    const res = await api(`/api/local-seo/${workspaceId}/markets/does-not-exist/set-primary`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(404);
  });

  // ─── W2 review fix #7: orphaned-primary auto-promotion ───────────────────────
  // Deactivating the PRIMARY market must not silently leave zero active primaries
  // when another eligible active market exists — a successor is auto-promoted.

  it('deactivating the primary auto-promotes another active market to primary', async () => {
    // Reset to a known state: both markets active, market1 primary.
    const reset = await api(`/api/local-seo/${workspaceId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        markets: [
          { id: market1Id, label: 'Austin Downtown', city: 'Austin', stateOrRegion: 'TX', country: 'US', providerLocationCode: 1022162, status: 'active' },
          { id: market2Id, label: 'Round Rock', city: 'Round Rock', stateOrRegion: 'TX', country: 'US', providerLocationCode: 1027603, status: 'active' },
        ],
      }),
    });
    expect(reset.status).toBe(200);
    const setPrimary = await api(`/api/local-seo/${workspaceId}/markets/${market1Id}/set-primary`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
    });
    expect(setPrimary.status).toBe(200);
    expect((await readLocalSeo()).markets.find(m => m.id === market1Id)?.isPrimary).toBe(true);

    // Deactivate the PRIMARY market (market1) — market2 stays active and eligible.
    const res = await api(`/api/local-seo/${workspaceId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        markets: [
          { id: market1Id, label: 'Austin Downtown', city: 'Austin', stateOrRegion: 'TX', country: 'US', providerLocationCode: 1022162, status: 'inactive' },
        ],
      }),
    });
    expect(res.status).toBe(200);

    const after = await readLocalSeo();
    const m1 = after.markets.find(m => m.id === market1Id);
    const m2 = after.markets.find(m => m.id === market2Id);
    // The deactivated primary is no longer primary; the surviving active market took over.
    expect(m1?.isPrimary).toBe(false);
    expect(m2?.isPrimary).toBe(true);
    // Exactly one active primary remains.
    expect(after.markets.filter(m => m.isPrimary).length).toBe(1);
  });

  it('auto-promotes the alphabetically first eligible market when multiple successors exist', async () => {
    const reset = await api(`/api/local-seo/${workspaceId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        markets: [
          { id: market1Id, label: 'Austin Downtown', city: 'Austin', stateOrRegion: 'TX', country: 'US', providerLocationCode: 1022162, status: 'active' },
          { id: market2Id, label: 'Round Rock', city: 'Round Rock', stateOrRegion: 'TX', country: 'US', providerLocationCode: 1027603, status: 'active' },
          { label: 'bee cave', city: 'Bee Cave', stateOrRegion: 'TX', country: 'US', providerLocationCode: 1026201, status: 'active' },
        ],
      }),
    });
    expect(reset.status).toBe(200);
    const seededMarkets = await reset.json() as LocalSeoReadResponse;
    const beeCaveId = seededMarkets.markets.find(market => market.label === 'bee cave')?.id;
    expect(beeCaveId).toBeTruthy();
    market3Id = beeCaveId!;

    const setPrimary = await api(`/api/local-seo/${workspaceId}/markets/${market1Id}/set-primary`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(setPrimary.status).toBe(200);

    const deactivatePrimary = await api(`/api/local-seo/${workspaceId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        markets: [
          { id: market1Id, label: 'Austin Downtown', city: 'Austin', stateOrRegion: 'TX', country: 'US', providerLocationCode: 1022162, status: 'inactive' },
        ],
      }),
    });
    expect(deactivatePrimary.status).toBe(200);

    const after = await readLocalSeo();
    expect(after.markets.find(market => market.id === market1Id)?.isPrimary).toBe(false);
    expect(after.markets.find(market => market.id === beeCaveId)?.isPrimary).toBe(true);
    expect(after.markets.find(market => market.id === market2Id)?.isPrimary).toBe(false);
  });

  it('deactivating ALL markets leaves zero primaries (no successor to promote)', async () => {
    // Reactivate both first.
    const reactivate = await api(`/api/local-seo/${workspaceId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        markets: [
          { id: market1Id, label: 'Austin Downtown', city: 'Austin', stateOrRegion: 'TX', country: 'US', providerLocationCode: 1022162, status: 'active' },
          { id: market2Id, label: 'Round Rock', city: 'Round Rock', stateOrRegion: 'TX', country: 'US', providerLocationCode: 1027603, status: 'active' },
          ...(market3Id ? [{ id: market3Id, label: 'bee cave', city: 'Bee Cave', stateOrRegion: 'TX', country: 'US', providerLocationCode: 1026201, status: 'active' }] : []),
        ],
      }),
    });
    expect(reactivate.status).toBe(200);

    // Deactivate BOTH markets.
    const res = await api(`/api/local-seo/${workspaceId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        markets: [
          { id: market1Id, label: 'Austin Downtown', city: 'Austin', stateOrRegion: 'TX', country: 'US', providerLocationCode: 1022162, status: 'inactive' },
          { id: market2Id, label: 'Round Rock', city: 'Round Rock', stateOrRegion: 'TX', country: 'US', providerLocationCode: 1027603, status: 'inactive' },
          ...(market3Id ? [{ id: market3Id, label: 'bee cave', city: 'Bee Cave', stateOrRegion: 'TX', country: 'US', providerLocationCode: 1026201, status: 'inactive' }] : []),
        ],
      }),
    });
    expect(res.status).toBe(200);

    const after = await readLocalSeo();
    // No active market exists, so no promotion — zero primaries is the correct outcome.
    expect(after.markets.filter(m => m.isPrimary).length).toBe(0);
  });
});
