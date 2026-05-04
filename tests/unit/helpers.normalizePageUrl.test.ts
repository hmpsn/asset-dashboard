import { describe, it, expect } from 'vitest';
import { findPageMapEntryByIdentity, matchPageIdentity, normalizePageUrl } from '../../server/helpers';

describe('normalizePageUrl', () => {
  it('extracts and normalizes path from full URL', () => {
    expect(normalizePageUrl('https://example.com/blog/post/')).toBe('/blog/post');
  });

  it('handles path-only input', () => {
    expect(normalizePageUrl('/blog/post/')).toBe('/blog/post');
  });

  it('keeps root path', () => {
    expect(normalizePageUrl('https://example.com/')).toBe('/');
    expect(normalizePageUrl('/')).toBe('/');
  });

  it('handles malformed URL gracefully', () => {
    expect(normalizePageUrl('not-a-url')).toBe('/not-a-url');
  });

  it('strips query string and hash from full URL', () => {
    expect(normalizePageUrl('https://example.com/page?q=1#section')).toBe('/page');
  });

  it('matches full URLs to site-relative paths exactly after URL normalization', () => {
    expect(matchPageIdentity('https://example.com/services/seo/?utm=1#top', '/services/seo')).toBe(true);
  });

  it('treats homepage forms as the same page identity', () => {
    expect(matchPageIdentity('', '/')).toBe(true);
    expect(matchPageIdentity('https://example.com', '/')).toBe(true);
  });

  it('does not cross-match sibling leaf slugs', () => {
    expect(matchPageIdentity('/seo', '/services/seo')).toBe(false);
    expect(matchPageIdentity('services/seo', '/seo')).toBe(false);
  });

  it('finds pageMap entries from full URL identities without fuzzy suffix matching', () => {
    const pageMap = [
      { pagePath: '/seo', pageTitle: 'SEO Root' },
      { pagePath: '/services/seo', pageTitle: 'SEO Service' },
    ];

    expect(findPageMapEntryByIdentity(pageMap, 'https://example.com/services/seo?utm=1')?.pageTitle)
      .toBe('SEO Service');
    expect(findPageMapEntryByIdentity(pageMap, '/blog/seo')).toBeUndefined();
  });
});
