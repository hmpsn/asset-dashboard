/**
 * Unit tests for server/keyword-strategy-persistence.ts
 *
 * Tests the persistKeywordStrategy() function which writes keyword strategy
 * results to multiple DB tables: page_keywords, content_gaps, quick_wins,
 * keyword_gaps, topic_clusters, cannibalization_issues, and the workspace
 * keywordStrategy JSON blob.
 */

import { describe, it, expect, afterAll, beforeEach, vi } from 'vitest';
import db from '../../server/db/index.js';
import { setBroadcast } from '../../server/broadcast.js';
import { createWorkspace, deleteWorkspace, getWorkspace } from '../../server/workspaces.js';
import { listPageKeywords } from '../../server/page-keywords.js';
import { listContentGaps } from '../../server/content-gaps.js';
import { listQuickWins } from '../../server/quick-wins.js';
import { listKeywordGaps } from '../../server/keyword-gaps.js';
import { listTopicClusters } from '../../server/topic-clusters.js';
import { listCannibalizationIssues } from '../../server/cannibalization-issues.js';
import { KeywordStrategyRevisionConflictError, persistKeywordStrategy } from '../../server/keyword-strategy-persistence.js';
import { bumpKeywordStrategyGenerationRevision, getKeywordStrategyGenerationState } from '../../server/keyword-strategy-generation-store.js';
import type { GenerationProvenance } from '../../shared/types/ai-execution.js';
import type { Workspace } from '../../shared/types/workspace.js';
import type { PersistKeywordStrategyOptions } from '../../server/keyword-strategy-persistence.js';
import type { StrategyOutput } from '../../server/keyword-strategy-ai-synthesis.js';
import type { KeywordGapEntry } from '../../server/seo-data-provider.js';

// Cleanup registry
const workspaceIdsToCleanup: string[] = [];

afterAll(() => {
  for (const id of workspaceIdsToCleanup) {
    deleteWorkspace(id);
  }
});

