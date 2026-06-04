/**
 * Wave 3a — public-read byte-identity GATE for the assembler swap (#2).
 *
 * Exercises the REAL public read path `GET /api/public/seo-strategy/:id` and
 * snapshots its full payload for a table-backed workspace. Every assembler
 * consumer swap (seo-context-slice, KCC, admin route, and finally this public
 * route) must keep this payload byte-identical. The `backfilled` honesty flag
 * and all whitelisted contentGap fields MUST survive.
 *
 * Port: 13888 (exclusive; 13886 reserved for tracked-keywords-concurrency).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import { createWorkspace, updateWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { replaceAllContentGaps } from '../../server/content-gaps.js';
import { replaceAllQuickWins } from '../../server/quick-wins.js';
import { replaceAllKeywordGaps } from '../../server/keyword-gaps.js';
import { replaceAllTopicClusters } from '../../server/topic-clusters.js';
import { replaceAllCannibalizationIssues } from '../../server/cannibalization-issues.js';
import { upsertAndCleanPageKeywords } from '../../server/page-keywords.js';
import type { KeywordStrategy, ContentGap, QuickWin, KeywordGapItem, TopicCluster, CannibalizationItem, PageKeywordMap } from '../../shared/types/workspace.js';

const PORT = 13888;
const ctx = createTestContext(PORT);
const { api } = ctx;

let wsId = '';

const organicGap: ContentGap = {
  topic: 'Organic strong idea', targetKeyword: 'organic strong keyword', intent: 'informational',
  priority: 'high', rationale: 'Organically surfaced.', suggestedPageType: 'blog',
  volume: 5000, difficulty: 20, impressions: 1200, trendDirection: 'rising',
  serpFeatures: ['featured_snippet'], competitorProof: 'rival.com ranks #3',
  questionKeywords: ['how to x'], opportunityScore: 88,
};
const backfilledGap: ContentGap = {
  topic: 'Backfilled idea', targetKeyword: 'backfilled long tail keyword', intent: 'informational',
  priority: 'low', rationale: 'Re-admitted by the deterministic floor.', suggestedPageType: 'resource',
  volume: 120, difficulty: 5, opportunityScore: 30, backfilled: true,
};
const quickWin: QuickWin = { pagePath: '/services', currentKeyword: 'kw', action: 'add internal links', estimatedImpact: 'high', rationale: 'easy', roiScore: 72 };
const keywordGap: KeywordGapItem = { keyword: 'competitor keyword', volume: 800, difficulty: 25, competitorPosition: 2, competitorDomain: 'rival.com' };
const cluster: TopicCluster = { topic: 'dental implants', keywords: ['implants', 'cost'], ownedCount: 1, totalCount: 2, coveragePercent: 50, avgPosition: 7, topCompetitor: 'rival.com', topCompetitorCoverage: 80, gap: ['cost'] };
const cannibal: CannibalizationItem = {
  keyword: 'whitening', pages: [{ path: '/a', position: 4, impressions: 50, clicks: 5, source: 'gsc' }, { path: '/b', source: 'keyword_map' }],
  severity: 'medium', recommendation: 'differentiate', canonicalPath: '/a', action: 'differentiate',
};
const pageMap: PageKeywordMap[] = [{
  pagePath: '/services', pageTitle: 'Services', primaryKeyword: 'services keyword',
  secondaryKeywords: ['second'], searchIntent: 'commercial', currentPosition: 8, previousPosition: 12,
  impressions: 900, clicks: 40, volume: 1000, difficulty: 30, metricsSource: 'semrush', validated: true,
  gscKeywords: [{ query: 'services', clicks: 40, impressions: 900, position: 8 }],
}];

beforeAll(async () => {
  await ctx.startServer();
  wsId = createWorkspace(`Assembler Public Read ${PORT}`).id;
  updateWorkspace(wsId, { keywordStrategy: {
    siteKeywords: ['site keyword one', 'site keyword two'],
    siteKeywordMetrics: [{ keyword: 'site keyword one', volume: 2000, difficulty: 40 }],
    opportunities: ['opp one', 'opp two'],
    businessContext: 'A dental clinic in San Antonio.',
    generatedAt: '2026-06-01T00:00:00.000Z',
  } as KeywordStrategy });
  upsertAndCleanPageKeywords(wsId, pageMap);
  replaceAllContentGaps(wsId, [organicGap, backfilledGap]);
  replaceAllQuickWins(wsId, [quickWin]);
  replaceAllKeywordGaps(wsId, [keywordGap]);
  replaceAllTopicClusters(wsId, [cluster]);
  replaceAllCannibalizationIssues(wsId, [cannibal]);
}, 25_000);

afterAll(async () => {
  if (wsId) deleteWorkspace(wsId);
  await ctx.stopServer();
});

// The full public payload snapshot. `strategyUx` is excluded from the byte
// comparison because it is a route-layer derived projection (not assembler
// output) that can carry timestamps; it is asserted to be present separately.
interface PublicStrategy {
  siteKeywords: string[];
  siteKeywordMetrics?: { keyword: string; volume: number; difficulty: number }[];
  pageMap: unknown[];
  opportunities: string[];
  contentGaps: Array<{ targetKeyword: string; backfilled?: boolean; opportunityScore?: number; suggestedPageType?: string }>;
  quickWins: unknown[];
  keywordGaps: unknown[];
  topicClusters: unknown[];
  cannibalization: unknown[];
  businessContext: string;
  generatedAt: string | null;
  strategyUx?: unknown;
}

describe('GET /api/public/seo-strategy/:id — assembler byte-identity gate', () => {
  it('returns the full strategy with backfilled + whitelisted contentGap fields surviving', async () => {
    const res = await api(`/api/public/seo-strategy/${wsId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as PublicStrategy;

    // ── This is the EXACT public payload contract. Keep byte-identical across swaps. ──
    expect(body.siteKeywords).toEqual(['site keyword one', 'site keyword two']);
    expect(body.siteKeywordMetrics).toEqual([{ keyword: 'site keyword one', volume: 2000, difficulty: 40 }]);
    expect(body.opportunities).toEqual(['opp one', 'opp two']);
    expect(body.businessContext).toBe('A dental clinic in San Antonio.');
    expect(body.generatedAt).toBe('2026-06-01T00:00:00.000Z');

    expect(body.pageMap).toEqual([{
      pagePath: '/services', pageTitle: 'Services', primaryKeyword: 'services keyword',
      secondaryKeywords: ['second'], searchIntent: 'commercial', currentPosition: 8, previousPosition: 12,
      impressions: 900, clicks: 40, volume: 1000, difficulty: 30, metricsSource: 'semrush', validated: true,
      gscKeywords: [{ query: 'services', clicks: 40, impressions: 900, position: 8 }],
    }]);

    expect(body.contentGaps).toEqual([
      {
        topic: 'Organic strong idea', targetKeyword: 'organic strong keyword', intent: 'informational',
        priority: 'high', rationale: 'Organically surfaced.', suggestedPageType: 'blog',
        volume: 5000, difficulty: 20, impressions: 1200, trendDirection: 'rising',
        serpFeatures: ['featured_snippet'], competitorProof: 'rival.com ranks #3',
        questionKeywords: ['how to x'], opportunityScore: 88, backfilled: undefined,
      },
      {
        topic: 'Backfilled idea', targetKeyword: 'backfilled long tail keyword', intent: 'informational',
        priority: 'low', rationale: 'Re-admitted by the deterministic floor.', suggestedPageType: 'resource',
        volume: 120, difficulty: 5, impressions: undefined, trendDirection: undefined,
        serpFeatures: undefined, competitorProof: undefined, questionKeywords: undefined,
        opportunityScore: 30, backfilled: true,
      },
    ]);

    expect(body.quickWins).toEqual([{ pagePath: '/services', action: 'add internal links', estimatedImpact: 'high', rationale: 'easy', roiScore: 72 }]);
    expect(body.keywordGaps).toEqual([{ keyword: 'competitor keyword', volume: 800, difficulty: 25 }]);
    expect(body.topicClusters).toEqual([{
      topic: 'dental implants', keywords: ['implants', 'cost'], ownedCount: 1, totalCount: 2,
      coveragePercent: 50, avgPosition: 7, topCompetitor: 'rival.com', topCompetitorCoverage: 80, gap: ['cost'],
    }]);
    expect(body.cannibalization).toEqual([{
      keyword: 'whitening',
      pages: [
        { path: '/a', position: 4, impressions: 50, clicks: 5, source: 'gsc' },
        { path: '/b', position: undefined, impressions: undefined, clicks: undefined, source: 'keyword_map' },
      ],
      severity: 'medium', recommendation: 'differentiate', canonicalPath: '/a', canonicalUrl: undefined, action: 'differentiate',
    }]);

    // strategyUx is a route-layer derived projection — present but excluded from the byte snapshot.
    expect(body.strategyUx).toBeTruthy();
  });
});
