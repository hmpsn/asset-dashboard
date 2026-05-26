import { describe, expect, it } from 'vitest';
import {
  breadcrumbRef,
  buildBreadcrumb,
  filterHttpUrls,
  scrubBrandSuffix,
} from '../../server/schema/templates/helpers.js';

describe('schema template helpers', () => {
  it('filterHttpUrls keeps only absolute http(s) URLs', () => {
    const filtered = filterHttpUrls([
      'https://example.com/a.png',
      'http://example.com/b.png',
      'javascript:alert(1)',
      'data:text/plain,hello',
      '/relative/path.png',
      '',
    ]);

    expect(filtered).toEqual([
      'https://example.com/a.png',
      'http://example.com/b.png',
    ]);
  });

  it('buildBreadcrumb emits positions for meaningful breadcrumb trails', () => {
    const items = [
      { name: 'Home', url: 'https://example.com/' },
      { name: 'Services', url: 'https://example.com/services' },
    ];
    const breadcrumb = buildBreadcrumb(items, 'https://example.com/services/seo');
    expect(breadcrumb).toBeTruthy();

    const list = (breadcrumb?.itemListElement as Array<Record<string, unknown>>) ?? [];
    expect(list).toHaveLength(2);
    expect(list[0].position).toBe(1);
    expect(list[1].position).toBe(2);
  });

  it('suppresses breadcrumb ref for single-segment standalone paths', () => {
    const items = [
      { name: 'Home', url: 'https://example.com/' },
      { name: 'Book a Call', url: 'https://example.com/book-a-call' },
    ];
    expect(breadcrumbRef('https://example.com/book-a-call', items)).toBeUndefined();
  });

  it('scrubBrandSuffix removes matching trailing brand while preserving non-matches', () => {
    expect(scrubBrandSuffix('Privacy Policy | Acme Studio', 'Acme Studio')).toBe('Privacy Policy');
    expect(scrubBrandSuffix('Acme | Other Co', 'Acme Studio')).toBe('Acme | Other Co');
  });
});
