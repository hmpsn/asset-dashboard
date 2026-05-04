import { describe, expect, it } from 'vitest';
import { findPageMapEntryByIdentity, matchPageIdentity, normalizePageUrl } from '../server/helpers';

describe('admin chat page keyword identity matching', () => {
  const pageMap = [
    { pagePath: '/seo', pageTitle: 'SEO Root' },
    { pagePath: '/services/seo', pageTitle: 'SEO Service' },
    { pagePath: '/', pageTitle: 'Home' },
  ];

  it('normalizes full URLs before pageMap lookup', () => {
    expect(normalizePageUrl('https://example.com/services/seo/?utm=1#faq')).toBe('/services/seo');
    expect(findPageMapEntryByIdentity(pageMap, 'https://example.com/services/seo/?utm=1#faq')?.pageTitle)
      .toBe('SEO Service');
  });

  it('matches case-insensitively after exact normalized lookup', () => {
    expect(findPageMapEntryByIdentity(pageMap, '/Services/SEO')?.pageTitle).toBe('SEO Service');
  });

  it('matches homepage URL variants without matching every page', () => {
    expect(findPageMapEntryByIdentity(pageMap, 'https://example.com')?.pageTitle).toBe('Home');
    expect(matchPageIdentity('/', '/services/seo')).toBe(false);
  });

  it('does not fuzzy-match sibling leaf paths', () => {
    expect(findPageMapEntryByIdentity(pageMap, '/blog/seo')).toBeUndefined();
    expect(matchPageIdentity('/seo', '/services/seo')).toBe(false);
  });
});
