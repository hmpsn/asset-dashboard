import { describe, expect, it } from 'vitest';
import { recommendationAppliesToPage } from '../../src/hooks/useRecommendations';
import type { Recommendation } from '../../shared/types/recommendations';

function rec(affectedPages: string[]): Pick<Recommendation, 'affectedPages'> {
  return { affectedPages };
}

describe('recommendationAppliesToPage', () => {
  it('matches exact paths with trailing slash normalization', () => {
    expect(recommendationAppliesToPage(rec(['/services/seo/']), '/services/seo')).toBe(true);
    expect(recommendationAppliesToPage(rec(['services/seo']), '/services/seo')).toBe(true);
  });

  it('matches homepage recommendations for empty Webflow homepage slugs', () => {
    expect(recommendationAppliesToPage(rec(['']), '')).toBe(true);
    expect(recommendationAppliesToPage(rec(['/']), '')).toBe(true);
  });

  it('does not let homepage match every page', () => {
    expect(recommendationAppliesToPage(rec(['/services/seo']), '/')).toBe(false);
  });

  it('does not overmatch sibling leaf slugs', () => {
    expect(recommendationAppliesToPage(rec(['seo']), '/services/seo')).toBe(false);
    expect(recommendationAppliesToPage(rec(['services/seo']), '/seo')).toBe(false);
  });

  it('normalizes full URL recommendation identities', () => {
    expect(recommendationAppliesToPage(rec(['https://example.com/services/seo?utm=1#top']), '/services/seo')).toBe(true);
  });
});
