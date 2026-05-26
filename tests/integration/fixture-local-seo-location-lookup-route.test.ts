import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestContext } from './helpers.js';
import { seedWorkspace, type SeededFullWorkspace } from '../fixtures/workspace-seed.js';
import { seedAuthData, type SeededAuth } from '../fixtures/auth-seed.js';
import { updateWorkspace } from '../../server/workspaces.js';
import {
  LOCAL_SEO_LOCATION_LOOKUP_STATUS,
  type LocalSeoLocationLookupResponse,
} from '../../shared/types/local-seo.js';

const ctx = createTestContext(13726);
const { api } = ctx;

let seeded: SeededFullWorkspace | null = null;
let scopedAuth: SeededAuth | null = null;
let workspaceId = '';

describe('Fixture local SEO location-lookup route', () => {
  beforeAll(async () => {
    await ctx.startServer();

    const featureEnable = await api('/api/admin/feature-flags/local-seo-visibility', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    });
    expect(featureEnable.status).toBe(200);

    seeded = seedWorkspace({ seoDataProvider: 'dataforseo' });
    workspaceId = seeded.workspaceId;
    scopedAuth = await seedAuthData();

    updateWorkspace(workspaceId, {
      liveDomain: 'https://fixture-local-location-lookup.example.com',
      businessProfile: {
        phone: '(512) 555-0111',
        address: {
          street: '200 Congress Ave',
          city: 'Austin',
          state: 'TX',
          country: 'US',
        },
      },
      intelligenceProfile: {
        industry: 'Dental Practice',
      },
    });
  }, 25_000);

  afterAll(async () => {
    if (seeded) seeded.cleanup();
    if (scopedAuth) scopedAuth.cleanup();

    await api('/api/admin/feature-flags/local-seo-visibility', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: null }),
    });

    await ctx.stopServer();
  });

  it('GET /api/local-seo/:workspaceId/location-lookup returns 200 with query/status/candidates shape', async () => {
    const res = await api(`/api/local-seo/${workspaceId}/location-lookup?city=Austin&stateOrRegion=TX&country=US`);
    expect(res.status).toBe(200);

    const body = await res.json() as LocalSeoLocationLookupResponse;
    expect(body).toEqual(expect.objectContaining({
      status: expect.any(String),
      query: expect.objectContaining({
        city: 'Austin',
        stateOrRegion: 'TX',
        country: 'US',
      }),
      candidates: expect.any(Array),
    }));

    expect(Object.values(LOCAL_SEO_LOCATION_LOOKUP_STATUS)).toContain(body.status);
    for (const candidate of body.candidates) {
      expect(candidate).toEqual(expect.objectContaining({
        providerLocationCode: expect.any(Number),
        providerLocationName: expect.any(String),
        score: expect.any(Number),
      }));
      expect(Number.isFinite(candidate.providerLocationCode)).toBe(true);
      expect(candidate.providerLocationName.length).toBeGreaterThan(0);
      expect(Number.isFinite(candidate.score)).toBe(true);
    }
    if (body.bestCandidate) {
      expect(body.bestCandidate).toEqual(expect.objectContaining({
        providerLocationCode: expect.any(Number),
        providerLocationName: expect.any(String),
        score: expect.any(Number),
      }));
      expect(
        body.candidates.some(candidate => candidate.providerLocationCode === body.bestCandidate?.providerLocationCode),
      ).toBe(true);
    }
  });

  it('GET /api/local-seo/:workspaceId/location-lookup rejects malformed and out-of-bound query inputs', async () => {
    const tooLongCity = 'C'.repeat(121);
    const tooLongState = 'S'.repeat(121);
    const cases: Array<{ url: string; label: string }> = [
      { label: 'missing city', url: `/api/local-seo/${workspaceId}/location-lookup?country=US` },
      { label: 'empty city', url: `/api/local-seo/${workspaceId}/location-lookup?city=&country=US` },
      { label: 'city exceeds max length', url: `/api/local-seo/${workspaceId}/location-lookup?city=${tooLongCity}&country=US` },
      { label: 'country shorter than min length', url: `/api/local-seo/${workspaceId}/location-lookup?city=Austin&country=U` },
      { label: 'state exceeds max length', url: `/api/local-seo/${workspaceId}/location-lookup?city=Austin&stateOrRegion=${tooLongState}&country=US` },
      { label: 'unexpected query key', url: `/api/local-seo/${workspaceId}/location-lookup?city=Austin&country=US&unexpected=1` },
    ];

    for (const testCase of cases) {
      const res = await api(testCase.url);
      expect(res.status, testCase.label).toBe(400);
      const body = await res.json() as { error?: unknown };
      expect(typeof body.error, testCase.label).toBe('string');
      expect((body.error as string).length, testCase.label).toBeGreaterThan(0);
    }
  });

  it('GET /api/local-seo/:workspaceId/location-lookup accepts boundary-length values and still returns the contract shape', async () => {
    const city120 = 'A'.repeat(120);
    const state120 = 'B'.repeat(120);

    const res = await api(
      `/api/local-seo/${workspaceId}/location-lookup?city=${city120}&stateOrRegion=${state120}&country=US`,
    );
    expect(res.status).toBe(200);

    const body = await res.json() as LocalSeoLocationLookupResponse;
    expect(body.query.city).toBe(city120);
    expect(body.query.stateOrRegion).toBe(state120);
    expect(body.query.country).toBe('US');
    expect(body.candidates).toEqual(expect.any(Array));
    expect(Object.values(LOCAL_SEO_LOCATION_LOOKUP_STATUS)).toContain(body.status);
  });

  it('GET /api/local-seo/:workspaceId/location-lookup returns 404 when workspace does not exist', async () => {
    const res = await api('/api/local-seo/does-not-exist/location-lookup?city=Austin&stateOrRegion=TX&country=US');
    expect(res.status).toBe(404);
    const body = await res.json() as { error?: unknown };
    expect(body).toEqual({ error: 'Workspace not found' });
  });

  it('GET /api/local-seo/:workspaceId/location-lookup enforces workspace access when a JWT for another workspace is provided', async () => {
    expect(scopedAuth).not.toBeNull();
    const res = await api(`/api/local-seo/${workspaceId}/location-lookup?city=Austin&stateOrRegion=TX&country=US`, {
      headers: { Authorization: `Bearer ${scopedAuth!.adminToken}` },
    });
    expect(res.status).toBe(403);
    const body = await res.json() as { error?: unknown };
    expect(body).toEqual({ error: 'You do not have access to this workspace' });
  });
});
