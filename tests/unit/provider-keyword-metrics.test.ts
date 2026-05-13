import { describe, expect, it } from 'vitest';

import { resolvePersistedKeywordMetrics } from '../../server/provider-keyword-metrics.js';

describe('provider keyword metric persistence guard', () => {
  it('uses fresh provider metrics when available', () => {
    expect(resolvePersistedKeywordMetrics(
      { primaryKeyword: 'local seo', keywordDifficulty: 55, monthlyVolume: 900 },
      'local seo',
      { difficulty: 21, volume: 300 },
    )).toEqual({ keywordDifficulty: 21, monthlyVolume: 300 });
  });

  it('preserves existing metrics for the unchanged keyword when provider lookup misses', () => {
    expect(resolvePersistedKeywordMetrics(
      { primaryKeyword: 'local seo', keywordDifficulty: 55, monthlyVolume: 900 },
      'Local SEO',
      null,
    )).toEqual({ keywordDifficulty: 55, monthlyVolume: 900 });
  });

  it('zeros metrics for new keywords without provider confirmation', () => {
    expect(resolvePersistedKeywordMetrics(
      { primaryKeyword: 'old keyword', keywordDifficulty: 55, monthlyVolume: 900 },
      'new keyword',
      null,
    )).toEqual({ keywordDifficulty: 0, monthlyVolume: 0 });
  });
});
