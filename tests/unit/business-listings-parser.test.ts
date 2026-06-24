import { describe, expect, it, vi } from 'vitest';

// ── Harness: keep the provider module off real disk / env at import time ──
// `parseBusinessListings` (and the local-pack extractor) are pure, but they live in
// dataforseo-provider.ts, which calls getUploadRoot()/getDataDir() at module load.
// Stub those so the import is side-effect free (mirrors national-serp-parser.test.ts).
vi.mock('../../server/data-dir.js', () => ({
  getUploadRoot: () => '/tmp/test-uploads',
  getDataDir: () => '/tmp/test-data',
}));
vi.mock('../../server/logger.js', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import {
  parseBusinessListings,
  __testParseLocalPackResult,
} from '../../server/providers/dataforseo-provider.js';
import type { BusinessListingsRequest } from '../../server/seo-data-provider.js';
import {
  BUSINESS_LISTINGS_SEARCH,
  LOCAL_PACK_WITH_RATINGS,
} from '../fixtures/dataforseo-business-listings.js';

function makeRequest(overrides: Partial<BusinessListingsRequest> = {}): BusinessListingsRequest {
  return {
    category: 'Dentist',
    locationCoordinate: '37.7749,-122.4194,10',
    ownerDomain: 'www.sfdentalgroup.com',
    ...overrides,
  };
}

describe('parseBusinessListings (PAID business_listings_search)', () => {
  it('marks the owner listing isOwned via domain match', () => {
    const results = parseBusinessListings(BUSINESS_LISTINGS_SEARCH.items, makeRequest());
    const chan = results.find(r => r.title === 'Chan Siu Wan DDS');
    expect(chan).toBeDefined();
    expect(chan!.isOwned).toBe(true);
    expect(chan!.domain).toBe('www.sfdentalgroup.com');
  });

  it('parses a listing WITH reviews: rating, reviewCount, distribution, attributes, completeness', () => {
    const results = parseBusinessListings(BUSINESS_LISTINGS_SEARCH.items, makeRequest());
    const bridges = results.find(r => r.title === 'Bridges Thomas C DDS');
    expect(bridges).toBeDefined();
    expect(bridges!.isOwned).toBe(false); // no domain, not in ownerPlaceIds
    expect(bridges!.rating).toBe(5);
    expect(bridges!.reviewCount).toBe(1);
    expect(bridges!.ratingDistribution?.['5']).toBe(1);
    expect(bridges!.attributes?.items).toContain('recommends_appointment');
    expect(bridges!.attributes?.items).toContain('has_wheelchair_accessible_entrance');
    expect(bridges!.completenessScore ?? bridges!.attributes?.completenessScore).toBeGreaterThan(0);
    expect(bridges!.attributes!.completenessScore).toBeGreaterThan(0);
    expect(bridges!.city).toBe('San Francisco');
    expect(bridges!.placeId).toBe('ChIJc2xuz46AhYARndorbzaM4g0');
  });

  it('leaves rating/reviewCount undefined when the listing has no rating block (never 0)', () => {
    const results = parseBusinessListings(BUSINESS_LISTINGS_SEARCH.items, makeRequest());
    const chan = results.find(r => r.title === 'Chan Siu Wan DDS');
    expect(chan!.rating).toBeUndefined();
    expect(chan!.reviewCount).toBeUndefined();
    expect(chan!.ratingDistribution).toBeUndefined();
  });

  it('matches isOwned via ownerPlaceIds (place_id / cid) too', () => {
    const results = parseBusinessListings(
      BUSINESS_LISTINGS_SEARCH.items,
      makeRequest({ ownerDomain: 'example.com', ownerPlaceIds: ['ChIJc2xuz46AhYARndorbzaM4g0'] }),
    );
    const bridges = results.find(r => r.title === 'Bridges Thomas C DDS');
    expect(bridges!.isOwned).toBe(true);
  });

  it('is defensive: filters non-object items and never throws', () => {
    const mixed = [null, 'garbage', 42, ...BUSINESS_LISTINGS_SEARCH.items] as unknown[];
    const results = parseBusinessListings(mixed, makeRequest());
    expect(results).toHaveLength(BUSINESS_LISTINGS_SEARCH.items.length);
  });
});

describe('local-pack rating extraction (FREE half, U3)', () => {
  it('extracts rating + reviewCount onto LocalVisibilityBusinessResult', () => {
    const results = __testParseLocalPackResult(LOCAL_PACK_WITH_RATINGS);
    const folsom = results.find(r => r.title === 'Folsom Street Dental');
    expect(folsom).toBeDefined();
    expect(folsom!.rating).toBe(4.9);
    expect(folsom!.reviewCount).toBe(987);
  });
});
