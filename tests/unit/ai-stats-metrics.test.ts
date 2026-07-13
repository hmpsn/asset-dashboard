import { describe, expect, it } from 'vitest';

import { calculateCacheHitRate, resolveUsageSince } from '../../server/routes/ai-stats.js';

describe('AI stats metric semantics', () => {
  it('derives an ISO cutoff from days when since is omitted', () => {
    expect(resolveUsageSince(undefined, '7', new Date('2026-07-13T12:00:00.000Z')))
      .toBe('2026-07-06T12:00:00.000Z');
  });

  it('gives an explicit since value precedence and clamps invalid days', () => {
    expect(resolveUsageSince('2026-07-01T00:00:00.000Z', '3')).toBe('2026-07-01T00:00:00.000Z');
    expect(resolveUsageSince(undefined, 'not-a-number', new Date('2026-07-13T12:00:00.000Z')))
      .toBe('2026-06-13T12:00:00.000Z');
  });

  it('calculates completed cache hit rate from actual requests, never cache size', () => {
    expect(calculateCacheHitRate({ requests: 10, cacheHits: 3 })).toBe(0.3);
    expect(calculateCacheHitRate({ requests: 0, cacheHits: 0 })).toBe(0);
  });
});
