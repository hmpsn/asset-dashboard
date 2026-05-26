import { describe, expect, it } from 'vitest';
import type { AnalyticsInsight } from '../../shared/types/analytics.js';
import { buildStoryFromInsight } from '../../server/briefing-templates/ranking-opportunity.js';

const context = { workspaceId: 'ws_ranking_test', tier: 'growth' as const };

function makeInsight(
  data: Partial<AnalyticsInsight<'ranking_opportunity'>['data']> = {},
): AnalyticsInsight<'ranking_opportunity'> {
  return {
    id: 'ins_rank_1',
    workspaceId: 'ws_ranking_test',
    pageId: '/services',
    insightType: 'ranking_opportunity',
    severity: 'opportunity',
    computedAt: '2026-05-25T00:00:00.000Z',
    data: {
      query: 'hvac repair austin',
      pageUrl: '/services/hvac-repair',
      currentPosition: 11,
      impressions: 2400,
      estimatedTrafficGain: 250,
      ...data,
    },
  } as AnalyticsInsight<'ranking_opportunity'>;
}

describe('ranking-opportunity template', () => {
  it('builds the position-11 headline and complete deterministic payload', () => {
    const story = buildStoryFromInsight(makeInsight(), context);

    expect(story).not.toBeNull();
    expect(story?.headline).toBe('"hvac repair austin" is one position away from page 1.');
    expect(story?.narrative).toContain('#11');
    expect(story?.narrative).toMatch(/(2,400|2\.4k) impressions/);
    expect(story?.narrative).toContain('1 position from page 1');
    expect(story?.narrative).toContain('estimated +250 clicks per month');
    expect(story?.metrics).toEqual([
      { value: expect.stringMatching(/(2,400|2\.4k) impressions/), label: 'impressions' },
      { value: '#11 → #10', label: 'to page 1' },
    ]);
    expect(story?.drillIn).toEqual({
      page: 'performance',
      queryParams: { page: '/services/hvac-repair', query: 'hvac repair austin' },
    });
  });

  it('enforces eligibility threshold boundaries (11-20 inclusive only)', () => {
    expect(buildStoryFromInsight(makeInsight({ currentPosition: 10 }), context)).toBeNull();
    expect(buildStoryFromInsight(makeInsight({ currentPosition: 21 }), context)).toBeNull();

    const p11 = buildStoryFromInsight(makeInsight({ currentPosition: 11 }), context);
    const p20 = buildStoryFromInsight(makeInsight({ currentPosition: 20 }), context);

    expect(p11).not.toBeNull();
    expect(p20).not.toBeNull();
    expect(p20?.headline).toContain('#20');
    expect(p20?.narrative).toContain('10 positions from page 1');
  });

  it('returns null when required fields are missing', () => {
    expect(buildStoryFromInsight(makeInsight({ query: '' }), context)).toBeNull();
    expect(buildStoryFromInsight(makeInsight({ pageUrl: '' }), context)).toBeNull();
    expect(buildStoryFromInsight(makeInsight({ currentPosition: undefined }), context)).toBeNull();
  });

  it('uses numeric fallbacks and omits gain sentence when traffic gain is missing or non-positive', () => {
    const missingNumbers = buildStoryFromInsight(
      makeInsight({ impressions: undefined, estimatedTrafficGain: undefined }),
      context,
    );
    expect(missingNumbers).not.toBeNull();
    expect(missingNumbers?.narrative).toContain('0 impressions');
    expect(missingNumbers?.narrative).not.toContain('estimated +');
    expect(missingNumbers?.dataReceipt).toContain('Impressions baseline: 0/mo.');

    const zeroGain = buildStoryFromInsight(makeInsight({ estimatedTrafficGain: 0 }), context);
    expect(zeroGain?.narrative).not.toContain('estimated +');
  });
});
