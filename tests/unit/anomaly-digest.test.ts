import { describe, expect, it } from 'vitest';

import type { AnalyticsInsight, AnomalyDigestData } from '../../shared/types/analytics.js';
import type { TemplateContext } from '../../server/briefing-templates/index.js';
import { buildStoryFromInsight } from '../../server/briefing-templates/anomaly-digest.js';

function makeInsight(overrides: Partial<AnomalyDigestData> = {}): AnalyticsInsight<'anomaly_digest'> {
  const data: AnomalyDigestData = {
    anomalyType: 'surge',
    metric: 'clicks',
    currentValue: 1820,
    expectedValue: 1200,
    deviationPercent: 51.7,
    durationDays: 14,
    firstDetected: '2026-05-10',
    severity: 'positive',
    affectedPage: '/blog/seo-playbook',
    ...overrides,
  };

  return {
    id: 'insight-anomaly-1',
    workspaceId: 'ws-1',
    pageId: null,
    insightType: 'anomaly_digest',
    data,
    severity: 'positive',
    computedAt: '2026-05-25T12:00:00.000Z',
  };
}

const context: TemplateContext = {
  workspaceId: 'ws-1',
  tier: 'growth',
};

describe('buildStoryFromInsight (anomaly_digest)', () => {
  it('returns null for malformed or incomplete payloads', () => {
    expect(buildStoryFromInsight(makeInsight({ metric: '' }), context)).toBeNull();
    expect(
      buildStoryFromInsight(
        makeInsight({ currentValue: undefined as unknown as number }),
        context,
      ),
    ).toBeNull();
    expect(
      buildStoryFromInsight(
        makeInsight({ durationDays: undefined as unknown as number }),
        context,
      ),
    ).toBeNull();
  });

  it('rejects non-positive movement for known and unknown metrics', () => {
    expect(
      buildStoryFromInsight(
        makeInsight({ metric: 'clicks', currentValue: 120, expectedValue: 180 }),
        context,
      ),
    ).toBeNull();

    expect(
      buildStoryFromInsight(
        makeInsight({ metric: 'position', currentValue: 14, expectedValue: 9 }),
        context,
      ),
    ).toBeNull();

    expect(
      buildStoryFromInsight(
        makeInsight({ metric: 'engagement', currentValue: 8, expectedValue: 8 }),
        context,
      ),
    ).toBeNull();
  });

  it('builds click-surge story with stable metric and receipt invariants', () => {
    const story = buildStoryFromInsight(makeInsight(), context);

    expect(story).not.toBeNull();
    expect(story?.category).toBe('win');
    expect(story?.isHeadline).toBe(false);
    expect(story?.headline).toBe('Search clicks just spiked +52% on /blog/seo-playbook.');
    expect(story?.narrative).toContain('search clicks on /blog/seo-playbook climbed from 1,200 to 1,820 over the last 14 days.');
    expect(story?.narrative).toContain('That is a +52% lift against the prior baseline of 1,200.');
    expect(story?.metrics).toEqual([
      { value: '+52%', label: 'clicks' },
      { value: '14d', label: 'sustained' },
    ]);
    expect(story?.drillIn).toEqual({
      page: 'performance',
      queryParams: { page: '/blog/seo-playbook' },
    });
    expect(story?.dataReceipt).toBe(
      'Source: anomaly detection cron. Baseline: 1,200. Current: 1,820. First detected: 2026-05-10.',
    );
  });

  it('builds position-improvement story with inverted-positive logic', () => {
    const story = buildStoryFromInsight(
      makeInsight({
        metric: 'position',
        currentValue: 4,
        expectedValue: 11,
        deviationPercent: -63.6,
        durationDays: 21,
        affectedPage: '/services/local-seo',
      }),
      context,
    );

    expect(story).not.toBeNull();
    expect(story?.headline).toBe('Average ranking jumped 7 spots on /services/local-seo.');
    expect(story?.narrative).toContain('average ranking position on /services/local-seo moved from #11 to #4 over the last 21 days.');
    expect(story?.narrative).toContain('That is a 64% improvement against the prior baseline of #11.');
    expect(story?.metrics).toEqual([
      { value: '#11 → #4', label: 'position' },
      { value: '21d', label: 'sustained' },
    ]);
  });

  it('uses site-wide fallback and generic metric wording for unknown metric surges', () => {
    const story = buildStoryFromInsight(
      makeInsight({
        metric: 'engagement',
        affectedPage: undefined,
        currentValue: 19.9,
        expectedValue: 10,
        deviationPercent: 99.1,
      }),
      context,
    );

    expect(story).not.toBeNull();
    expect(story?.headline).toBe('engagement surged +99% on site-wide.');
    expect(story?.narrative).toContain('engagement on site-wide climbed from 10 to 19.9 over the last 14 days.');
    expect(story?.drillIn).toEqual({ page: 'performance' });
  });
});
