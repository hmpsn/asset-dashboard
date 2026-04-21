import { describe, it, expect } from 'vitest';
import { matchPagePath, resolvePagePath } from '../../src/lib/pathUtils.js';

describe('resolvePagePath', () => {
  it('prefers publishedPath over slug', () => {
    expect(resolvePagePath({ slug: 'seo', publishedPath: '/services/seo' })).toBe('/services/seo');
  });

  it('falls back to /${slug} when publishedPath absent', () => {
    expect(resolvePagePath({ slug: 'seo' })).toBe('/seo');
  });

  it('falls back to / when both absent', () => {
    expect(resolvePagePath({})).toBe('/');
  });

  it('handles null publishedPath', () => {
    expect(resolvePagePath({ slug: 'seo', publishedPath: null })).toBe('/seo');
  });
});

describe('matchPagePath — nested page regression guard', () => {
  it('does NOT match when path is full nested path and key is bare slug', () => {
    expect(matchPagePath('/services/seo', '/seo')).toBe(false);
  });

  it('matches exact path', () => {
    expect(matchPagePath('/services/seo', '/services/seo')).toBe(true);
  });

  it('matches when both use resolvePagePath output', () => {
    const page = { slug: 'seo', publishedPath: '/services/seo' };
    expect(matchPagePath('/services/seo', resolvePagePath(page))).toBe(true);
  });
});
