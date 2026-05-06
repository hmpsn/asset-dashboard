import { describe, expect, it } from 'vitest';
import { collectKeywordStrategySeedKeywords } from '../../server/keyword-strategy-follow-ons.js';
import type { PageKeywordMap } from '../../shared/types/workspace.js';

describe('keyword strategy follow-ons', () => {
  it('normalizes and deduplicates tracked keyword seed candidates', () => {
    const pageMap = [
      pageKeywordMap({ primaryKeyword: ' Technical SEO ' }),
      pageKeywordMap({ primaryKeyword: 'Local SEO' }),
      pageKeywordMap({ primaryKeyword: '' }),
    ];

    expect(collectKeywordStrategySeedKeywords(
      { siteKeywords: ['Technical SEO', 'content strategy', '  ', 'CONTENT STRATEGY'] },
      pageMap,
    )).toEqual(['technical seo', 'content strategy', 'local seo']);
  });

  it('falls back to page primary keywords when site keywords are absent', () => {
    expect(collectKeywordStrategySeedKeywords(
      {},
      [
        pageKeywordMap({ primaryKeyword: 'SEO Audit' }),
        pageKeywordMap({ primaryKeyword: 'seo audit' }),
      ],
    )).toEqual(['seo audit']);
  });
});

function pageKeywordMap(overrides: Partial<PageKeywordMap>): PageKeywordMap {
  return {
    pagePath: '/example',
    pageTitle: 'Example',
    primaryKeyword: 'example',
    secondaryKeywords: [],
    ...overrides,
  };
}
