import { describe, expect, it } from 'vitest';
import { FakeSeoProvider } from '../../server/providers/fake-seo-provider.js';
import { LOCAL_PROVIDER_FIXTURE } from '../../server/providers/local-provider-fixtures.js';

describe('FakeSeoProvider', () => {
  const provider = new FakeSeoProvider();

  it('reports configured and returns deterministic keyword metrics', async () => {
    expect(provider.isConfigured()).toBe(true);
    const rows = await provider.getKeywordMetrics(['plumber chicago', 'hvac near me'], 'ws_demo_growth');
    expect(rows).toHaveLength(2);
    expect(rows[0]?.keyword).toBe('plumber chicago');
    expect(rows[0]?.trend).toHaveLength(12);
  });

  it('handles invalid URLs when resolving URL keywords', async () => {
    const rows = await provider.getUrlKeywords('not-a-valid-url', 'ws_demo_growth', 3);
    expect(rows).toHaveLength(3);
    expect(rows[0]?.url).toContain('example.com');
  });

  it('fills the provider-rich advanced SEO capabilities deterministically', async () => {
    const location = await provider.resolveLocalSeoLocation?.({
      city: 'Austin',
      stateOrRegion: 'TX',
      country: 'US',
    }, LOCAL_PROVIDER_FIXTURE.workspaceId);
    const serp = await provider.getNationalSerp?.({
      keyword: 'seo agency austin',
      ownerDomain: LOCAL_PROVIDER_FIXTURE.domain,
      device: 'desktop',
    }, LOCAL_PROVIDER_FIXTURE.workspaceId);
    const listings = await provider.getBusinessListings?.({
      category: 'Marketing agency',
      locationCoordinate: '30.2672,-97.7431,20',
      ownerDomain: LOCAL_PROVIDER_FIXTURE.domain,
      ownerPlaceIds: [LOCAL_PROVIDER_FIXTURE.gbpPlaceId],
    }, LOCAL_PROVIDER_FIXTURE.workspaceId);
    const mentions = await provider.getLlmMentions?.({
      domain: LOCAL_PROVIDER_FIXTURE.domain,
      ownerBrandNames: [LOCAL_PROVIDER_FIXTURE.businessName],
    }, LOCAL_PROVIDER_FIXTURE.workspaceId);
    const authority = await provider.getDomainAuthorityMetrics?.([
      LOCAL_PROVIDER_FIXTURE.domain,
      'signal-studio.example',
    ], LOCAL_PROVIDER_FIXTURE.workspaceId);

    expect(location?.status).toBe('matched');
    expect(location?.bestCandidate?.providerLocationCode).toBe(1026201);
    expect(serp).toMatchObject({ position: 3, aiOverviewPresent: true, aiOverviewCited: true });
    expect(listings?.find((row) => row.isOwned)).toMatchObject({
      placeId: LOCAL_PROVIDER_FIXTURE.gbpPlaceId,
      rating: 4.8,
    });
    expect(mentions).toMatchObject({ mentions: 42, shareOfVoice: 0.42 });
    expect(authority).toEqual([
      { domain: LOCAL_PROVIDER_FIXTURE.domain, authorityRank: 61, top3Keywords: 148 },
      { domain: 'signal-studio.example', authorityRank: 54, top3Keywords: 93 },
    ]);
  });

  it('does not populate advanced provider evidence for arbitrary demo workspaces', async () => {
    const listings = await provider.getBusinessListings?.({
      category: 'Dentist',
      locationCoordinate: '30.2672,-97.7431,20',
      ownerDomain: 'growth-demo.local',
    }, 'ws_demo_growth');
    const authority = await provider.getDomainAuthorityMetrics?.(['growth-demo.local'], 'ws_demo_growth');

    expect(listings).toEqual([]);
    expect(authority).toEqual([]);
  });
});
