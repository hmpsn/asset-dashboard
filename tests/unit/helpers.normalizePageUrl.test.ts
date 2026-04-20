import { describe, it, expect } from 'vitest';
import { normalizePageUrl } from '../../server/helpers';

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
});
