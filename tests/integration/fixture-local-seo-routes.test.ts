import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestContext } from './helpers.js';
import { seedWorkspace, type SeededFullWorkspace } from '../fixtures/workspace-seed.js';
import { seedAuthData, type SeededAuth } from '../fixtures/auth-seed.js';
import { updateWorkspace } from '../../server/workspaces.js';
import { addTrackedKeyword } from '../../server/rank-tracking.js';
import { TRACKED_KEYWORD_SOURCE } from '../../shared/types/rank-tracking.js';
import type { LocalSeoReadResponse } from '../../shared/types/local-seo.js';

const ctx = createTestContext(13711);
const { api } = ctx;

let seeded: SeededFullWorkspace | null = null;
let workspaceId = '';
let foreignAuth: SeededAuth | null = null;

describe('Fixture-based local SEO routes', () => {
  beforeAll(async () => {
    await ctx.startServer();

    seeded = seedWorkspace({ seoDataProvider: 'dataforseo' });
    workspaceId = seeded.workspaceId;

    updateWorkspace(workspaceId, {
      liveDomain: 'https://fixture-local.example.com',
      businessProfile: {
        phone: '(512) 555-0100',
        address: {
          street: '100 Congress Ave',
          city: 'Austin',
          state: 'TX',
          country: 'US',
        },
      },
      intelligenceProfile: {
        industry: 'Dental Practice',
      },
    });

    addTrackedKeyword(workspaceId, 'teeth whitening near me', {
      source: TRACKED_KEYWORD_SOURCE.MANUAL,
    });
    addTrackedKeyword(workspaceId, 'dental implants austin', {
      source: TRACKED_KEYWORD_SOURCE.MANUAL,
    });

    foreignAuth = await seedAuthData();
  }, 25_000);

  afterAll(async () => {
    if (seeded) seeded.cleanup();
    foreignAuth?.cleanup();

    await ctx.stopServer();
  });

  it('GET /api/local-seo/:workspaceId returns seeded local-SEO read model with stable fixture-driven fields', async () => {
    const res = await api(`/api/local-seo/${workspaceId}`);
    expect(res.status).toBe(200);

    const body = await res.json() as LocalSeoReadResponse;
    expect(body.featureEnabled).toBe(true);
    expect(body).toEqual(expect.objectContaining({
      settings: expect.any(Object),
      markets: expect.any(Array),
      suggestedMarkets: expect.any(Array),
      report: expect.any(Object),
      serviceGaps: expect.any(Array),
    }));

    expect(body.suggestedMarkets).toEqual(expect.arrayContaining([
      expect.objectContaining({
        label: 'Austin, TX',
        city: 'Austin',
        stateOrRegion: 'TX',
        country: 'US',
        source: 'business_profile',
        status: 'needs_review',
        providerLocationName: 'Austin,Texas,United States',
      }),
    ]));

    expect(body.settings).toEqual(expect.objectContaining({
      suggestedPosture: 'local',
    }));
    expect(body.settings.suggestionReasons).toEqual(expect.arrayContaining([
      'Business profile has city/state contact evidence',
      'Industry commonly depends on local intent',
    ]));

    expect(body.report).toEqual(expect.objectContaining({
      setupState: 'needs_market',
      activeMarketCount: 0,
      configuredMarketCount: 0,
      suggestedMarketCount: 1,
      latestSnapshotCount: 0,
      checkedKeywordCount: 0,
    }));

    const gapIds = body.serviceGaps.map(gap => gap.serviceId);
    expect(body.serviceGaps).toHaveLength(10);
    expect(gapIds).not.toContain('teeth-whitening');
    expect(gapIds).not.toContain('dental-implants');
  });

  it('rejects JWT users that are authenticated but scoped to a different workspace', async () => {
    const headers = { Authorization: `Bearer ${foreignAuth!.adminToken}` };
    const read = await api(`/api/local-seo/${workspaceId}`, { headers });
    expect(read.status).toBe(403);

    const write = await api(`/api/local-seo/${workspaceId}`, {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ posture: 'local' }),
    });
    expect(write.status).toBe(403);
  });

  it('returns 404 for a workspace id that does not exist', async () => {
    const res = await api('/api/local-seo/does-not-exist-workspace-id');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Workspace not found' });
  });

  it('rejects malformed local-SEO update payloads with strict validation', async () => {
    const res = await api(`/api/local-seo/${workspaceId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        posture: 'local',
        unexpectedField: true,
      }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects malformed location-lookup query values', async () => {
    const res = await api(`/api/local-seo/${workspaceId}/location-lookup?city=Austin&country=U&extra=1`);
    expect(res.status).toBe(400);
  });

  it('accepts sparse location payloads and preserves empty clearable fields', async () => {
    const create = await api(`/api/local-seo/${workspaceId}/locations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Sparse Office',
        domain: '',
        phone: '',
        streetAddress: '',
        city: '',
        stateOrRegion: '',
        country: '',
        gbpPlaceId: '',
      }),
    });
    expect(create.status).toBe(201);

    const createdBody = await create.json() as {
      location: { id: string; name: string; domain?: string; phone?: string; country?: string; gbpPlaceId?: string };
      jobId: string;
    };
    expect(createdBody.location.name).toBe('Sparse Office');
    expect(createdBody.location.domain).toBeUndefined();
    expect(createdBody.location.phone).toBeUndefined();
    expect(createdBody.location.country).toBeUndefined();
    expect(createdBody.location.gbpPlaceId).toBeUndefined();
    expect(createdBody.jobId).toEqual(expect.any(String));

    const list = await api(`/api/local-seo/${workspaceId}/locations`);
    expect(list.status).toBe(200);
    const listBody = await list.json() as { locations: Array<{ id: string; name: string }> };
    expect(listBody.locations).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: createdBody.location.id, name: 'Sparse Office' }),
    ]));
  });
});
