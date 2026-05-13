import { describe, expect, it } from 'vitest';

import {
  normalizeSeoRewritePairs,
  normalizeSeoRewriteVariations,
} from '../../server/webflow-seo-rewrite-utils.js';
import { keywordAnalysisPersistSchema } from '../../server/schemas/page-analysis.js';

describe('SEO rewrite output normalization', () => {
  it('accepts object-wrapped variations and drops duplicate padding', () => {
    expect(normalizeSeoRewriteVariations({
      variations: [
        'Technical SEO Services That Grow Revenue',
        'Technical SEO Services That Grow Revenue',
        'Fix Site Issues Before They Cost Rankings',
        'Turn Search Problems Into Better Leads',
      ],
    }, 60)).toEqual([
      'Technical SEO Services That Grow Revenue',
      'Fix Site Issues Before They Cost Rankings',
      'Turn Search Problems Into Better Leads',
    ]);

    expect(normalizeSeoRewriteVariations({
      variations: ['One usable title', 'One usable title', 'Two usable title'],
    }, 60)).toEqual(['One usable title', 'Two usable title']);
  });

  it('rejects prose and drops dangling both-mode output', () => {
    expect(normalizeSeoRewriteVariations('Here are three options', 60)).toEqual([]);
    expect(normalizeSeoRewriteVariations({
      variations: ['One usable title', '', 42, 'Two usable title'],
    }, 60)).toEqual(['One usable title', 'Two usable title']);
    expect(normalizeSeoRewritePairs({
      pairs: [
        { title: 'SEO Services for Growth', description: 'Improve rankings with focused technical and content support.' },
        { title: 'Technical SEO That Converts', description: '' },
        { title: 'Fix Organic Search Gaps', description: 'Prioritize the pages and fixes most likely to improve qualified leads.' },
      ],
    })).toEqual([
      { title: 'SEO Services for Growth', description: 'Improve rankings with focused technical and content support.' },
      { title: 'Fix Organic Search Gaps', description: 'Prioritize the pages and fixes most likely to improve qualified leads.' },
    ]);
  });

  it('returns aligned object-wrapped title and description pairs', () => {
    expect(normalizeSeoRewritePairs({
      pairs: [
        { title: 'SEO Services for Growth', description: 'Improve rankings with focused technical and content support.' },
        { title: 'Technical SEO That Converts', description: 'Prioritize the site fixes most likely to turn search demand into leads.' },
        { title: 'Search Strategy Built to Rank', description: 'Use page-level keyword data to align content, fixes, and measurable growth.' },
      ],
    })).toEqual([
      { title: 'SEO Services for Growth', description: 'Improve rankings with focused technical and content support.' },
      { title: 'Technical SEO That Converts', description: 'Prioritize the site fixes most likely to turn search demand into leads.' },
      { title: 'Search Strategy Built to Rank', description: 'Use page-level keyword data to align content, fixes, and measurable growth.' },
    ]);
  });
});

describe('Page Intelligence analysis schema', () => {
  it('strips legacy/client-only metadata instead of rejecting auto-persist payloads', () => {
    const parsed = keywordAnalysisPersistSchema.parse({
      workspaceId: 'ws_123',
      pagePath: '/services/local-seo',
      pageTitle: 'Local SEO',
      analysis: {
        primaryKeyword: 'local SEO services',
        primaryKeywordPresence: { inTitle: true, inMeta: false, inContent: true, inSlug: true },
        secondaryKeywords: ['regional SEO'],
        longTailKeywords: ['local SEO services near me'],
        contentGaps: ['pricing'],
        competitorKeywords: ['SEO agency'],
        optimizationIssues: ['thin intro'],
        recommendations: ['expand service proof'],
        searchIntent: 'commercial',
        searchIntentConfidence: 0.82,
        optimizationScore: 76,
        estimatedDifficulty: 'medium',
        keywordDifficulty: 44,
        monthlyVolume: 900,
        topicCluster: 'local SEO',
        hasProviderMetrics: true,
      },
    });

    expect(parsed.analysis.primaryKeyword).toBe('local SEO services');
    expect('hasProviderMetrics' in parsed.analysis).toBe(false);
  });
});
