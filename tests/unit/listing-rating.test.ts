import { describe, expect, it } from 'vitest';

import { parseListingRating } from '../../server/listing-rating.js';

describe('parseListingRating', () => {
  it('reads value → rating and votes_count → reviewCount when both are numbers', () => {
    expect(parseListingRating({ rating_type: 'Max5', value: 5, votes_count: 1 })).toEqual({
      rating: 5,
      reviewCount: 1,
    });
  });

  it('reads decimal rating + large review counts (free local_pack shape)', () => {
    expect(parseListingRating({ rating_type: 'Max5', value: 4.9, votes_count: 987, rating_max: 5 })).toEqual({
      rating: 4.9,
      reviewCount: 987,
    });
  });

  it('returns both undefined when a zero-review business has only rating_type (never 0)', () => {
    expect(parseListingRating({ rating_type: 'Max5' })).toEqual({
      rating: undefined,
      reviewCount: undefined,
    });
  });

  it('returns both undefined for undefined / null / empty object', () => {
    expect(parseListingRating(undefined)).toEqual({ rating: undefined, reviewCount: undefined });
    expect(parseListingRating(null)).toEqual({ rating: undefined, reviewCount: undefined });
    expect(parseListingRating({})).toEqual({ rating: undefined, reviewCount: undefined });
  });

  it('ignores non-numeric value / votes_count (never coerces strings to numbers)', () => {
    expect(parseListingRating({ value: '5', votes_count: '10' })).toEqual({
      rating: undefined,
      reviewCount: undefined,
    });
  });
});
