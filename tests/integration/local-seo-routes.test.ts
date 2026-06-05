import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace, updateWorkspace } from '../../server/workspaces.js';
import { addTrackedKeyword } from '../../server/rank-tracking.js';
import { BACKGROUND_JOB_TYPES } from '../../shared/types/background-jobs.js';
import { TRACKED_KEYWORD_SOURCE } from '../../shared/types/rank-tracking.js';
import db from '../../server/db/index.js';

const ctx = createTestContext(13361); // port-ok: next free after 13360
const { api, postJson } = ctx;

let workspaceId = '';
let otherWorkspaceId = '';

beforeAll(async () => {
  await ctx.startServer();
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
      expect.objectContaining({
        label: 'Austin, TX',
        city: 'Austin',
        status: 'needs_review',
        providerLocationName: 'Austin,Texas,United States',
      }),
    ]));
    expect(body.caps).toEqual({
      maxMarkets: 3,
      maxKeywordsPerRefresh: 100,
      keywordsPerRefreshMin: 25,
      keywordsPerRefreshMax: 300,
      keywordsPerRefreshDefault: 100,
    });
    expect(body.latestSnapshots).toEqual([]);
    expect(body.competitorBrands).toEqual(expect.any(Array));
    expect(body.serviceGaps).toEqual(expect.any(Array));
    expect(body.report).toEqual(expect.objectContaining({
      workspacePosture: 'unknown',
      setupState: 'needs_market',
      checkedKeywordCount: 0,
    }));
  });

  it('GET can return summary-only local SEO data without snapshot payloads', async () => {
    const res = await api(`/api/local-seo/${workspaceId}?includeSnapshots=false`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.featureEnabled).toBe(true);
    expect(body.report).toEqual(expect.objectContaining({
      activeMarketCount: expect.any(Number),
      checkedKeywordCount: expect.any(Number),
    }));
    expect(body.latestSnapshots).toEqual([]);
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

  it('GET location lookup validates admin-entered market fields', async () => {
    const res = await api(`/api/local-seo/${workspaceId}/location-lookup?city=Austin&stateOrRegion=TX&country=US`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(expect.objectContaining({
      query: expect.objectContaining({ city: 'Austin', stateOrRegion: 'TX', country: 'US' }),
      candidates: expect.any(Array),
    }));
    expect(['matched', 'ambiguous', 'not_found', 'provider_unavailable', 'provider_failed']).toContain(body.status);
  });

  it('keeps local SEO reads and writes available without a feature-flag precondition', async () => {
    const read = await api(`/api/local-seo/${workspaceId}`);
    expect(read.status).toBe(200);
    const readBody = await read.json();
    expect(readBody.featureEnabled).toBe(true);

    const write = await api(`/api/local-seo/${workspaceId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ posture: 'local' }),
    });
    expect(write.status).toBe(200);
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
    expect(body.selectedKeywordCount).toBeLessThanOrEqual(50);
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

describe('competitorBrands aggregation', () => {
  let brandWsId = '';
  const marketId = randomUUID();

  beforeAll(async () => {
    const insertSnapshot = db.prepare(`
      INSERT INTO local_visibility_snapshots (
        id, workspace_id, keyword, normalized_keyword, market_id, market_label,
        captured_at, local_pack_present, business_found, business_match_confidence,
        local_rank, top_competitors, source_endpoint, provider, device, language_code, status
      ) VALUES (
        @id, @workspace_id, @keyword, @normalized_keyword, @market_id, @market_label,
        @captured_at, @local_pack_present, @business_found, @business_match_confidence,
        @local_rank, @top_competitors, @source_endpoint, @provider, @device, @language_code, @status
      )
    `);
    const insertMarket = db.prepare(`
      INSERT INTO local_seo_markets (id, workspace_id, label, city, country, source, status, created_at, updated_at)
      VALUES (@id, @workspace_id, @label, @city, @country, @source, @status, @created_at, @updated_at)
    `);
    const ws = createWorkspace('Competitor Brands Test Dental');
    brandWsId = ws.id;
    const now = new Date().toISOString();
    insertMarket.run({
      id: marketId,
      workspace_id: brandWsId,
      label: 'Austin, TX',
      city: 'Austin',
      country: 'US',
      source: 'admin_override',
      status: 'active',
      created_at: now,
      updated_at: now,
    });
    const rivals = JSON.stringify([{ title: 'Test Rival', domain: 'testrival.com' }]);
    const loneRival = JSON.stringify([{ title: 'Lone Rival', domain: 'lonerival.com' }]);
    const degradedRival = JSON.stringify([{ title: 'Test Rival', domain: 'testrival.com' }]);

    // Snapshot 1: client NOT found (business_found=0) → winsAgainstClient++
    insertSnapshot.run({
      id: randomUUID(), workspace_id: brandWsId, keyword: 'dentist austin', normalized_keyword: 'dentist austin',
      market_id: marketId, market_label: 'Austin, TX', captured_at: now,
      local_pack_present: 1, business_found: 0, business_match_confidence: 'not_found',
      local_rank: null, top_competitors: rivals,
      source_endpoint: 'google_local_pack', provider: 'dataforseo', device: 'desktop', language_code: 'en',
      status: 'success',
    });
    // Snapshot 2: client found (business_found=1) → totalAppearances++ only
    insertSnapshot.run({
      id: randomUUID(), workspace_id: brandWsId, keyword: 'emergency dentist', normalized_keyword: 'emergency dentist',
      market_id: marketId, market_label: 'Austin, TX', captured_at: now,
      local_pack_present: 1, business_found: 1, business_match_confidence: 'verified',
      local_rank: 1, top_competitors: rivals,
      source_endpoint: 'google_local_pack', provider: 'dataforseo', device: 'desktop', language_code: 'en',
      status: 'success',
    });
    // Snapshot 3: 'Lone Rival' appears only once — should NOT meet the >= 2 threshold
    insertSnapshot.run({
      id: randomUUID(), workspace_id: brandWsId, keyword: 'teeth whitening', normalized_keyword: 'teeth whitening',
      market_id: marketId, market_label: 'Austin, TX', captured_at: now,
      local_pack_present: 1, business_found: 0, business_match_confidence: 'not_found',
      local_rank: null, top_competitors: loneRival,
      source_endpoint: 'google_local_pack', provider: 'dataforseo', device: 'desktop', language_code: 'en',
      status: 'success',
    });
    // Snapshot 4: degraded status with client NOT found and 'Test Rival' present —
    // Fix 1 ensures this does NOT increment winsAgainstClient because status != 'success'
    insertSnapshot.run({
      id: randomUUID(), workspace_id: brandWsId, keyword: 'dental implants', normalized_keyword: 'dental implants',
      market_id: marketId, market_label: 'Austin, TX', captured_at: now,
      local_pack_present: 0, business_found: 0, business_match_confidence: 'not_found',
      local_rank: null, top_competitors: degradedRival,
      source_endpoint: 'google_local_pack', provider: 'dataforseo', device: 'desktop', language_code: 'en',
      status: 'degraded',
    });
  });

  afterAll(() => {
    deleteWorkspace(brandWsId);
  });

  it('returns Test Rival with totalAppearances=2 and winsAgainstClient=1 (success snapshots only)', async () => {
    const res = await api(`/api/local-seo/${brandWsId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    const rival = body.competitorBrands.find((b: { title: string }) => b.title === 'Test Rival');
    expect(rival).toBeDefined();
    expect(rival.totalAppearances).toBe(2);
    // Only one snapshot had business_found=0 and status='success' — the degraded one must NOT count
    expect(rival.winsAgainstClient).toBe(1);
  });

  it('excludes competitors that appear only once (below the >= 2 threshold)', async () => {
    const res = await api(`/api/local-seo/${brandWsId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    const lone = body.competitorBrands.find((b: { title: string }) => b.title === 'Lone Rival');
    expect(lone).toBeUndefined();
  });

  it('does not count winsAgainstClient from degraded snapshots (Fix 1 validation)', async () => {
    const res = await api(`/api/local-seo/${brandWsId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    const rival = body.competitorBrands.find((b: { title: string }) => b.title === 'Test Rival');
    // If degraded snapshot were counted, winsAgainstClient would be 2 (both business_found=0 rows)
    expect(rival?.winsAgainstClient).toBe(1);
  });
});
