import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace, updateWorkspace } from '../../server/workspaces.js';
import { addTrackedKeyword } from '../../server/rank-tracking.js';
import { BACKGROUND_JOB_TYPES } from '../../shared/types/background-jobs.js';
import { TRACKED_KEYWORD_SOURCE } from '../../shared/types/rank-tracking.js';

process.env.FEATURE_LOCAL_SEO_VISIBILITY = 'true';

const ctx = createTestContext(13361); // port-ok: next free after 13360
const { api, postJson } = ctx;

let workspaceId = '';
let otherWorkspaceId = '';

beforeAll(async () => {
  await ctx.startServer();
  await api('/api/admin/feature-flags/local-seo-visibility', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled: true }),
  });
  const ws = createWorkspace('Local SEO Route Test Dental');
  workspaceId = ws.id;
  otherWorkspaceId = createWorkspace('Other Local SEO Route Test Dental').id;
  updateWorkspace(workspaceId, {
    liveDomain: 'https://local-dental.example.com',
    seoDataProvider: 'dataforseo',
    businessProfile: {
      phone: '(512) 555-0123',
      address: {
        street: '123 Congress Ave',
        city: 'Austin',
        state: 'TX',
        country: 'US',
      },
    },
  });
  addTrackedKeyword(workspaceId, 'Austin Dentist', { source: TRACKED_KEYWORD_SOURCE.MANUAL });
}, 25_000);

afterAll(async () => {
  deleteWorkspace(workspaceId);
  deleteWorkspace(otherWorkspaceId);
  await api('/api/admin/feature-flags/local-seo-visibility', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled: null }),
  });
  await ctx.stopServer();
});

