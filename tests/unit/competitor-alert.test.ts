import { describe, expect, it } from 'vitest';

import type { AnalyticsInsight, CompetitorAlertData } from '../../shared/types/analytics.js';
import type { TemplateContext } from '../../server/briefing-templates/index.js';
import { buildStoryFromInsight } from '../../server/briefing-templates/competitor-alert.js';

function makeInsight(
  overrides: Partial<CompetitorAlertData> = {},
): AnalyticsInsight<'competitor_alert'> {
  const data: CompetitorAlertData = {
    competitorDomain: 'rival.example.com',
    alertType: 'keyword_gained',
    keyword: 'hvac repair chicago',
    previousPosition: 9,
    currentPosition: 4,
    volume: 12800,
    snapshotDate: '2026-05-19',
    ...overrides,
  };

  return {
    id: 'insight-competitor-1',
    workspaceId: 'ws-1',
    pageId: null,
    insightType: 'competitor_alert',
    data,
    severity: 'warning',
    computedAt: '2026-05-25T12:00:00.000Z',
  };
}

const context: TemplateContext = {
  workspaceId: 'ws-1',
  tier: 'growth',
};

describe('buildStoryFromInsight (competitor_alert)', () => {
  it('returns null for invalid top-level payloads and unknown alert types', () => {
    expect(buildStoryFromInsight(makeInsight({ competitorDomain: '   ' }), context)).toBeNull();
    expect(
      buildStoryFromInsight(
        makeInsight({ alertType: 'unexpected' as unknown as CompetitorAlertData['alertType'] }),
        context,
      ),
    ).toBeNull();
  });

  it('enforces alert-specific eligibility gates for keyword and authority branches', () => {
    expect(
      buildStoryFromInsight(
        makeInsight({ alertType: 'keyword_gained', keyword: '  ', previousPosition: 8, currentPosition: 5 }),
        context,
      ),
    ).toBeNull();

    expect(
      buildStoryFromInsight(
        makeInsight({ alertType: 'keyword_lost', keyword: 'plumber near me', previousPosition: undefined, currentPosition: undefined }),
        context,
      ),
    ).toBeNull();

    expect(
      buildStoryFromInsight(
        makeInsight({ alertType: 'new_keyword', keyword: '' }),
        context,
      ),
    ).toBeNull();

    expect(
      buildStoryFromInsight(
        makeInsight({ alertType: 'authority_change', positionChange: 0 }),
        context,
      ),
    ).toBeNull();
  });

  it('builds keyword_gained story with deterministic competitive/watchlist invariants', () => {
    const story = buildStoryFromInsight(makeInsight(), context);

    expect(story).not.toBeNull();
    expect(story?.category).toBe('competitive');
    expect(story?.isHeadline).toBe(false);
    expect(story?.leadEligible).toBe(false);
    expect(story?.headline).toBe('rival.example.com just moved up to #4 for "hvac repair chicago".');
    expect(story?.narrative).toContain(
      'rival.example.com rose from #9 to #4 on "hvac repair chicago" in this week\'s snapshot.',
    );
    expect(story?.narrative).toContain('The keyword sees 12.8k searches/mo, snapshot dated 2026-05-19.');
    expect(story?.metrics).toEqual([
      { value: '#9 → #4', label: 'rival.example.com' },
      { value: '12.8k/mo', label: 'volume' },
    ]);
    expect(story?.drillIn).toEqual({ page: 'strategy' });
    expect(story?.dataReceipt).toBe(
      'Source: weekly competitor monitoring (Monday cron). Snapshot: 2026-05-19. Type: keyword_gained.',
    );
  });

  it('truncates long domain metric labels and keeps full domain in narrative/headline', () => {
    const longDomain = 'ultra-long-subdomain-name-for-competitor-domain.example.com';
    const story = buildStoryFromInsight(
      makeInsight({
        competitorDomain: longDomain,
        alertType: 'authority_change',
        positionChange: 6,
        volume: undefined,
        keyword: undefined,
      }),
      context,
    );

    expect(story).not.toBeNull();
    expect(story?.headline).toBe(`${longDomain}'s overall authority shifted by +6.`);
    expect(story?.narrative).toContain(`${longDomain}'s overall authority rose by 6`);
    expect(story?.metrics).toEqual([
      { value: '+6', label: 'ultra-long-subdomain-name... authority' },
    ]);
  });

  it('builds new_keyword without volume metric and preserves keyword quoting', () => {
    const story = buildStoryFromInsight(
      makeInsight({
        alertType: 'new_keyword',
        keyword: 'best hvac thermostat setup',
        volume: 0,
        currentPosition: 17,
      }),
      context,
    );

    expect(story).not.toBeNull();
    expect(story?.headline).toBe('rival.example.com started ranking for "best hvac thermostat setup".');
    expect(story?.narrative).toContain('entered the SERP for "best hvac thermostat setup" at #17');
    expect(story?.metrics).toEqual([
      { value: '"best hvac thermostat setup"', label: 'new ranking' },
    ]);
  });
});
