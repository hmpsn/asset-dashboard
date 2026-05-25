import { describe, expect, it } from 'vitest';
import type { AnalyticsInsight } from '../../shared/types/analytics.js';
import { buildStoryFromInsight } from '../../server/briefing-templates/ctr-opportunity.js';

const context = { workspaceId: 'ws_ctr_test', tier: 'growth' as const };

function makeInsight(
  data: Partial<AnalyticsInsight<'ctr_opportunity'>['data']> = {},
): AnalyticsInsight<'ctr_opportunity'> {
  return {
    id: 'ins_ctr_1',
    workspaceId: 'ws_ctr_test',
    pageId: '/pricing',
    insightType: 'ctr_opportunity',
    severity: 'opportunity',
    computedAt: '2026-05-25T00:00:00.000Z',
    data: {
      query: 'plumber near me',
      pageUrl: '/services/plumbing',
      position: 5,
      actualCtr: 2.1,
      expectedCtr: 6.3,
      impressions: 1500,
      estimatedClickGap: 63.2,
      ctrRatio: 0.33,
      ...data,
    },
  } as AnalyticsInsight<'ctr_opportunity'>;
}

describe('ctr-opportunity template', () => {
  it('accepts the exact impressions threshold (100) and rounds click upside', () => {
    const story = buildStoryFromInsight(
      makeInsight({ impressions: 100, estimatedClickGap: 63.8 }),
      context,
    );

    expect(story).not.toBeNull();
    expect(story?.headline).toContain('2.1% CTR');
    expect(story?.headline).toContain('6.3%');
    expect(story?.metrics).toEqual([
      { value: '2.1% / 6.3%', label: 'CTR vs benchmark' },
      { value: '+64', label: 'click upside' },
    ]);
    expect(story?.narrative).toContain('100 impressions');
    expect(story?.narrative).toContain('64 clicks on the table');
  });

  it('rejects out-of-band eligibility cases (impressions, ctr relation, or gap)', () => {
    expect(buildStoryFromInsight(makeInsight({ impressions: 99 }), context)).toBeNull();
    expect(buildStoryFromInsight(makeInsight({ actualCtr: 6.3, expectedCtr: 6.3 }), context)).toBeNull();
    expect(buildStoryFromInsight(makeInsight({ actualCtr: 7.1, expectedCtr: 6.3 }), context)).toBeNull();
    expect(buildStoryFromInsight(makeInsight({ estimatedClickGap: 0 }), context)).toBeNull();
    expect(buildStoryFromInsight(makeInsight({ estimatedClickGap: -2 }), context)).toBeNull();
  });

  it('clamps invalid negative CTR to 0 in output formatting without changing eligibility gate', () => {
    const story = buildStoryFromInsight(
      makeInsight({ actualCtr: -4, expectedCtr: 6, impressions: 420, estimatedClickGap: 12.2 }),
      context,
    );

    expect(story).not.toBeNull();
    expect(story?.headline).toContain('0% CTR');
    expect(story?.headline).toContain('is 6%');
    expect(story?.metrics?.[0]).toEqual({
      value: '0% / 6%',
      label: 'CTR vs benchmark',
    });
    expect(story?.narrative).toContain('6% – 0% gap');
  });

  it('returns null when required data fields are missing', () => {
    expect(buildStoryFromInsight(makeInsight({ query: '' }), context)).toBeNull();
    expect(buildStoryFromInsight(makeInsight({ pageUrl: '' }), context)).toBeNull();
    expect(buildStoryFromInsight(makeInsight({ position: undefined }), context)).toBeNull();
    expect(buildStoryFromInsight(makeInsight({ actualCtr: undefined }), context)).toBeNull();
    expect(buildStoryFromInsight(makeInsight({ expectedCtr: undefined }), context)).toBeNull();
    expect(buildStoryFromInsight(makeInsight({ impressions: undefined }), context)).toBeNull();
  });
});
