import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../server/broadcast.js', () => ({
  broadcastToWorkspace: vi.fn(),
}));

import { listContentGaps } from '../../server/content-gaps.js';
import { listPageKeywords } from '../../server/page-keywords.js';
import { persistKeywordStrategy } from '../../server/keyword-strategy-persistence.js';
import { siteSynthesisResponseSchema } from '../../server/schemas/keyword-strategy-schemas.js';
import { getWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import db from '../../server/db/index.js';
import { seedWorkspace, type SeededFullWorkspace } from '../fixtures/workspace-seed.js';

let seeded: SeededFullWorkspace;

beforeEach(() => {
  seeded = seedWorkspace({ tier: 'premium' });
});

afterEach(() => {
  db.prepare('DELETE FROM content_gaps WHERE workspace_id = ?').run(seeded.workspaceId);
  db.prepare('DELETE FROM page_keywords WHERE workspace_id = ?').run(seeded.workspaceId);
  db.prepare('DELETE FROM quick_wins WHERE workspace_id = ?').run(seeded.workspaceId);
  db.prepare('DELETE FROM keyword_gaps WHERE workspace_id = ?').run(seeded.workspaceId);
  db.prepare('DELETE FROM topic_clusters WHERE workspace_id = ?').run(seeded.workspaceId);
  db.prepare('DELETE FROM cannibalization_issues WHERE workspace_id = ?').run(seeded.workspaceId);
  db.prepare('UPDATE workspaces SET keyword_strategy = NULL WHERE id = ?').run(seeded.workspaceId);
  deleteWorkspace(seeded.workspaceId);
});

describe('keyword strategy synthesis result persistence', () => {
  it('preserves rich page-map and content-gap fields while dropping synthesis-only markers', () => {
    const ws = getWorkspace(seeded.workspaceId);
    expect(ws).toBeTruthy();

    persistKeywordStrategy({
      ws: ws!,
      strategy: {
        siteKeywords: ['platform analytics'],
        opportunities: [],
        pageMap: [
          {
            pagePath: '/services',
            pageTitle: 'Services',
            primaryKeyword: 'platform analytics',
            secondaryKeywords: ['deployment analytics'],
            searchIntent: 'commercial',
            volume: 1200,
            difficulty: 24,
            cpc: 7.5,
            metricsSource: 'dataforseo',
            secondaryMetrics: [{ keyword: 'deployment analytics', volume: 500, difficulty: 18 }],
            validated: true,
          },
        ],
        contentGaps: [
          {
            topic: 'Analytics platform guide',
            targetKeyword: 'analytics platform guide',
            intent: 'informational',
            priority: 'high',
            rationale: 'Client-requested topic with provider demand.',
            suggestedPageType: 'pillar',
            volume: 900,
            difficulty: 30,
            trendDirection: 'rising',
            serpFeatures: ['people_also_ask'],
            serpTargeting: ['faq'],
            questionKeywords: ['what is analytics platform'],
            impressions: 2000,
            competitorProof: 'competitor.example ranks #3',
            opportunityScore: 82,
            cpc: 5.25,
            backfilled: true,
            requested: true,
          },
        ],
        quickWins: [],
      },
      strategyMode: 'full',
      pagesToAnalyze: [{ path: '/services', title: 'Services', seoTitle: 'Services', seoDesc: 'Services', contentSnippet: 'Services' }],
      siteKeywordMetrics: [],
      keywordGaps: [],
      competitorKeywordData: [],
      topicClusters: [],
      cannibalization: [],
      questionKeywords: [],
      businessContext: 'Analytics platform.',
      seoDataMode: 'full',
      seoDataStatus: { mode: 'full', status: 'available', provider: 'test' },
      searchData: {
        deviceBreakdown: [],
        countryBreakdown: [],
        periodComparison: null,
        organicLandingPages: [],
        organicOverview: null,
      },
    });

    const [page] = listPageKeywords(seeded.workspaceId);
    expect(page).toMatchObject({
      pagePath: '/services',
      pageTitle: 'Services',
      primaryKeyword: 'platform analytics',
      secondaryKeywords: ['deployment analytics'],
      searchIntent: 'commercial',
      volume: 1200,
      difficulty: 24,
      cpc: 7.5,
      metricsSource: 'dataforseo',
      validated: true,
    });
    expect(page.secondaryMetrics).toEqual([{ keyword: 'deployment analytics', volume: 500, difficulty: 18 }]);

    const [gap] = listContentGaps(seeded.workspaceId);
    expect(gap).toMatchObject({
      topic: 'Analytics platform guide',
      targetKeyword: 'analytics platform guide',
      intent: 'informational',
      priority: 'high',
      rationale: 'Client-requested topic with provider demand.',
      suggestedPageType: 'pillar',
      volume: 900,
      difficulty: 30,
      trendDirection: 'rising',
      serpFeatures: ['people_also_ask'],
      serpTargeting: ['faq'],
      questionKeywords: ['what is analytics platform'],
      impressions: 2000,
      competitorProof: 'competitor.example ranks #3',
      opportunityScore: 82,
      cpc: 5.25,
      backfilled: true,
    });
    expect('requested' in gap).toBe(false);
  });

  it('persists partial OP2 content gaps with table-safe defaults', () => {
    const ws = getWorkspace(seeded.workspaceId);
    expect(ws).toBeTruthy();

    const parsed = siteSynthesisResponseSchema.parse({
      contentGaps: [
        {
          topic: 'Partial analytics gap',
          targetKeyword: 'partial analytics gap',
          intent: 'invalid-intent',
          priority: 'urgent',
          suggestedPageType: 'microsite',
        },
      ],
    });

    persistKeywordStrategy({
      ws: ws!,
      strategy: {
        siteKeywords: ['partial analytics gap'],
        opportunities: [],
        pageMap: [],
        contentGaps: parsed.contentGaps,
        quickWins: [],
      },
      strategyMode: 'full',
      pagesToAnalyze: [],
      siteKeywordMetrics: [],
      keywordGaps: [],
      competitorKeywordData: [],
      topicClusters: [],
      cannibalization: [],
      questionKeywords: [],
      businessContext: 'Analytics platform.',
      seoDataMode: 'full',
      seoDataStatus: { mode: 'full', status: 'available', provider: 'test' },
      searchData: {
        deviceBreakdown: [],
        countryBreakdown: [],
        periodComparison: null,
        organicLandingPages: [],
        organicOverview: null,
      },
    });

    expect(listContentGaps(seeded.workspaceId)).toEqual([
      expect.objectContaining({
        topic: 'Partial analytics gap',
        targetKeyword: 'partial analytics gap',
        intent: 'informational',
        priority: 'medium',
        rationale: 'AI-identified keyword opportunity.',
      }),
    ]);
    expect(listContentGaps(seeded.workspaceId)[0].suggestedPageType).toBeUndefined();
  });
});
