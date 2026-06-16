import { describe, it, expect } from 'vitest';
import { buildOpportunityRows } from '../../../src/components/strategy/buildOpportunityRows';
import type { PageKeywordMap, StrategyQuickWin } from '../../../src/components/strategy/types';

const qw = (over: Partial<StrategyQuickWin> = {}): StrategyQuickWin => ({
  pagePath: '/pricing', action: 'Add FAQ schema', estimatedImpact: 'high', rationale: 'r', roiScore: 80, ...over,
});
const lhf = (over: Partial<PageKeywordMap> = {}): PageKeywordMap => ({
  pagePath: '/blog/seo', pageTitle: 'SEO', primaryKeyword: 'seo tips', secondaryKeywords: [], currentPosition: 8, impressions: 1200, ...over,
});

describe('buildOpportunityRows', () => {
  it('returns quick_win rows first (by roiScore desc) then low_hanging rows (by impressions desc)', () => {
    const rows = buildOpportunityRows(
      [qw({ pagePath: '/a', roiScore: 10 }), qw({ pagePath: '/b', roiScore: 90 })],
      [lhf({ pagePath: '/x', impressions: 100 }), lhf({ pagePath: '/y', impressions: 5000 })],
    );
    expect(rows.map(r => r.kind)).toEqual(['quick_win', 'quick_win', 'low_hanging', 'low_hanging']);
    expect(rows[0].pagePath).toBe('/b'); // higher roi first
    expect(rows[2].pagePath).toBe('/y'); // higher impressions first
  });

  it('drops a low-hanging page that duplicates a quick-win page (matchPageIdentity, trailing-slash insensitive)', () => {
    const rows = buildOpportunityRows([qw({ pagePath: '/pricing' })], [lhf({ pagePath: '/pricing/' })]);
    expect(rows.filter(r => r.kind === 'low_hanging')).toHaveLength(0);
    expect(rows).toHaveLength(1);
  });

  it('returns [] when both inputs are empty', () => {
    expect(buildOpportunityRows([], [])).toEqual([]);
  });
});
