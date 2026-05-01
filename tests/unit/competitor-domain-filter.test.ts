import { describe, expect, it } from 'vitest';

import {
  cleanCompetitorDomains,
  filterDiscoveredCompetitors,
  isDiscoverableCompetitorDomain,
  isProviderSafeDomain,
  normalizeCompetitorDomain,
} from '../../server/competitor-domain-filter.js';

describe('competitor-domain-filter', () => {
  it('normalizes pasted competitor domains', () => {
    expect(normalizeCompetitorDomain('https://www.Rival.com/services?x=1')).toBe('rival.com');
    expect(normalizeCompetitorDomain('blog.rival.com:443/guide')).toBe('blog.rival.com');
  });

  it('filters generic SERP platforms from auto-discovered competitors', () => {
    const discovered = [
      { domain: 'linkedin.com', competitorRelevance: 99 },
      { domain: 'youtube.com', competitorRelevance: 96 },
      { domain: 'reddit.com', competitorRelevance: 92 },
      { domain: 'facebook.com', competitorRelevance: 90 },
      { domain: 'instagram.com', competitorRelevance: 89 },
      { domain: 'real-rival.com', competitorRelevance: 72 },
    ];

    expect(filterDiscoveredCompetitors(discovered, 'client.com')).toEqual([
      { domain: 'real-rival.com', competitorRelevance: 72 },
    ]);
  });

  it('filters platform subdomains and the client domain family', () => {
    expect(isDiscoverableCompetitorDomain('m.youtube.com', 'client.com')).toBe(false);
    expect(isDiscoverableCompetitorDomain('www.linkedin.com', 'client.com')).toBe(false);
    expect(isDiscoverableCompetitorDomain('blog.client.com', 'client.com')).toBe(false);
    expect(isDiscoverableCompetitorDomain('client.com', 'client.com')).toBe(false);
    expect(isDiscoverableCompetitorDomain('rival-client.com', 'client.com')).toBe(true);
  });

  it('rejects bare brand tokens before provider calls', () => {
    expect(isProviderSafeDomain('peteramay')).toBe(false);
    expect(isDiscoverableCompetitorDomain('peteramay', 'client.com')).toBe(false);
    expect(isProviderSafeDomain('peteramay.com')).toBe(true);
  });

  it('cleans manual saves, dedupes, and drops generic platforms', () => {
    expect(cleanCompetitorDomains([
      'https://www.LinkedIn.com/company/example',
      'https://rival.com/path',
      'RIVAL.com',
      'peteramay',
      'reddit.com',
      'other-rival.com',
    ], 'client.com')).toEqual(['rival.com', 'other-rival.com']);
  });
});
