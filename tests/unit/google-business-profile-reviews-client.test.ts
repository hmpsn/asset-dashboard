import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listGbpReviewsFromGoogle } from '../../server/google-business-profile-client.js';

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Google Business Profile review client', () => {
  it('lists recent reviews with the v4 reviews endpoint and keeps sync bounded', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      reviews: [
        {
          name: 'accounts/123/locations/456/reviews/rev-1',
          reviewId: 'rev-1',
          starRating: 'FIVE',
          comment: 'Great team.',
          updateTime: '2026-06-29T12:00:00Z',
        },
      ],
      averageRating: 4.8,
      totalReviewCount: 42,
      nextPageToken: 'next-page',
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await listGbpReviewsFromGoogle(
      'access-token',
      'accounts/123/locations/456',
    );

    expect(result.reviews).toHaveLength(1);
    expect(result.averageRating).toBe(4.8);
    expect(result.totalReviewCount).toBe(42);
    expect(result.nextPageToken).toBe('next-page');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('https://mybusiness.googleapis.com/v4/accounts/123/locations/456/reviews');
    expect(url).toContain('pageSize=50');
    expect(url).toContain('orderBy=updateTime+desc');
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer access-token');
  });

  it('can follow additional pages when explicitly requested by tests or jobs', async () => {
    const fetchMock = vi.fn(async (url: string) => new Response(JSON.stringify(
      url.includes('pageToken=page-2')
        ? { reviews: [{ name: 'accounts/1/locations/2/reviews/b', reviewId: 'b', starRating: 'FOUR' }] }
        : { reviews: [{ name: 'accounts/1/locations/2/reviews/a', reviewId: 'a', starRating: 'FIVE' }], nextPageToken: 'page-2' },
    ), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await listGbpReviewsFromGoogle(
      'access-token',
      'accounts/1/locations/2',
      { maxPages: 2 },
    );

    expect(result.reviews.map(review => review.reviewId)).toEqual(['a', 'b']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