// Initialize broadcast singleton with no-op stubs — broadcastToWorkspace()
// is called by persistKeywordStrategy() after the DB write but requires the
// singleton to be set before any call.
beforeEach(() => {
  setBroadcast(vi.fn(), vi.fn());
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeWorkspace(label: string): Workspace {
  const ws = createWorkspace(`KW Persist ${label} ${Date.now()}`);
  workspaceIdsToCleanup.push(ws.id);
  return ws;
}

function makeMinimalOptions(ws: Workspace, overrides: Partial<PersistKeywordStrategyOptions> = {}): PersistKeywordStrategyOptions {
  const strategy: StrategyOutput = {
    siteKeywords: ['test keyword', 'another keyword'],
    opportunities: ['opportunity 1'],
    contentGaps: [],
    quickWins: [],
    pageMap: [],
    ...overrides.strategy,
  };

  return {
    ws,
    strategy,
    strategyMode: 'full',
    pagesToAnalyze: [],
    siteKeywordMetrics: [],
    keywordGaps: [],
    competitorKeywordData: [],
    topicClusters: [],
    cannibalization: [],
    questionKeywords: [],
    businessContext: '',
    seoDataMode: 'none',
    seoDataStatus: {
      mode: 'none',
      status: 'disabled',
    },
    searchData: {
      deviceBreakdown: [],
      countryBreakdown: [],
      periodComparison: null,
      organicLandingPages: [],
      organicOverview: null,
    },
    ...overrides,
  };
}

const provenance: GenerationProvenance = {
  runId: 'run-k1b', operation: 'keyword-site-synthesis', provider: 'openai', model: 'gpt-5.6-luna',
  inputFingerprint: 'effective-input-sha256', startedAt: '2026-07-13T00:00:00.000Z', completedAt: '2026-07-13T00:00:01.000Z',
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('persistKeywordStrategy()', () => {
  describe('generation revision CAS', () => {
    it('persists internal provenance and advances a monotonic revision', () => {
      const ws = makeWorkspace('Revision');
      persistKeywordStrategy(makeMinimalOptions(ws, { expectedRevision: 0, provenance }));
      expect(getKeywordStrategyGenerationState(ws.id)).toEqual({ revision: 1, fingerprint: provenance.inputFingerprint, provenance });
      persistKeywordStrategy(makeMinimalOptions(getWorkspace(ws.id)!, { expectedRevision: 1, provenance: { ...provenance, runId: 'run-k1b-2' } }));
      expect(getKeywordStrategyGenerationState(ws.id).revision).toBe(2);
      expect(JSON.stringify(getWorkspace(ws.id))).not.toContain('effective-input-sha256');
    });

    it('rolls back the final save when an operator revision wins during generation', () => {
      const ws = makeWorkspace('Conflict');
      const expectedRevision = getKeywordStrategyGenerationState(ws.id).revision;
      bumpKeywordStrategyGenerationRevision(ws.id);
      expect(() => persistKeywordStrategy(makeMinimalOptions(ws, {
        expectedRevision, provenance, strategy: { siteKeywords: ['stale ai keyword'], opportunities: [] },
      }))).toThrow(KeywordStrategyRevisionConflictError);
      expect(getWorkspace(ws.id)?.keywordStrategy).toBeUndefined();
      expect(listPageKeywords(ws.id)).toEqual([]);
    });
  });
  describe('basic persistence', () => {
    it('returns a result with keywordStrategy and pageMap fields', () => {
      const ws = makeWorkspace('Basic');
      const result = persistKeywordStrategy(makeMinimalOptions(ws));

      expect(result).toBeDefined();
      expect(result).toHaveProperty('keywordStrategy');
      expect(result).toHaveProperty('pageMap');
      expect(Array.isArray(result.pageMap)).toBe(true);
    });

    it('persists siteKeywords into the workspace keywordStrategy blob', () => {
      const ws = makeWorkspace('SiteKeywords');
      persistKeywordStrategy(
        makeMinimalOptions(ws, {
          strategy: {
            siteKeywords: ['seo tools', 'keyword research'],
            opportunities: [],
          },
        }),
      );

      const reloaded = getWorkspace(ws.id);
      expect(reloaded?.keywordStrategy).toBeDefined();
      expect(reloaded!.keywordStrategy!.siteKeywords).toContain('seo tools');
      expect(reloaded!.keywordStrategy!.siteKeywords).toContain('keyword research');
    });

    it('includes generatedAt timestamp in the persisted strategy', () => {
      const ws = makeWorkspace('Timestamp');
      const before = new Date().toISOString();
      persistKeywordStrategy(makeMinimalOptions(ws));
      const after = new Date().toISOString();

      const reloaded = getWorkspace(ws.id);
      const generatedAt = reloaded?.keywordStrategy?.generatedAt;
      expect(generatedAt).toBeDefined();
      expect(generatedAt! >= before).toBe(true);
      expect(generatedAt! <= after).toBe(true);
    });

    it('stores seoDataMode and seoDataStatus in the workspace blob', () => {
      const ws = makeWorkspace('SeoDataMode');
      persistKeywordStrategy(
        makeMinimalOptions(ws, {
          seoDataMode: 'quick',
          seoDataStatus: { mode: 'quick', provider: 'semrush', status: 'available' },
        }),
      );

      const reloaded = getWorkspace(ws.id);
      expect(reloaded?.keywordStrategy?.seoDataMode).toBe('quick');
    });
  });

  describe('page_keywords table', () => {
    it('saves page keywords for each page in the pageMap', () => {
      const ws = makeWorkspace('PageKw');
      persistKeywordStrategy(
        makeMinimalOptions(ws, {
          strategy: {
            siteKeywords: [],
            opportunities: [],
            pageMap: [
              {
                pagePath: '/about',
                pageTitle: 'About Us',
                primaryKeyword: 'about company',
                secondaryKeywords: ['who we are'],
                searchIntent: 'informational',
              },
              {
                pagePath: '/services',
                pageTitle: 'Our Services',
                primaryKeyword: 'seo services',
                secondaryKeywords: ['search engine optimization'],
                searchIntent: 'commercial',
              },
            ],
          },
        }),
      );

      const pageKeywords = listPageKeywords(ws.id);
      expect(pageKeywords).toHaveLength(2);
      const paths = pageKeywords.map((pk) => pk.pagePath);
      expect(paths).toContain('/about');
      expect(paths).toContain('/services');
    });

    it('sets analysisGeneratedAt on each page entry', () => {
      const ws = makeWorkspace('PageKwTimestamp');
      const before = new Date().toISOString();
      persistKeywordStrategy(
        makeMinimalOptions(ws, {
          strategy: {
            siteKeywords: [],
            opportunities: [],
            pageMap: [
              {
                pagePath: '/home',
                pageTitle: 'Home',
                primaryKeyword: 'homepage',
                secondaryKeywords: [],
              },
            ],
          },
        }),
      );
      const after = new Date().toISOString();

      const pageKeywords = listPageKeywords(ws.id);
      expect(pageKeywords).toHaveLength(1);
      const generatedAt = pageKeywords[0].analysisGeneratedAt;
      expect(generatedAt).toBeDefined();
      expect(generatedAt! >= before).toBe(true);
      expect(generatedAt! <= after).toBe(true);
    });

    it('returns an empty pageMap when strategy has no pages', () => {
      const ws = makeWorkspace('EmptyPageMap');
      const result = persistKeywordStrategy(makeMinimalOptions(ws));

      expect(result.pageMap).toHaveLength(0);
      expect(listPageKeywords(ws.id)).toHaveLength(0);
    });
  });

  describe('content_gaps table', () => {
    it('saves content gaps when provided', () => {
      const ws = makeWorkspace('ContentGaps');
      persistKeywordStrategy(
        makeMinimalOptions(ws, {
          strategy: {
            siteKeywords: [],
            opportunities: [],
            contentGaps: [
              {
                topic: 'SEO Audit Guide',
                targetKeyword: 'how to do seo audit',
                intent: 'informational',
                priority: 'high',
                rationale: 'High volume, low difficulty, no existing page',
              },
              {
                topic: 'Keyword Research Basics',
                targetKeyword: 'keyword research for beginners',
                intent: 'informational',
                priority: 'medium',
                rationale: 'Growing trend, competitor gap',
              },
            ],
          },
        }),
      );

      const gaps = listContentGaps(ws.id);
      expect(gaps).toHaveLength(2);
      const keywords = gaps.map((g) => g.targetKeyword);
      expect(keywords).toContain('how to do seo audit');
      expect(keywords).toContain('keyword research for beginners');
    });

    it('saves content gap priority and intent fields correctly', () => {
      const ws = makeWorkspace('ContentGapFields');
      persistKeywordStrategy(
        makeMinimalOptions(ws, {
          strategy: {
            siteKeywords: [],
            opportunities: [],
            contentGaps: [
              {
                topic: 'Commercial Landing Page',
                targetKeyword: 'buy seo tools',
                intent: 'commercial',
                priority: 'high',
                rationale: 'High commercial intent',
                suggestedPageType: 'landing',
              },
            ],
          },
        }),
      );

      const gaps = listContentGaps(ws.id);
      expect(gaps).toHaveLength(1);
      expect(gaps[0].intent).toBe('commercial');
      expect(gaps[0].priority).toBe('high');
      expect(gaps[0].suggestedPageType).toBe('landing');
    });

    it('stores zero content gaps when none are provided', () => {
      const ws = makeWorkspace('NoContentGaps');
      persistKeywordStrategy(makeMinimalOptions(ws));

      expect(listContentGaps(ws.id)).toHaveLength(0);
    });
  });

  describe('quick_wins table', () => {
    it('saves quick wins when provided', () => {
      const ws = makeWorkspace('QuickWins');
      persistKeywordStrategy(
        makeMinimalOptions(ws, {
          strategy: {
            siteKeywords: [],
            opportunities: [],
            quickWins: [
              {
                pagePath: '/blog/seo-tips',
                action: 'Update meta description to include primary keyword',
                estimatedImpact: 'high',
                rationale: 'Missing keyword in meta',
                roiScore: 85,
              },
            ],
          },
        }),
      );

      const wins = listQuickWins(ws.id);
      expect(wins).toHaveLength(1);
      expect(wins[0].pagePath).toBe('/blog/seo-tips');
      expect(wins[0].estimatedImpact).toBe('high');
      expect(wins[0].roiScore).toBe(85);
    });

    it('stores zero quick wins when none are provided', () => {
      const ws = makeWorkspace('NoQuickWins');
      persistKeywordStrategy(makeMinimalOptions(ws));

      expect(listQuickWins(ws.id)).toHaveLength(0);
    });
  });

  describe('keyword_gaps table', () => {
    it('saves keyword gaps when provided', () => {
      const ws = makeWorkspace('KwGaps');
      const gaps: KeywordGapEntry[] = [
        {
          keyword: 'competitor seo tool',
          volume: 3000,
          difficulty: 55,
          competitorPosition: 2,
          competitorDomain: 'rival.com',
        },
        {
          keyword: 'backlink checker free',
          volume: 8000,
          difficulty: 40,
          competitorPosition: 5,
          competitorDomain: 'ahrefs.com',
        },
      ];
      persistKeywordStrategy(makeMinimalOptions(ws, { keywordGaps: gaps }));

      const stored = listKeywordGaps(ws.id);
      expect(stored).toHaveLength(2);
      const keywords = stored.map((g) => g.keyword);
      expect(keywords).toContain('competitor seo tool');
      expect(keywords).toContain('backlink checker free');
    });

    it('stores zero keyword gaps when none are provided', () => {
      const ws = makeWorkspace('NoKwGaps');
      persistKeywordStrategy(makeMinimalOptions(ws));

      expect(listKeywordGaps(ws.id)).toHaveLength(0);
    });
  });

  describe('topic_clusters table', () => {
    it('saves topic clusters when provided', () => {
      const ws = makeWorkspace('TopicClusters');
      persistKeywordStrategy(
        makeMinimalOptions(ws, {
          topicClusters: [
            {
              topic: 'Technical SEO',
              keywords: ['site audit', 'crawl errors', 'core web vitals'],
              ownedCount: 1,
              totalCount: 3,
              coveragePercent: 33,
              gap: ['crawl errors', 'core web vitals'],
            },
          ],
        }),
      );

      const clusters = listTopicClusters(ws.id);
      expect(clusters).toHaveLength(1);
      expect(clusters[0].topic).toBe('Technical SEO');
      expect(clusters[0].coveragePercent).toBe(33);
    });

    it('stores zero topic clusters when none are provided', () => {
      const ws = makeWorkspace('NoClusters');
      persistKeywordStrategy(makeMinimalOptions(ws));

      expect(listTopicClusters(ws.id)).toHaveLength(0);
    });
  });

  describe('cannibalization_issues table', () => {
    it('saves cannibalization issues when provided', () => {
      const ws = makeWorkspace('Cannibal');
      persistKeywordStrategy(
        makeMinimalOptions(ws, {
          cannibalization: [
            {
              keyword: 'seo audit',
              pages: [
                { path: '/services/seo', position: 5, source: 'keyword_map' },
                { path: '/blog/seo-guide', position: 8, source: 'gsc' },
              ],
              severity: 'high',
              recommendation: 'Choose one canonical page, 301 redirect the other',
              action: 'redirect_301',
            },
          ],
        }),
      );

      const issues = listCannibalizationIssues(ws.id);
      expect(issues).toHaveLength(1);
      expect(issues[0].keyword).toBe('seo audit');
      expect(issues[0].severity).toBe('high');
    });

    it('stores zero cannibalization issues when none are provided', () => {
      const ws = makeWorkspace('NoCannibal');
      persistKeywordStrategy(makeMinimalOptions(ws));

      expect(listCannibalizationIssues(ws.id)).toHaveLength(0);
    });
  });

  describe('idempotency / replace-all semantics', () => {
    it('replaces content gaps on second call rather than duplicating', () => {
      const ws = makeWorkspace('IdempotentGaps');

      persistKeywordStrategy(
        makeMinimalOptions(ws, {
          strategy: {
            siteKeywords: [],
            opportunities: [],
            contentGaps: [
              { topic: 'First Topic', targetKeyword: 'first kw', intent: 'informational', priority: 'high', rationale: 'Test' },
              { topic: 'Second Topic', targetKeyword: 'second kw', intent: 'commercial', priority: 'medium', rationale: 'Test' },
            ],
          },
        }),
      );
      expect(listContentGaps(ws.id)).toHaveLength(2);

      // Second call with different data — should replace, not append
      persistKeywordStrategy(
        makeMinimalOptions(ws, {
          strategy: {
            siteKeywords: [],
            opportunities: [],
            contentGaps: [
              { topic: 'Replacement Topic', targetKeyword: 'replacement kw', intent: 'transactional', priority: 'low', rationale: 'Replaced' },
            ],
          },
        }),
      );

      const gaps = listContentGaps(ws.id);
      expect(gaps).toHaveLength(1);
      expect(gaps[0].targetKeyword).toBe('replacement kw');
    });

    it('replaces quick wins on second call rather than duplicating', () => {
      const ws = makeWorkspace('IdempotentQW');

      persistKeywordStrategy(
        makeMinimalOptions(ws, {
          strategy: {
            siteKeywords: [],
            opportunities: [],
            quickWins: [
              { pagePath: '/page-a', action: 'Update title', estimatedImpact: 'high', rationale: 'Test' },
              { pagePath: '/page-b', action: 'Add meta', estimatedImpact: 'medium', rationale: 'Test' },
            ],
          },
        }),
      );
      expect(listQuickWins(ws.id)).toHaveLength(2);

      persistKeywordStrategy(
        makeMinimalOptions(ws, {
          strategy: {
            siteKeywords: [],
            opportunities: [],
            quickWins: [
              { pagePath: '/page-c', action: 'New win only', estimatedImpact: 'low', rationale: 'Replaced' },
            ],
          },
        }),
      );

      const wins = listQuickWins(ws.id);
      expect(wins).toHaveLength(1);
      expect(wins[0].pagePath).toBe('/page-c');
    });

    it('replaces page keywords on second full call rather than duplicating', () => {
      const ws = makeWorkspace('IdempotentPK');

      persistKeywordStrategy(
        makeMinimalOptions(ws, {
          strategy: {
            siteKeywords: [],
            opportunities: [],
            pageMap: [
              { pagePath: '/old-page', pageTitle: 'Old', primaryKeyword: 'old kw', secondaryKeywords: [] },
            ],
          },
        }),
      );
      expect(listPageKeywords(ws.id)).toHaveLength(1);

      // Full strategy mode re-persists all pages (upsertAndCleanPageKeywords)
      persistKeywordStrategy(
        makeMinimalOptions(ws, {
          strategy: {
            siteKeywords: [],
            opportunities: [],
            pageMap: [
              { pagePath: '/new-page', pageTitle: 'New', primaryKeyword: 'new kw', secondaryKeywords: [] },
            ],
          },
        }),
      );

      const pageKeywords = listPageKeywords(ws.id);
      // old-page should be cleaned up and only new-page remains
      expect(pageKeywords).toHaveLength(1);
      expect(pageKeywords[0].pagePath).toBe('/new-page');
    });

    it('updates the workspace keywordStrategy blob on second call', () => {
      const ws = makeWorkspace('IdempotentBlob');

      persistKeywordStrategy(
        makeMinimalOptions(ws, {
          strategy: { siteKeywords: ['first-kw'], opportunities: [] },
        }),
      );
      expect(getWorkspace(ws.id)?.keywordStrategy?.siteKeywords).toContain('first-kw');

      persistKeywordStrategy(
        makeMinimalOptions(ws, {
          strategy: { siteKeywords: ['second-kw'], opportunities: [] },
        }),
      );
      const reloaded = getWorkspace(ws.id);
      expect(reloaded?.keywordStrategy?.siteKeywords).toContain('second-kw');
      expect(reloaded?.keywordStrategy?.siteKeywords).not.toContain('first-kw');
    });
  });

  describe('incremental strategy mode', () => {
    it('preserves CPC and intent provenance with their values on incremental merges', () => {
      const ws = makeWorkspace('IncrementalEvidence');
      persistKeywordStrategy(makeMinimalOptions(ws, { strategy: { siteKeywords: [], opportunities: [], pageMap: [{
        pagePath: '/page', pageTitle: 'Page', primaryKeyword: 'dentist', secondaryKeywords: [],
        cpc: 8, cpcSource: 'dataforseo:exact', searchIntent: 'commercial', intentSource: 'dataforseo:ideas',
      }] } }));
      persistKeywordStrategy(makeMinimalOptions(getWorkspace(ws.id)!, {
        strategyMode: 'incremental', pagesToAnalyze: [{ path: '/page', title: 'Page', seoTitle: '', seoDesc: '', contentSnippet: '' }],
        strategy: { siteKeywords: [], opportunities: [], pageMap: [{ pagePath: '/page', pageTitle: 'Page', primaryKeyword: 'dentist', secondaryKeywords: [] }] },
      }));
      expect(listPageKeywords(ws.id)[0]).toEqual(expect.objectContaining({
        cpc: 8, cpcSource: 'dataforseo:exact', searchIntent: 'commercial', intentSource: 'dataforseo:ideas',
      }));
    });

    it('clears stale provenance when an incremental merge supplies a new value without a source', () => {
      const ws = makeWorkspace('IncrementalChangedEvidence');
      persistKeywordStrategy(makeMinimalOptions(ws, { strategy: { siteKeywords: [], opportunities: [], pageMap: [{
        pagePath: '/page', pageTitle: 'Page', primaryKeyword: 'dentist', secondaryKeywords: [],
        cpc: 8, cpcSource: 'old-cpc', searchIntent: 'commercial', intentSource: 'old-intent',
      }] } }));
      persistKeywordStrategy(makeMinimalOptions(getWorkspace(ws.id)!, {
        strategyMode: 'incremental', pagesToAnalyze: [{ path: '/page', title: 'Page', seoTitle: '', seoDesc: '', contentSnippet: '' }],
        strategy: { siteKeywords: [], opportunities: [], pageMap: [{
          pagePath: '/page', pageTitle: 'Page', primaryKeyword: 'dentist', secondaryKeywords: [], cpc: 12, searchIntent: 'transactional',
        }] },
      }));
      const page = listPageKeywords(ws.id)[0];
      expect(page).toEqual(expect.objectContaining({ cpc: 12, searchIntent: 'transactional' }));
      expect(page).not.toHaveProperty('cpcSource');
      expect(page).not.toHaveProperty('intentSource');
    });
    it('only updates specified pages in incremental mode, leaving others intact', () => {
      const ws = makeWorkspace('Incremental');

      // Seed with full strategy — two pages
      persistKeywordStrategy(
        makeMinimalOptions(ws, {
          strategy: {
            siteKeywords: [],
            opportunities: [],
            pageMap: [
              { pagePath: '/page-one', pageTitle: 'Page One', primaryKeyword: 'original one', secondaryKeywords: [] },
              { pagePath: '/page-two', pageTitle: 'Page Two', primaryKeyword: 'original two', secondaryKeywords: [] },
            ],
          },
        }),
      );
      expect(listPageKeywords(ws.id)).toHaveLength(2);

      // Incremental run — only page-one is re-analyzed and in pageMap
      persistKeywordStrategy(
        makeMinimalOptions(ws, {
          strategyMode: 'incremental',
          pagesToAnalyze: [
            { path: '/page-one', title: 'Page One', seoTitle: '', seoDesc: '', contentSnippet: '' },
          ],
          strategy: {
            siteKeywords: [],
            opportunities: [],
            pageMap: [
              { pagePath: '/page-one', pageTitle: 'Page One', primaryKeyword: 'updated one', secondaryKeywords: [] },
            ],
          },
        }),
      );

      const pageKeywords = listPageKeywords(ws.id);
      expect(pageKeywords).toHaveLength(2); // page-two still intact
      const pageOne = pageKeywords.find((p) => p.pagePath === '/page-one');
      const pageTwo = pageKeywords.find((p) => p.pagePath === '/page-two');
      expect(pageOne?.primaryKeyword).toBe('updated one');
      expect(pageTwo?.primaryKeyword).toBe('original two');
    });
  });

  describe('strategy history snapshotting', () => {
    it('archives the previous strategy to strategy_history when one exists', () => {
      const ws = makeWorkspace('History');

      // First generation — saves strategy into workspace blob
      persistKeywordStrategy(
        makeMinimalOptions(ws, {
          strategy: { siteKeywords: ['first-gen'], opportunities: [] },
        }),
      );

      // Reload workspace so the second call sees the existing generatedAt and
      // archives the first generation into strategy_history
      const wsWithStrategy = getWorkspace(ws.id)!;
      persistKeywordStrategy(
        makeMinimalOptions(wsWithStrategy, {
          strategy: { siteKeywords: ['second-gen'], opportunities: [] },
        }),
      );

      const historyRow = db.prepare('SELECT COUNT(*) as cnt FROM strategy_history WHERE workspace_id = ?').get(ws.id) as { cnt: number };
      expect(historyRow.cnt).toBeGreaterThanOrEqual(1);
    });
  });

  describe('broadcast and side-effects', () => {
    it('does not throw when broadcasting (no WS clients connected in tests)', () => {
      const ws = makeWorkspace('Broadcast');

      expect(() => {
        persistKeywordStrategy(makeMinimalOptions(ws));
      }).not.toThrow();
    });

    it('records an outcome tracking action on first strategy generation', () => {
      const ws = makeWorkspace('OutcomeTracking');

      persistKeywordStrategy(makeMinimalOptions(ws));

      const action = db.prepare(
        "SELECT COUNT(*) as cnt FROM tracked_actions WHERE workspace_id = ? AND source_type = 'strategy'",
      ).get(ws.id) as { cnt: number };
      expect(action.cnt).toBeGreaterThanOrEqual(1);
    });

    // A3 (audit #14): regeneration is a distinct trackable event — the old once-ever
    // guard (`if (!getActionBySource(...))`) suppressed every regen after the first.
    it('records a new strategy-level outcome action on each regeneration', () => {
      const ws = makeWorkspace('OutcomeRegen');

      persistKeywordStrategy(makeMinimalOptions(ws));
      persistKeywordStrategy(makeMinimalOptions(ws));

      const action = db.prepare(
        "SELECT COUNT(*) as cnt FROM tracked_actions WHERE workspace_id = ? AND source_type = 'strategy'",
      ).get(ws.id) as { cnt: number };
      expect(action.cnt).toBe(2);
    });
  });

  describe('search signals', () => {
    it('stores device breakdown in searchSignals when provided', () => {
      const ws = makeWorkspace('SearchSignals');
      persistKeywordStrategy(
        makeMinimalOptions(ws, {
          searchData: {
            deviceBreakdown: [
              { device: 'MOBILE', clicks: 1200, impressions: 30000, position: 8.2, ctr: 4.0 },
              { device: 'DESKTOP', clicks: 600, impressions: 15000, position: 6.1, ctr: 4.0 },
            ],
            countryBreakdown: [],
            periodComparison: null,
            organicLandingPages: [],
            organicOverview: null,
          },
        }),
      );

      const reloaded = getWorkspace(ws.id);
      const signals = reloaded?.keywordStrategy?.searchSignals;
      expect(signals).toBeDefined();
      expect(signals!.deviceBreakdown).toBeDefined();
      expect(signals!.deviceBreakdown).toHaveLength(2);
    });

    it('stores undefined deviceBreakdown when array is empty', () => {
      const ws = makeWorkspace('EmptySearchSignals');
      persistKeywordStrategy(makeMinimalOptions(ws));

      const reloaded = getWorkspace(ws.id);
      const signals = reloaded?.keywordStrategy?.searchSignals;
      expect(signals).toBeDefined();
      expect(signals!.deviceBreakdown).toBeUndefined();
    });
  });
});
