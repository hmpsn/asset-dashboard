import { describe, it, expect } from 'vitest';
import { UTILITY_SLUGS } from '../../server/schema-suggester.js';

describe('UTILITY_SLUGS regex', () => {
  it('matches error and utility pages', () => {
    expect(UTILITY_SLUGS.test('/401')).toBe(true);
    expect(UTILITY_SLUGS.test('/404')).toBe(true);
    expect(UTILITY_SLUGS.test('/privacy-policy')).toBe(true);
    expect(UTILITY_SLUGS.test('/terms')).toBe(true);
    expect(UTILITY_SLUGS.test('/terms-of-service')).toBe(true);
    expect(UTILITY_SLUGS.test('/sitemap.xml')).toBe(true);
    expect(UTILITY_SLUGS.test('/robots.txt')).toBe(true);
    expect(UTILITY_SLUGS.test('/cookie-policy')).toBe(true);
    expect(UTILITY_SLUGS.test('/maintenance')).toBe(true);
  });

  it('does not match real content pages', () => {
    expect(UTILITY_SLUGS.test('/about')).toBe(false);
    expect(UTILITY_SLUGS.test('/dental-services')).toBe(false);
    expect(UTILITY_SLUGS.test('/contact-us')).toBe(false);
    expect(UTILITY_SLUGS.test('/blog/post-1')).toBe(false);
    expect(UTILITY_SLUGS.test('/legal-services')).toBe(false);
  });
});
