import { describe, expect, it } from 'vitest';
import { INSIGHT_DATA_SCHEMA_MAP } from '../../server/schemas/insight-schemas.js';

describe('insight-schemas behavioral contracts', () => {
  it('validates representative page_health payload shape', () => {
    const parsed = INSIGHT_DATA_SCHEMA_MAP.page_health.parse({
      score: 84,
      trend: 'improving',
      clicks: 120,
      impressions: 1400,
      position: 5.2,
      ctr: 8.6,
      pageviews: 210,
      bounceRate: 42.1,
      avgEngagementTime: 94,
    });

    expect(parsed.score).toBe(84);
    expect(parsed.trend).toBe('improving');
  });

  it('supports partial + passthrough on map schemas for multiple insight types', () => {
    const partialPageHealth = INSIGHT_DATA_SCHEMA_MAP.page_health.parse({
      trend: 'stable',
      futureSignal: 'kept',
    });
    const partialRankingOpportunity = INSIGHT_DATA_SCHEMA_MAP.ranking_opportunity.parse({
      query: 'best seo agency chicago',
      extraMetadata: { source: 'future-format' },
    });

    expect(partialPageHealth).toMatchObject({
      trend: 'stable',
      futureSignal: 'kept',
    });
    expect(partialRankingOpportunity).toMatchObject({
      query: 'best seo agency chicago',
      extraMetadata: { source: 'future-format' },
    });
  });

  it('rejects invalid field types even with partial schemas', () => {
    const invalidRankingOpportunity = INSIGHT_DATA_SCHEMA_MAP.ranking_opportunity.safeParse({
      query: 'keyword',
      currentPosition: '11',
    });
    const invalidPageHealth = INSIGHT_DATA_SCHEMA_MAP.page_health.safeParse({
      trend: 'sideways',
    });

    expect(invalidRankingOpportunity.success).toBe(false);
    expect(invalidPageHealth.success).toBe(false);
  });
});
