import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const authMocks = vi.hoisted(() => ({
  getValidToken: vi.fn(),
}));

vi.mock('../../server/google-auth.js', () => ({
  getValidToken: authMocks.getValidToken,
}));

vi.mock('../../server/logger.js', () => ({
  createLogger: () => ({
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  }),
}));

import {
  LOCAL_PROVIDER_FIXTURE,
  isLocalProviderFixtureDomain,
  isLocalProviderFixtureProperty,
  isLocalProviderFixtureSite,
} from '../../server/providers/local-provider-fixtures.js';
import {
  getPerformanceTrend,
  getSearchDeviceBreakdown,
  getSearchOverview,
  listGscSites,
} from '../../server/search-console.js';

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_LOCAL_FAKE_PROVIDERS = process.env.LOCAL_FAKE_PROVIDERS;

beforeEach(() => {
  process.env.NODE_ENV = 'development';
  process.env.LOCAL_FAKE_PROVIDERS = 'true';
  authMocks.getValidToken.mockReset();
  authMocks.getValidToken.mockResolvedValue(null);
});

afterEach(() => {
  process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  process.env.LOCAL_FAKE_PROVIDERS = ORIGINAL_LOCAL_FAKE_PROVIDERS;
});

describe('local provider-rich fixture identity', () => {
  it('matches only the explicit demo site, property, and domain while fixture mode is enabled', () => {
    expect(isLocalProviderFixtureSite(LOCAL_PROVIDER_FIXTURE.siteId)).toBe(true);
    expect(isLocalProviderFixtureProperty(LOCAL_PROVIDER_FIXTURE.ga4PropertyId)).toBe(true);
    expect(isLocalProviderFixtureProperty(LOCAL_PROVIDER_FIXTURE.ga4PropertyNumericId)).toBe(true);
    expect(isLocalProviderFixtureDomain(`https://${LOCAL_PROVIDER_FIXTURE.domain}/services`)).toBe(true);

    expect(isLocalProviderFixtureSite('site_demo_growth')).toBe(false);
    expect(isLocalProviderFixtureProperty('properties/100001')).toBe(false);
    expect(isLocalProviderFixtureDomain('https://example.com/')).toBe(false);
  });

  it('is disabled outside development even for the explicit identity', () => {
    process.env.NODE_ENV = 'production';
    expect(isLocalProviderFixtureSite(LOCAL_PROVIDER_FIXTURE.siteId)).toBe(false);
    expect(isLocalProviderFixtureProperty(LOCAL_PROVIDER_FIXTURE.ga4PropertyId)).toBe(false);
    expect(isLocalProviderFixtureDomain(`https://${LOCAL_PROVIDER_FIXTURE.domain}/`)).toBe(false);
  });
});

describe('local provider-rich GSC reads', () => {
  it('returns populated deterministic report data without requesting a Google token', async () => {
    const overview = await getSearchOverview(
      LOCAL_PROVIDER_FIXTURE.siteId,
      LOCAL_PROVIDER_FIXTURE.gscPropertyUrl,
      28,
    );
    const trend = await getPerformanceTrend(
      LOCAL_PROVIDER_FIXTURE.siteId,
      LOCAL_PROVIDER_FIXTURE.gscPropertyUrl,
      28,
    );
    const devices = await getSearchDeviceBreakdown(
      LOCAL_PROVIDER_FIXTURE.siteId,
      LOCAL_PROVIDER_FIXTURE.gscPropertyUrl,
      28,
    );
    const sites = await listGscSites(LOCAL_PROVIDER_FIXTURE.siteId);

    expect(overview.totalClicks).toBeGreaterThan(0);
    expect(overview.topQueries).toHaveLength(5);
    expect(overview.topPages[0]?.page).toContain(LOCAL_PROVIDER_FIXTURE.domain);
    expect(trend.length).toBeGreaterThanOrEqual(14);
    expect(devices.map((row) => row.device)).toEqual(['DESKTOP', 'MOBILE', 'TABLET']);
    expect(sites).toContainEqual({
      siteUrl: LOCAL_PROVIDER_FIXTURE.gscPropertyUrl,
      permissionLevel: 'siteOwner',
    });
    expect(authMocks.getValidToken).not.toHaveBeenCalled();
  });

  it('retains the existing auth behavior for arbitrary sites', async () => {
    await expect(getSearchOverview('site_demo_growth', 'sc-domain:growth-demo.local')).rejects.toThrow(
      'Not connected to Google',
    );
    expect(authMocks.getValidToken).toHaveBeenCalledWith('site_demo_growth');
  });
});