describe('Local SEO routes', () => {
  it('GET returns posture suggestions, suggested markets, caps, and empty snapshots safely', async () => {
    const res = await api(`/api/local-seo/${workspaceId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.featureEnabled).toBe(true);
    expect(body.settings).toEqual(expect.objectContaining({ posture: 'unknown' }));
    expect(body.settings.suggestionReasons.length).toBeGreaterThan(0);
    expect(body.suggestedMarkets).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Austin, TX', city: 'Austin', status: 'needs_review' }),
    ]));
    expect(body.caps).toEqual({ maxMarkets: 3, maxKeywordsPerRefresh: 25 });
    expect(body.latestSnapshots).toEqual([]);
    expect(body.report).toEqual(expect.objectContaining({
      workspacePosture: 'unknown',
      setupState: 'needs_market',
      checkedKeywordCount: 0,
    }));
  });

  it('PUT stores admin posture and explicit markets', async () => {
    const res = await api(`/api/local-seo/${workspaceId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        posture: 'local',
        markets: [{
          label: 'Austin, TX',
          city: 'Austin',
          stateOrRegion: 'TX',
          country: 'US',
          providerLocationCode: 1026201,
          providerLocationName: 'Austin,Texas,United States',
          status: 'active',
        }],
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.settings).toEqual(expect.objectContaining({ posture: 'local', postureSource: 'admin_override' }));
    expect(body.markets).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Austin, TX', status: 'active', providerLocationCode: 1026201 }),
    ]));
    expect(body.report).toEqual(expect.objectContaining({
      workspacePosture: 'local',
      activeMarketCount: 1,
      setupState: 'ready_no_data',
    }));
  });

  it('redacts local SEO state and rejects writes while the feature flag is disabled', async () => {
    await api('/api/admin/feature-flags/local-seo-visibility', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    });
    try {
      const read = await api(`/api/local-seo/${workspaceId}`);
      expect(read.status).toBe(200);
      const readBody = await read.json();
      expect(readBody).toEqual(expect.objectContaining({
        featureEnabled: false,
        markets: [],
        suggestedMarkets: [],
        latestSnapshots: [],
      }));
      expect(readBody.report).toEqual(expect.objectContaining({
        setupState: 'feature_disabled',
        activeMarketCount: 0,
        checkedKeywordCount: 0,
      }));

      const write = await api(`/api/local-seo/${workspaceId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ posture: 'local' }),
      });
      expect(write.status).toBe(403);
    } finally {
      await api('/api/admin/feature-flags/local-seo-visibility', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: true }),
      });
    }
  });

  it('PUT preserves existing market provider identity and status when fields are omitted', async () => {
    const current = await (await api(`/api/local-seo/${workspaceId}`)).json();
    const activeMarket = current.markets.find((market: { label: string }) => market.label === 'Austin, TX');

    const updatedActive = await api(`/api/local-seo/${workspaceId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        markets: [{
          id: activeMarket.id,
          label: 'Austin Core',
          city: 'Austin',
          stateOrRegion: 'TX',
          country: 'US',
        }],
      }),
    });
    expect(updatedActive.status).toBe(200);
    const activeBody = await updatedActive.json();
    expect(activeBody.markets).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: activeMarket.id, label: 'Austin Core', status: 'active', providerLocationCode: 1026201 }),
    ]));

    const inactiveWrite = await api(`/api/local-seo/${workspaceId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        markets: [{
          label: 'Round Rock',
          city: 'Round Rock',
          stateOrRegion: 'TX',
          country: 'US',
          providerLocationName: 'Round Rock,Texas,United States',
          status: 'inactive',
        }],
      }),
    });
    expect(inactiveWrite.status).toBe(200);
    const inactiveBody = await inactiveWrite.json();
    const inactiveMarket = inactiveBody.markets.find((market: { label: string }) => market.label === 'Round Rock');

    const updatedInactive = await api(`/api/local-seo/${workspaceId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        markets: [{
          id: inactiveMarket.id,
          label: 'Round Rock North',
          city: 'Round Rock',
          stateOrRegion: 'TX',
          country: 'US',
        }],
      }),
    });
    expect(updatedInactive.status).toBe(200);
    const updatedInactiveBody = await updatedInactive.json();
    expect(updatedInactiveBody.markets).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: inactiveMarket.id, label: 'Round Rock North', status: 'inactive', providerLocationName: 'Round Rock,Texas,United States' }),
    ]));
  });

  it('PUT clears provider identity fields when null is supplied explicitly', async () => {
    const current = await (await api(`/api/local-seo/${workspaceId}`)).json();
    const activeMarket = current.markets.find((market: { label: string }) => market.label === 'Austin Core');

    const res = await api(`/api/local-seo/${workspaceId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        markets: [{
          id: activeMarket.id,
          label: 'Austin Core',
          city: 'Austin',
          stateOrRegion: 'TX',
          country: 'US',
          providerLocationCode: null,
          providerLocationName: 'Austin,Texas,United States',
          latitude: null,
          longitude: null,
          status: 'active',
        }],
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    const updated = body.markets.find((market: { id: string }) => market.id === activeMarket.id);
    expect(updated).toEqual(expect.objectContaining({
      providerLocationName: 'Austin,Texas,United States',
      status: 'active',
    }));
    expect(updated.providerLocationCode).toBeUndefined();
    expect(updated.latitude).toBeUndefined();
    expect(updated.longitude).toBeUndefined();
  });

  it('POST refresh starts a capped background job from local-intent keywords', async () => {
    const res = await postJson(`/api/local-seo/${workspaceId}/refresh`, {
      marketIds: ['missing-market'],
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.jobId).toEqual(expect.any(String));
    expect(BACKGROUND_JOB_TYPES.LOCAL_SEO_REFRESH).toBe('local-seo-refresh');
    expect(body.selectedMarketCount).toBe(0);
    expect(body.selectedKeywordCount).toBeGreaterThan(0);
    expect(body.selectedKeywordCount).toBeLessThanOrEqual(25);
  });

  it('allows replacing a market while already at the active market cap', async () => {
    const expand = await api(`/api/local-seo/${workspaceId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        markets: [
          { label: 'Houston', city: 'Houston', country: 'US', providerLocationName: 'Houston,Texas,United States', status: 'active' },
          { label: 'Dallas', city: 'Dallas', country: 'US', providerLocationName: 'Dallas,Texas,United States', status: 'active' },
        ],
      }),
    });
    expect(expand.status).toBe(200);
    const expandedBody = await expand.json();
    const activeMarkets = expandedBody.markets.filter((market: { status: string }) => market.status === 'active');
    expect(activeMarkets).toHaveLength(3);
    const retiredMarket = activeMarkets.find((market: { label: string }) => market.label === 'Dallas');
    expect(retiredMarket).toBeTruthy();

    const replace = await api(`/api/local-seo/${workspaceId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        markets: [
          {
            id: retiredMarket.id,
            label: retiredMarket.label,
            city: retiredMarket.city,
            stateOrRegion: retiredMarket.stateOrRegion,
            country: retiredMarket.country,
            providerLocationName: retiredMarket.providerLocationName,
            status: 'inactive',
          },
          { label: 'San Antonio', city: 'San Antonio', country: 'US', providerLocationName: 'San Antonio,Texas,United States', status: 'active' },
        ],
      }),
    });
    expect(replace.status).toBe(200);
    const replacedBody = await replace.json();
    expect(replacedBody.markets).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: retiredMarket.id, status: 'inactive' }),
      expect.objectContaining({ label: 'San Antonio', status: 'active' }),
    ]));
    expect(replacedBody.markets.filter((market: { status: string }) => market.status === 'active')).toHaveLength(3);
  });

  it('rejects more than three active markets across existing and newly added markets', async () => {
    const res = await api(`/api/local-seo/${workspaceId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        markets: [
          { label: 'Houston', city: 'Houston', country: 'US', providerLocationName: 'Houston,Texas,United States', status: 'active' },
          { label: 'Dallas', city: 'Dallas', country: 'US', providerLocationName: 'Dallas,Texas,United States', status: 'active' },
          { label: 'San Antonio', city: 'San Antonio', country: 'US', providerLocationName: 'San Antonio,Texas,United States', status: 'active' },
        ],
      }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects active markets without a provider location identity', async () => {
    const res = await api(`/api/local-seo/${workspaceId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        markets: [
          { label: 'Ambiguous Austin', city: 'Austin', country: 'US', status: 'active' },
        ],
      }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects caller-supplied market ids that do not belong to the workspace', async () => {
    const otherWrite = await api(`/api/local-seo/${otherWorkspaceId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        posture: 'local',
        markets: [{ label: 'Other Austin', city: 'Austin', country: 'US', providerLocationName: 'Austin,Texas,United States', status: 'active' }],
      }),
    });
    expect(otherWrite.status).toBe(200);
    const otherBody = await otherWrite.json();
    const otherMarketId = otherBody.markets[0].id;

    const crossWorkspace = await api(`/api/local-seo/${workspaceId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        markets: [{ id: otherMarketId, label: 'Hijack', city: 'Austin', country: 'US', status: 'active' }],
      }),
    });
    expect(crossWorkspace.status).toBe(404);
  });
});
