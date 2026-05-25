import { describe, expect, it } from 'vitest';

import type { AnalyticsInsight, FreshnessAlertData } from '../../shared/types/analytics.js';
import type { TemplateContext } from '../../server/briefing-templates/index.js';
import { buildStoryFromInsight } from '../../server/briefing-templates/freshness-alert.js';

function makeInsight(overrides: Partial<FreshnessAlertData> = {}): AnalyticsInsight<'freshness_alert'> {
  const data: FreshnessAlertData = {
    pagePath: '/blog/content-refresh-checklist',
    lastAnalyzedAt: '2025-11-05T00:00:00.000Z',
    daysSinceLastAnalysis: 120,
    impressions: 12500,
    clicks: 380,
    ...overrides,
  };

  return {
    id: 'insight-freshness-1',
    workspaceId: 'ws-1',
    pageId: null,
    insightType: 'freshness_alert',
    data,
    severity: 'warning',
    computedAt: '2026-05-25T12:00:00.000Z',
  };
}

const context: TemplateContext = {
  workspaceId: 'ws-1',
  tier: 'growth',
};

describe('buildStoryFromInsight (freshness_alert)', () => {
  it('returns null for malformed payloads and sub-threshold freshness windows', () => {
    expect(buildStoryFromInsight(makeInsight({ pagePath: '' }), context)).toBeNull();
    expect(buildStoryFromInsight(makeInsight({ lastAnalyzedAt: '' }), context)).toBeNull();
    expect(
      buildStoryFromInsight(
        makeInsight({ daysSinceLastAnalysis: Number.NaN }),
        context,
      ),
    ).toBeNull();
    expect(buildStoryFromInsight(makeInsight({ daysSinceLastAnalysis: 89.9 }), context)).toBeNull();
  });

  it('builds warning opportunity at 90-180 day band with demand metrics', () => {
    const story = buildStoryFromInsight(
      makeInsight({
        daysSinceLastAnalysis: 120.9,
        lastAnalyzedAt: '2025-12-31T00:00:00.000Z',
        impressions: 12500,
        clicks: 380,
      }),
      context,
    );

    expect(story).not.toBeNull();
    expect(story?.category).toBe('opportunity');
    expect(story?.isHeadline).toBe(false);
    expect(story?.leadEligible).toBe(false);
    expect(story?.headline).toBe('/blog/content-refresh-checklist is 120 days stale — time for a refresh.');
    expect(story?.narrative).toContain(
      '/blog/content-refresh-checklist was last analyzed on Dec 31, 2025, 120 days ago.',
    );
    expect(story?.narrative).toContain(
      'the page logged 12,500 impressions and 380 clicks in the last 28 days.',
    );
    expect(story?.narrative).toContain('It crosses the 90-day warning line');
    expect(story?.metrics).toEqual([
      { value: '120d', label: 'stale' },
      { value: '12,500 impr', label: 'still searched' },
    ]);
    expect(story?.drillIn).toEqual({
      page: 'health',
      queryParams: { page: '/blog/content-refresh-checklist' },
    });
  });

  it('builds risk story for critical freshness and month-based headline wording', () => {
    const story = buildStoryFromInsight(
      makeInsight({
        daysSinceLastAnalysis: 181,
        lastAnalyzedAt: '2025-10-01T00:00:00.000Z',
        impressions: 500,
        clicks: 5,
      }),
      context,
    );

    expect(story).not.toBeNull();
    expect(story?.category).toBe('risk');
    expect(story?.headline).toBe('/blog/content-refresh-checklist hasn\'t been refreshed in 6 months.');
    expect(story?.narrative).toContain('past the 180-day critical threshold');
    expect(story?.metrics).toEqual([
      { value: '181d', label: 'stale' },
      { value: '500 impr', label: 'still searched' },
    ]);
  });

  it('uses last-touched fallback metric when impressions are not positive', () => {
    const story = buildStoryFromInsight(
      makeInsight({
        daysSinceLastAnalysis: 90,
        lastAnalyzedAt: '2025-08-15T00:00:00.000Z',
        impressions: 0,
        clicks: 12,
      }),
      context,
    );

    expect(story).not.toBeNull();
    expect(story?.category).toBe('opportunity');
    expect(story?.narrative).toContain('still earns 12 clicks across the last 28 days.');
    expect(story?.metrics).toEqual([
      { value: '90d', label: 'stale' },
      { value: 'Aug 15, 2025', label: 'last touched' },
    ]);
  });

  it('requires parseable lastAnalyzedAt date for narrative/metric stability', () => {
    const story = buildStoryFromInsight(
      makeInsight({
        daysSinceLastAnalysis: 150,
        lastAnalyzedAt: 'not-a-date',
      }),
      context,
    );

    expect(story).toBeNull();
  });
});
