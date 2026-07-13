import { describe, expect, it } from 'vitest';
import { sanitizeKeywordStrategyDerivedArtifacts, sanitizeKeywordStrategyKeywordGaps, sanitizeKeywordStrategyOutput } from '../../server/keyword-strategy-sanitizer.js';
import type { KeywordStrategyKeywordPool, StrategyOutput } from '../../server/keyword-strategy-ai-synthesis.js';

function pool(entries: Array<[string, { volume: number; difficulty: number; source: string; cpc?: number; intent?: string }]> = []): KeywordStrategyKeywordPool {
  return new Map(entries);
}

const hmpsnContext = {
  workspaceId: 'ws_test',
  businessTerms: ['hmpsn studio', 'SEO analytics platform for agencies', 'keyword intelligence', 'content strategy'],
  declinedKeywords: ['cheap seo'],
  requestedKeywords: [],
  approvedKeywords: [],
  strictBusinessFit: true,
};

describe('sanitizeKeywordStrategyOutput', () => {
  it('removes blank, declined, and noisy selected strategy keywords before persistence', () => {
    const strategy: StrategyOutput = {
      siteKeywords: ['keyword intelligence', '', 'cheap seo tools', 'paper tiger'],
      pageMap: [
        {
          pagePath: '/platform',
          pageTitle: 'Platform',
          primaryKeyword: 'paper tiger',
          secondaryKeywords: ['keyword intelligence', 'cheap seo tools'],
          secondaryMetrics: [
            { keyword: 'keyword intelligence', volume: 100, difficulty: 20 },
            { keyword: 'cheap seo tools', volume: 500, difficulty: 15 },
          ],
          volume: 9000,
          difficulty: 10,
          metricsSource: 'exact',
        },
        { pagePath: '/blank', pageTitle: 'Content Strategy', primaryKeyword: '', secondaryKeywords: [] },
      ],
      contentGaps: [
        { topic: 'Bad', targetKeyword: 'typing tiger' },
        { topic: 'Good', targetKeyword: 'content strategy platform' },
        { topic: 'Declined', targetKeyword: 'cheap seo tools' },
      ],
      quickWins: [],
      opportunities: ['content strategy platform'],
    };

    const result = sanitizeKeywordStrategyOutput({
      workspaceId: 'ws_test',
      strategy,
      keywordPool: pool([
        ['keyword intelligence', { volume: 100, difficulty: 20, cpc: 4.75, intent: 'commercial', source: 'gsc' }],
        ['content strategy platform', { volume: 80, difficulty: 35, source: 'keyword_ideas' }],
        ['paper tiger', { volume: 9000, difficulty: 10, source: 'keyword_ideas' }],
        ['typing tiger', { volume: 5000, difficulty: 10, source: 'keyword_ideas' }],
      ]),
      evaluationContext: hmpsnContext,
      stage: 'post-enrichment',
    });

    expect(result.strategy.siteKeywords).toEqual(['keyword intelligence']);
    expect(result.strategy.pageMap?.map(page => page.primaryKeyword)).toEqual(['keyword intelligence', 'content strategy']);
    expect(result.strategy.pageMap?.[0].secondaryKeywords).toEqual([]);
    expect(result.strategy.pageMap?.[0].secondaryMetrics).toEqual([]);
    expect(result.strategy.pageMap?.[0].volume).toBe(100);
    expect(result.strategy.pageMap?.[0].difficulty).toBe(20);
    expect(result.strategy.pageMap?.[0].cpc).toBe(4.75);
    expect(result.strategy.pageMap?.[0].searchIntent).toBe('commercial');
    expect(result.strategy.contentGaps?.map(gap => gap.targetKeyword)).toEqual(['content strategy platform']);
    expect(result.removed.siteKeywords).toEqual(expect.arrayContaining(['', 'cheap seo tools', 'paper tiger']));
    expect(result.removed.contentGaps).toEqual(expect.arrayContaining(['typing tiger', 'cheap seo tools']));
    expect(result.repaired).toEqual(expect.arrayContaining([
      expect.objectContaining({ pagePath: '/platform', from: 'paper tiger', to: 'keyword intelligence', source: 'secondary_keyword' }),
      expect.objectContaining({ pagePath: '/blank', from: '', to: 'content strategy', source: 'page_identity' }),
    ]));
    expect(result.updatedPagePaths).toEqual(expect.arrayContaining(['/platform', '/blank']));
  });

  it('preserves legitimate noisy-looking business-name keywords', () => {
    const strategy: StrategyOutput = {
      siteKeywords: ['typing tiger'],
      pageMap: [
        { pagePath: '/', pageTitle: 'Typing Tiger', primaryKeyword: 'typing tiger', secondaryKeywords: [] },
      ],
      contentGaps: [{ topic: 'Typing lessons', targetKeyword: 'typing tiger' }],
      quickWins: [],
      opportunities: [],
    };

    const result = sanitizeKeywordStrategyOutput({
      workspaceId: 'ws_typing',
      strategy,
      keywordPool: pool([['typing tiger', { volume: 5000, difficulty: 20, source: 'keyword_ideas' }]]),
      evaluationContext: {
        workspaceId: 'ws_typing',
        businessTerms: ['Typing Tiger typing tutor app'],
        strictBusinessFit: true,
      },
      stage: 'post-enrichment',
    });

    expect(result.strategy.siteKeywords).toEqual(['typing tiger']);
    expect(result.strategy.pageMap?.[0].primaryKeyword).toBe('typing tiger');
    expect(result.strategy.contentGaps?.[0].targetKeyword).toBe('typing tiger');
    expect(result.removed.siteKeywords).toEqual([]);
  });

  it('rejects weak-fit generated keywords even when they are not known noisy phrases', () => {
    const result = sanitizeKeywordStrategyOutput({
      workspaceId: 'ws_test',
      strategy: {
        siteKeywords: ['fountain pen refills', 'content strategy'],
        pageMap: [
          { pagePath: '/', pageTitle: '', primaryKeyword: 'fountain pen refills', secondaryKeywords: [] },
        ],
        contentGaps: [{ topic: 'Weak fit', targetKeyword: 'fountain pen refills' }],
        quickWins: [],
        opportunities: [],
      },
      keywordPool: pool([
        ['content strategy', { volume: 80, difficulty: 35, source: 'keyword_ideas' }],
      ]),
      evaluationContext: hmpsnContext,
      stage: 'post-enrichment',
    });

    expect(result.strategy.siteKeywords).toEqual(['content strategy']);
    expect(result.strategy.pageMap).toEqual([]);
    expect(result.strategy.contentGaps).toEqual([]);
    expect(result.removed.pageMappings).toEqual([
      { pagePath: '/', keyword: 'fountain pen refills', reason: 'business_mismatch' },
    ]);
    expect(result.removed.contentGaps).toEqual(['fountain pen refills']);
  });

  it('defers page-identity fallback until enrichment has a chance to attach query evidence', () => {
    const result = sanitizeKeywordStrategyOutput({
      workspaceId: 'ws_test',
      strategy: {
        pageMap: [
          { pagePath: '/services/content-strategy', pageTitle: 'Content Strategy', primaryKeyword: 'paper tiger', secondaryKeywords: [] },
        ],
        siteKeywords: [],
        contentGaps: [],
        quickWins: [],
        opportunities: [],
      },
      keywordPool: pool([['paper tiger', { volume: 9000, difficulty: 10, source: 'keyword_ideas' }]]),
      evaluationContext: hmpsnContext,
      stage: 'post-synthesis',
    });

    expect(result.strategy.pageMap).toHaveLength(1);
    expect(result.strategy.pageMap?.[0]).toEqual(expect.objectContaining({
      pagePath: '/services/content-strategy',
      primaryKeyword: '',
      validated: false,
    }));
    expect(result.repaired).toEqual([]);
    expect(result.removed.pageMappings).toEqual([]);
  });

  it('drops a page mapping instead of persisting an unrecoverable blank/noisy primary keyword', () => {
    const result = sanitizeKeywordStrategyOutput({
      workspaceId: 'ws_test',
      strategy: {
        pageMap: [
          { pagePath: '/', pageTitle: '', primaryKeyword: 'typing tiger', secondaryKeywords: [] },
        ],
        siteKeywords: [],
        contentGaps: [],
        quickWins: [
          {
            pagePath: '/',
            action: 'Optimize removed noisy page',
          },
        ],
        opportunities: [],
      },
      keywordPool: pool([['typing tiger', { volume: 5000, difficulty: 20, source: 'keyword_ideas' }]]),
      evaluationContext: hmpsnContext,
      stage: 'post-enrichment',
    });

    expect(result.strategy.pageMap).toEqual([]);
    expect(result.removed.pageMappings).toEqual([
      { pagePath: '/', keyword: 'typing tiger', reason: 'noise_pattern' },
    ]);
    expect(result.strategy.quickWins).toEqual([]);
    expect(result.removed.quickWins).toEqual(['/']);
  });

  it('keeps quick wins for surviving pages after path normalization', () => {
    const result = sanitizeKeywordStrategyOutput({
      workspaceId: 'ws_test',
      strategy: {
        pageMap: [
          { pagePath: '/services', pageTitle: 'Services', primaryKeyword: 'content strategy', secondaryKeywords: [] },
        ],
        siteKeywords: [],
        contentGaps: [],
        quickWins: [
          {
            pagePath: '/services/',
            action: 'Refresh services page',
          },
        ],
        opportunities: [],
      },
      keywordPool: pool([
        ['content strategy', { volume: 80, difficulty: 35, source: 'keyword_ideas' }],
      ]),
      evaluationContext: hmpsnContext,
      stage: 'post-enrichment',
    });

    expect(result.strategy.quickWins?.map(quickWin => quickWin.pagePath)).toEqual(['/services/']);
    expect(result.removed.quickWins).toEqual([]);
  });

  it('dedupes page mappings by normalized path before persistence', () => {
    const result = sanitizeKeywordStrategyOutput({
      workspaceId: 'ws_test',
      strategy: {
        pageMap: [
          { pagePath: '/services', pageTitle: 'Services', primaryKeyword: 'content strategy', secondaryKeywords: [] },
          { pagePath: '/services/', pageTitle: 'Services Duplicate', primaryKeyword: 'keyword intelligence', secondaryKeywords: [] },
        ],
        siteKeywords: [],
        contentGaps: [],
        quickWins: [],
        opportunities: [],
      },
      keywordPool: pool([
        ['content strategy', { volume: 80, difficulty: 35, source: 'keyword_ideas' }],
        ['keyword intelligence', { volume: 100, difficulty: 20, source: 'keyword_ideas' }],
      ]),
      evaluationContext: hmpsnContext,
      stage: 'post-enrichment',
    });

    expect(result.strategy.pageMap?.map(page => page.pagePath)).toEqual(['/services']);
  });

  it('filters derived topic clusters and cannibalization artifacts after final strategy sanitation', () => {
    const result = sanitizeKeywordStrategyDerivedArtifacts({
      pageMap: [
        { pagePath: '/platform', pageTitle: 'Platform', primaryKeyword: 'keyword intelligence', secondaryKeywords: ['content strategy platform'] },
      ],
      topicClusters: [
        {
          topic: 'Mixed cluster',
          keywords: ['keyword intelligence', 'content strategy platform', 'analytics dashboard', 'paper tiger'],
          ownedCount: 0,
          totalCount: 4,
          coveragePercent: 0,
          gap: ['keyword intelligence', 'content strategy platform', 'analytics dashboard', 'paper tiger'],
        },
      ],
      cannibalization: [
        {
          keyword: 'paper tiger',
          pages: [{ path: '/platform', source: 'keyword_map' }, { path: '/old', source: 'keyword_map' }],
          severity: 'high',
          recommendation: 'Noisy stale artifact',
          action: 'differentiate',
        },
        {
          keyword: 'keyword intelligence',
          pages: [{ path: '/platform', source: 'keyword_map' }, { path: '/blog', source: 'gsc' }],
          severity: 'medium',
          recommendation: 'Useful artifact',
          action: 'differentiate',
        },
      ],
      keywordPool: pool([
        ['keyword intelligence', { volume: 100, difficulty: 20, source: 'keyword_ideas' }],
        ['content strategy platform', { volume: 80, difficulty: 35, source: 'keyword_ideas' }],
        ['analytics dashboard', { volume: 70, difficulty: 30, source: 'keyword_ideas' }],
        ['paper tiger', { volume: 9000, difficulty: 10, source: 'keyword_ideas' }],
      ]),
      evaluationContext: hmpsnContext,
      domainKeywords: [],
      competitorKeywords: [],
    });

    expect(result.topicClusters).toEqual([
      expect.objectContaining({
        keywords: ['keyword intelligence', 'content strategy platform', 'analytics dashboard'],
        totalCount: 3,
        gap: ['analytics dashboard'],
      }),
    ]);
    expect(result.cannibalization.map(issue => issue.keyword)).toEqual(['keyword intelligence']);
  });

  it('filters noisy competitor keyword gaps before persistence', () => {
    const result = sanitizeKeywordStrategyKeywordGaps({
      keywordGaps: [
        { keyword: 'keyword intelligence', volume: 100, difficulty: 20, competitorDomain: 'example.com', competitorPosition: 4 },
        { keyword: 'paper tiger', volume: 9000, difficulty: 10, competitorDomain: 'example.com', competitorPosition: 2 },
      ],
      keywordPool: pool([
        ['keyword intelligence', { volume: 100, difficulty: 20, source: 'keyword_gap' }],
        ['paper tiger', { volume: 9000, difficulty: 10, source: 'keyword_gap' }],
      ]),
      evaluationContext: hmpsnContext,
    });

    expect(result.map(gap => gap.keyword)).toEqual(['keyword intelligence']);
  });
});
