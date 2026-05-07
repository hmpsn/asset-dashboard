import { describe, expect, it } from 'vitest';
import {
  buildEffectiveAnalyses,
  buildFilteredPages,
  buildFixQueue,
} from '../../src/components/page-intelligence/pageIntelligenceData';
import type { KeywordData } from '../../src/components/page-intelligence/pageIntelligenceTypes';
import type { UnifiedPage } from '../../shared/types/page-join.js';
import type { PageKeywordMap } from '../../shared/types/workspace.js';

function strategy(overrides: Partial<PageKeywordMap> = {}): PageKeywordMap {
  return {
    pagePath: '/services',
    pageTitle: 'Services',
    primaryKeyword: 'seo services',
    secondaryKeywords: ['technical seo'],
    ...overrides,
  };
}

function page(overrides: Partial<UnifiedPage> = {}, strategyOverrides?: Partial<PageKeywordMap>): UnifiedPage {
  const pagePath = overrides.path ?? '/services';
  return {
    id: overrides.id ?? 'page-services',
    title: overrides.title ?? 'Services',
    path: pagePath,
    source: overrides.source ?? 'static',
    analyzed: overrides.analyzed ?? false,
    strategy: strategyOverrides === undefined ? strategy({ pagePath, pageTitle: overrides.title ?? 'Services' }) : strategy(strategyOverrides),
    ...overrides,
  };
}

function analysis(overrides: Partial<KeywordData> = {}): KeywordData {
  return {
    primaryKeyword: 'seo services',
    primaryKeywordPresence: { inTitle: true, inMeta: false, inContent: true, inSlug: true },
    secondaryKeywords: [],
    longTailKeywords: [],
    searchIntent: 'commercial',
    searchIntentConfidence: 0.8,
    contentGaps: [],
    competitorKeywords: [],
    optimizationScore: 82,
    optimizationIssues: [],
    recommendations: [],
    estimatedDifficulty: 'medium',
    keywordDifficulty: 45,
    monthlyVolume: 900,
    topicCluster: 'seo',
    ...overrides,
  };
}

describe('PageIntelligence data helpers', () => {
  it('hydrates persisted analyses with existing defaults and lets fresh analyses win', () => {
    const pages = [
      page(
        { id: 'persisted', title: 'Persisted' },
        {
          pagePath: '/persisted',
          pageTitle: 'Persisted',
          primaryKeyword: 'persisted keyword',
          secondaryKeywords: undefined as unknown as string[],
          analysisGeneratedAt: '2026-05-06T00:00:00.000Z',
          optimizationScore: 41,
        },
      ),
      page(
        { id: 'fresh', title: 'Fresh' },
        {
          pagePath: '/fresh',
          pageTitle: 'Fresh',
          primaryKeyword: 'old keyword',
          secondaryKeywords: ['old secondary'],
          analysisGeneratedAt: '2026-05-06T00:00:00.000Z',
          optimizationScore: 52,
        },
      ),
    ];

    const result = buildEffectiveAnalyses(pages, {
      fresh: analysis({ primaryKeyword: 'fresh keyword', optimizationScore: 91 }),
    });

    expect(result.persisted).toMatchObject({
      primaryKeyword: 'persisted keyword',
      primaryKeywordPresence: { inTitle: false, inMeta: false, inContent: false, inSlug: false },
      secondaryKeywords: [],
      searchIntent: 'informational',
      searchIntentConfidence: 0.5,
      optimizationScore: 41,
      estimatedDifficulty: 'medium',
      keywordDifficulty: 0,
      monthlyVolume: 0,
      topicCluster: '',
    });
    expect(result.fresh.primaryKeyword).toBe('fresh keyword');
    expect(result.fresh.optimizationScore).toBe(91);
  });

  it('filters by page title, path, and primary keyword', () => {
    const pages = [
      page({ id: 'title', title: 'Dental Services', path: '/dental-services' }),
      page({ id: 'path', title: 'Pricing', path: '/implant-costs' }),
      page({ id: 'keyword', title: 'About', path: '/about' }, { primaryKeyword: 'family dentist' }),
    ];

    expect(buildFilteredPages({ pages, search: 'dental', sortBy: 'priority', sortDir: 'desc', analyses: {} }).map(p => p.id)).toEqual(['title']);
    expect(buildFilteredPages({ pages, search: 'implant', sortBy: 'priority', sortDir: 'desc', analyses: {} }).map(p => p.id)).toEqual(['path']);
    expect(buildFilteredPages({ pages, search: 'family', sortBy: 'priority', sortDir: 'desc', analyses: {} }).map(p => p.id)).toEqual(['keyword']);
  });

  it('preserves sort ordering semantics', () => {
    const pages = [
      page({ id: 'low-score', path: '/low' }, { currentPosition: 18, impressions: 100, volume: 300, optimizationScore: 30 }),
      page({ id: 'high-score', path: '/high' }, { currentPosition: 4, impressions: 100, volume: 900, optimizationScore: 90 }),
      page({ id: 'fresh-score', path: '/fresh' }, { currentPosition: 30, impressions: 100, volume: 100, optimizationScore: 40 }),
    ];

    expect(buildFilteredPages({ pages, search: '', sortBy: 'priority', sortDir: 'desc', analyses: {} }).map(p => p.id)).toEqual([
      'high-score',
      'low-score',
      'fresh-score',
    ]);
    expect(buildFilteredPages({ pages, search: '', sortBy: 'position', sortDir: 'desc', analyses: {} }).map(p => p.id)).toEqual([
      'high-score',
      'low-score',
      'fresh-score',
    ]);
    expect(buildFilteredPages({ pages, search: '', sortBy: 'volume', sortDir: 'asc', analyses: {} }).map(p => p.id)).toEqual([
      'fresh-score',
      'low-score',
      'high-score',
    ]);
    expect(buildFilteredPages({
      pages,
      search: '',
      sortBy: 'score',
      sortDir: 'desc',
      analyses: { 'fresh-score': analysis({ optimizationScore: 99 }) },
    }).map(p => p.id)).toEqual([
      'fresh-score',
      'high-score',
      'low-score',
    ]);
  });

  it('builds the traffic impact fix queue with the existing score cutoff and fallback impact', () => {
    const pages = [
      page({ id: 'high-impact', path: '/high-impact' }, { impressions: 1000, optimizationScore: 50 }),
      page({ id: 'fallback-impact', path: '/fallback-impact' }, { impressions: 0, optimizationScore: 20 }),
      page({ id: 'healthy', path: '/healthy' }, { impressions: 5000, optimizationScore: 90 }),
      page({ id: 'fresh', path: '/fresh' }, { impressions: 400, optimizationScore: 90 }),
    ];

    const result = buildFixQueue(pages, {
      fresh: analysis({ optimizationScore: 25 }),
    });

    expect(result.map(item => ({ id: item.page.id, impact: item.impact, score: item.score }))).toEqual([
      { id: 'high-impact', impact: 500, score: 50 },
      { id: 'fresh', impact: 300, score: 25 },
      { id: 'fallback-impact', impact: 80, score: 20 },
    ]);
  });
});
