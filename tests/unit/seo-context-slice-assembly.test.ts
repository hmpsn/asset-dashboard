/**
 * tests/unit/seo-context-slice-assembly.test.ts
 *
 * Unit tests for server/intelligence/seo-context-slice.ts
 *
 * Coverage targets:
 *  1. Baseline shape — every required field present with safe defaults when
 *     workspace is null / all subsystems fail.
 *  2. Voice profile authority layering — calibrated vs uncalibrated vs absent
 *     determines which block is exposed as effectiveBrandVoiceBlock.
 *  3. Page map population — from live table (livePageMap) when available;
 *     fallback to stored strategy.pageMap; empty when both fail.
 *  4. Content gap population — from live content_gaps table; empty on failure.
 *  5. Rank tracking assembly — all fields; improved/declined/stable math; graceful
 *     degradation when module throws.
 *  6. serpFeatures aggregation — counts per feature type from livePageMap;
 *     absent when livePageMap is empty.
 *  7. discoveredQuerySummary — populated on success; absent on failure.
 *  8. businessProfile assembly — from intelligenceProfile + businessPriorities +
 *     businessProfile (contact); dedup on merge; absent when no data.
 *  9. strategyHistory — populated from DB rows; absent on query failure.
 * 10. Backlink enrichment — opt-in gate; skips on unconfigured provider; degrades
 *     on error.
 * 11. pageKeywords — populated when opts.pagePath matches a page map entry.
 */

import { beforeEach, describe, it, expect, vi } from 'vitest';
import type { Workspace, PageKeywordMap, KeywordStrategy, ContentGap } from '../../shared/types/workspace.js';
import type { SeoContextSlice } from '../../shared/types/intelligence.js';

// ── vi.mock declarations must come before any real import that loads the
//    module under test — Vitest hoists vi.mock() calls to the top, which
//    intercepts both static and dynamic imports. ─────────────────────────

vi.mock('../../server/logger.js', () => ({
  createLogger: () => ({
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  }),
}));

// The slice has module-level createStmtCache() call that evaluates at import
// time.  Mocking stmt-cache means its factory runs against the mock db below.
vi.mock('../../server/db/stmt-cache.js', () => ({
  createStmtCache: (factory: () => unknown) => factory,
}));

// db.prepare is called in the stmt factory — mock it to return a no-op stmt.
const mockStrategyHistoryAll = vi.fn(() => [] as Array<{ generated_at: string }>);
vi.mock('../../server/db/index.js', () => ({
  default: {
    prepare: vi.fn(() => ({
      get: vi.fn(),
      all: mockStrategyHistoryAll,
      run: vi.fn(),
    })),
  },
}));

// Static imports used by the slice but not dynamic-import-gated ─────────────

const mockGetRawBrandVoice = vi.fn(() => '');
const mockGetRawKnowledge = vi.fn(() => '');
const mockBuildEffectiveBrandVoiceBlock = vi.fn(() => '');
vi.mock('../../server/intelligence/seo-context-source.js', () => ({
  getRawBrandVoice: (...args: unknown[]) => mockGetRawBrandVoice(...args),
  getRawKnowledge: (...args: unknown[]) => mockGetRawKnowledge(...args),
  buildEffectiveBrandVoiceBlock: (...args: unknown[]) => mockBuildEffectiveBrandVoiceBlock(...args),
}));

const mockFindPageMapEntry = vi.fn(() => undefined as PageKeywordMap | undefined);
vi.mock('../../server/helpers.js', () => ({
  findPageMapEntry: (...args: unknown[]) => mockFindPageMapEntry(...args),
  normalizePageUrl: (p: string) => p,
}));

vi.mock('../../server/social-profiles.js', () => ({
  normalizeSocialProfiles: (profiles: string[] | undefined | null) => {
    if (profiles == null) return undefined;
    return profiles.filter(Boolean);
  },
}));

// Dynamic imports — the slice lazy-loads these inside try/catch blocks ────────

const mockGetWorkspace = vi.fn(() => undefined as Workspace | undefined);
vi.mock('../../server/workspaces.js', () => ({
  getWorkspace: (...args: unknown[]) => mockGetWorkspace(...args),
}));

const mockListPageKeywords = vi.fn(() => [] as PageKeywordMap[]);
vi.mock('../../server/page-keywords.js', () => ({
  listPageKeywords: (...args: unknown[]) => mockListPageKeywords(...args),
}));

const mockListContentGaps = vi.fn(() => [] as ContentGap[]);
vi.mock('../../server/content-gaps.js', () => ({
  listContentGaps: (...args: unknown[]) => mockListContentGaps(...args),
}));

const mockGetTrackedKeywords = vi.fn(() => [] as Array<{ query: string }>);
const mockGetLatestRanks = vi.fn(() => [] as Array<{ query: string; position: number; clicks: number; impressions: number; ctr: number; change?: number }>);
vi.mock('../../server/rank-tracking.js', () => ({
  getTrackedKeywords: (...args: unknown[]) => mockGetTrackedKeywords(...args),
  getLatestRanks: (...args: unknown[]) => mockGetLatestRanks(...args),
}));

const mockGetDiscoveredQuerySummary = vi.fn(() => ({
  totalDiscovered: 0,
  lostVisibilityCount: 0,
  topLostQueries: [],
}));
vi.mock('../../server/client-discovered-queries.js', () => ({
  getDiscoveredQuerySummary: (...args: unknown[]) => mockGetDiscoveredQuerySummary(...args),
}));

const mockGetBacklinksProvider = vi.fn(() => null as null | { isConfigured: () => boolean; getBacklinksOverview: (domain: string, workspaceId: string) => Promise<{ totalBacklinks: number; referringDomains: number } | null> });
vi.mock('../../server/seo-data-provider.js', () => ({
  getBacklinksProvider: (...args: unknown[]) => mockGetBacklinksProvider(...args),
}));

// PR6 (Spine D) — new slice reads: quick wins (SI1), cannibalization (SI4), top opportunity (SI2/MW6)
import type { QuickWin, CannibalizationItem } from '../../shared/types/workspace.js';
import type { RecommendationSet } from '../../shared/types/recommendations.js';

const mockListQuickWins = vi.fn(() => [] as QuickWin[]);
vi.mock('../../server/quick-wins.js', () => ({
  listQuickWins: (...args: unknown[]) => mockListQuickWins(...args),
}));

const mockListCannibalizationIssues = vi.fn(() => [] as CannibalizationItem[]);
vi.mock('../../server/cannibalization-issues.js', () => ({
  listCannibalizationIssues: (...args: unknown[]) => mockListCannibalizationIssues(...args),
}));

const mockLoadRecommendations = vi.fn(() => null as RecommendationSet | null);
vi.mock('../../server/recommendations.js', () => ({
  loadRecommendations: (...args: unknown[]) => mockLoadRecommendations(...args),
}));

// ── Real import (after all mocks) ─────────────────────────────────────────────

import { assembleSeoContext } from '../../server/intelligence/seo-context-slice.js';

// ── Test helpers ───────────────────────────────────────────────────────────────

function makeWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: 'ws-test',
    name: 'Test Workspace',
    folder: 'test-folder',
    createdAt: '2026-01-01T00:00:00Z',
    personas: [],
    ...overrides,
  };
}

function makePageKeywordMap(pagePath: string, overrides: Partial<PageKeywordMap> = {}): PageKeywordMap {
  return {
    pagePath,
    pageTitle: `Page ${pagePath}`,
    primaryKeyword: 'test keyword',
    secondaryKeywords: [],
    ...overrides,
  };
}

function makeContentGap(topic: string): ContentGap {
  return {
    topic,
    targetKeyword: `${topic} keyword`,
    intent: 'informational',
    priority: 'medium',
    rationale: 'Good opportunity',
  };
}

function makeKeywordStrategy(overrides: Partial<KeywordStrategy> = {}): KeywordStrategy {
  return {
    businessContext: 'A test business',
    targetKeywords: [],
    contentGaps: [],
    quickWins: [],
    summary: 'Test strategy',
    generatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  } as KeywordStrategy;
}

// ── Reset all mocks to safe defaults before each test ────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockGetWorkspace.mockReturnValue(undefined);
  mockListPageKeywords.mockReturnValue([]);
  mockListContentGaps.mockReturnValue([]);
  mockGetTrackedKeywords.mockReturnValue([]);
  mockGetLatestRanks.mockReturnValue([]);
  mockGetDiscoveredQuerySummary.mockReturnValue({ totalDiscovered: 0, lostVisibilityCount: 0, topLostQueries: [] });
  mockGetBacklinksProvider.mockReturnValue(null);
  mockGetRawBrandVoice.mockReturnValue('');
  mockGetRawKnowledge.mockReturnValue('');
  mockBuildEffectiveBrandVoiceBlock.mockReturnValue('');
  mockFindPageMapEntry.mockReturnValue(undefined);
  mockStrategyHistoryAll.mockReturnValue([]);
  mockListQuickWins.mockReturnValue([]);
  mockListCannibalizationIssues.mockReturnValue([]);
  mockLoadRecommendations.mockReturnValue(null);
});

// ════════════════════════════════════════════════════════════════════════════
// 1. Baseline shape & graceful degradation
// ════════════════════════════════════════════════════════════════════════════

describe('baseline shape when workspace is null', () => {
  it('returns a valid SeoContextSlice without throwing when workspace is undefined', async () => {
    mockGetWorkspace.mockReturnValue(undefined);

    const result = await assembleSeoContext('ws-missing');

    expect(result).toBeDefined();
    expect(typeof result).toBe('object');
  });

  it('strategy is undefined when workspace has no keywordStrategy', async () => {
    mockGetWorkspace.mockReturnValue(makeWorkspace({ keywordStrategy: undefined }));

    const result = await assembleSeoContext('ws-no-strategy');

    expect(result.strategy).toBeUndefined();
  });

  it('brandVoice defaults to empty string when workspace is missing', async () => {
    mockGetWorkspace.mockReturnValue(undefined);
    mockGetRawBrandVoice.mockReturnValue('');

    const result = await assembleSeoContext('ws-missing');

    expect(result.brandVoice).toBe('');
  });

  it('knowledgeBase defaults to empty string when workspace is missing', async () => {
    mockGetWorkspace.mockReturnValue(undefined);
    mockGetRawKnowledge.mockReturnValue('');

    const result = await assembleSeoContext('ws-missing');

    expect(result.knowledgeBase).toBe('');
  });

  it('personas defaults to empty array when workspace is missing', async () => {
    mockGetWorkspace.mockReturnValue(undefined);

    const result = await assembleSeoContext('ws-missing');

    expect(result.personas).toEqual([]);
  });

  it('businessContext defaults to empty string when workspace has no strategy', async () => {
    mockGetWorkspace.mockReturnValue(makeWorkspace({ keywordStrategy: undefined }));

    const result = await assembleSeoContext('ws-no-strategy');

    expect(result.businessContext).toBe('');
  });

  it('does not include rankTracking when rank-tracking module throws', async () => {
    mockGetWorkspace.mockReturnValue(makeWorkspace());
    mockGetTrackedKeywords.mockImplementation(() => { throw new Error('table missing'); });

    const result = await assembleSeoContext('ws-rank-throws');

    expect(result.rankTracking).toBeUndefined();
  });

  it('does not include discoveredQuerySummary when module throws', async () => {
    mockGetWorkspace.mockReturnValue(makeWorkspace());
    mockGetDiscoveredQuerySummary.mockImplementation(() => { throw new Error('table missing'); });

    const result = await assembleSeoContext('ws-dqs-throws');

    expect(result.discoveredQuerySummary).toBeUndefined();
  });

  it('does not include strategyHistory when DB query throws', async () => {
    mockGetWorkspace.mockReturnValue(makeWorkspace());
    mockStrategyHistoryAll.mockImplementation(() => { throw new Error('no such table: strategy_history'); });

    const result = await assembleSeoContext('ws-sh-throws');

    expect(result.strategyHistory).toBeUndefined();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 2. Voice profile authority layering
// ════════════════════════════════════════════════════════════════════════════

describe('effectiveBrandVoiceBlock — voice profile authority', () => {
  it('exposes the block returned by buildEffectiveBrandVoiceBlock', async () => {
    mockGetWorkspace.mockReturnValue(makeWorkspace());
    mockBuildEffectiveBrandVoiceBlock.mockReturnValue('\n\nBRAND VOICE PROFILE...');

    const result = await assembleSeoContext('ws-voice');

    expect(result.effectiveBrandVoiceBlock).toBe('\n\nBRAND VOICE PROFILE...');
  });

  it('effectiveBrandVoiceBlock is empty string when buildEffectiveBrandVoiceBlock returns empty', async () => {
    mockGetWorkspace.mockReturnValue(makeWorkspace());
    mockBuildEffectiveBrandVoiceBlock.mockReturnValue('');

    const result = await assembleSeoContext('ws-no-voice');

    expect(result.effectiveBrandVoiceBlock).toBe('');
  });

  it('brandVoice raw field reflects getRawBrandVoice output (not the effective block)', async () => {
    mockGetWorkspace.mockReturnValue(makeWorkspace({ brandVoice: 'raw voice text' }));
    mockGetRawBrandVoice.mockReturnValue('raw voice text');
    mockBuildEffectiveBrandVoiceBlock.mockReturnValue('\n\nBRAND VOICE PROFILE (calibrated)...');

    const result = await assembleSeoContext('ws-voice-split');

    // Raw field should be the raw workspace.brandVoice string
    expect(result.brandVoice).toBe('raw voice text');
    // Effective block should reflect the authority-resolved block
    expect(result.effectiveBrandVoiceBlock).toBe('\n\nBRAND VOICE PROFILE (calibrated)...');
    // They must be distinct values when voice profile authority is in play
    expect(result.brandVoice).not.toBe(result.effectiveBrandVoiceBlock);
  });

  it('effectiveBrandVoiceBlock uses legacy voice block when buildEffectiveBrandVoiceBlock returns legacy format', async () => {
    mockGetWorkspace.mockReturnValue(makeWorkspace({ brandVoice: 'legacy brand voice' }));
    mockGetRawBrandVoice.mockReturnValue('legacy brand voice');
    mockBuildEffectiveBrandVoiceBlock.mockReturnValue('\n\nBRAND VOICE & STYLE (you MUST match this voice — do not deviate):\nlegacy brand voice');

    const result = await assembleSeoContext('ws-legacy-voice');

    expect(result.effectiveBrandVoiceBlock).toContain('BRAND VOICE & STYLE');
    expect(result.effectiveBrandVoiceBlock).toContain('legacy brand voice');
  });

  it('builds effectiveBrandVoiceBlock using workspaceId (not workspace object)', async () => {
    mockGetWorkspace.mockReturnValue(makeWorkspace());
    mockBuildEffectiveBrandVoiceBlock.mockReturnValue('profile block');

    await assembleSeoContext('my-specific-workspace-id');

    expect(mockBuildEffectiveBrandVoiceBlock).toHaveBeenCalledWith('my-specific-workspace-id');
  });

  it('calls getRawBrandVoice with the workspaceId', async () => {
    mockGetWorkspace.mockReturnValue(makeWorkspace());

    await assembleSeoContext('targeted-ws');

    expect(mockGetRawBrandVoice).toHaveBeenCalledWith('targeted-ws');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 3. Page map population
// ════════════════════════════════════════════════════════════════════════════

describe('page map population', () => {
  it('uses livePageMap when listPageKeywords returns entries', async () => {
    const livePage = makePageKeywordMap('/about');
    mockGetWorkspace.mockReturnValue(makeWorkspace({
      keywordStrategy: makeKeywordStrategy({ pageMap: [] }),
    }));
    mockListPageKeywords.mockReturnValue([livePage]);

    const result = await assembleSeoContext('ws-live-pm');

    expect(result.strategy?.pageMap).toHaveLength(1);
    expect(result.strategy?.pageMap?.[0].pagePath).toBe('/about');
  });

  it('falls back to stored strategy.pageMap when listPageKeywords returns empty', async () => {
    const storedPage = makePageKeywordMap('/stored-page');
    mockGetWorkspace.mockReturnValue(makeWorkspace({
      keywordStrategy: makeKeywordStrategy({ pageMap: [storedPage] }),
    }));
    mockListPageKeywords.mockReturnValue([]);

    const result = await assembleSeoContext('ws-stored-pm');

    expect(result.strategy?.pageMap).toHaveLength(1);
    expect(result.strategy?.pageMap?.[0].pagePath).toBe('/stored-page');
  });

  it('prefers livePageMap over stored pageMap when both are present', async () => {
    const storedPage = makePageKeywordMap('/stored');
    const livePage = makePageKeywordMap('/live');
    mockGetWorkspace.mockReturnValue(makeWorkspace({
      keywordStrategy: makeKeywordStrategy({ pageMap: [storedPage] }),
    }));
    mockListPageKeywords.mockReturnValue([livePage]);

    const result = await assembleSeoContext('ws-prefer-live');

    expect(result.strategy?.pageMap?.[0].pagePath).toBe('/live');
  });

  it('strategy.pageMap is undefined when listPageKeywords throws and no stored pageMap', async () => {
    mockGetWorkspace.mockReturnValue(makeWorkspace({
      keywordStrategy: makeKeywordStrategy({ pageMap: undefined }),
    }));
    mockListPageKeywords.mockImplementation(() => { throw new Error('page_keywords table missing'); });

    const result = await assembleSeoContext('ws-pm-throws');

    // strategy is defined (workspace has keywordStrategy), but pageMap fallback is undefined
    expect(result.strategy).toBeDefined();
    expect(result.strategy?.pageMap).toBeUndefined();
  });

  it('falls back to stored pageMap when listPageKeywords throws and stored pageMap exists', async () => {
    const storedPage = makePageKeywordMap('/fallback');
    mockGetWorkspace.mockReturnValue(makeWorkspace({
      keywordStrategy: makeKeywordStrategy({ pageMap: [storedPage] }),
    }));
    mockListPageKeywords.mockImplementation(() => { throw new Error('table missing'); });

    const result = await assembleSeoContext('ws-pm-throws-fallback');

    expect(result.strategy?.pageMap?.[0].pagePath).toBe('/fallback');
  });

  it('strategy is undefined (not null) when workspace has no keywordStrategy', async () => {
    mockGetWorkspace.mockReturnValue(makeWorkspace({ keywordStrategy: undefined }));

    const result = await assembleSeoContext('ws-no-ks');

    // Source reads: workspace?.keywordStrategy ? ... : workspace?.keywordStrategy
    // Both branches return undefined when workspace.keywordStrategy is undefined
    expect(result.strategy).toBeUndefined();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 4. Content gap population
// ════════════════════════════════════════════════════════════════════════════

describe('content gap population', () => {
  it('populates contentGaps from listContentGaps when available', async () => {
    const gap = makeContentGap('local SEO');
    mockGetWorkspace.mockReturnValue(makeWorkspace({
      keywordStrategy: makeKeywordStrategy(),
    }));
    mockListContentGaps.mockReturnValue([gap]);

    const result = await assembleSeoContext('ws-gaps');

    expect(result.strategy?.contentGaps).toHaveLength(1);
    expect(result.strategy?.contentGaps?.[0].topic).toBe('local SEO');
  });

  it('contentGaps is empty array when listContentGaps returns nothing', async () => {
    mockGetWorkspace.mockReturnValue(makeWorkspace({
      keywordStrategy: makeKeywordStrategy(),
    }));
    mockListContentGaps.mockReturnValue([]);

    const result = await assembleSeoContext('ws-no-gaps');

    expect(result.strategy?.contentGaps).toEqual([]);
  });

  it('contentGaps is empty array when listContentGaps throws', async () => {
    mockGetWorkspace.mockReturnValue(makeWorkspace({
      keywordStrategy: makeKeywordStrategy(),
    }));
    mockListContentGaps.mockImplementation(() => { throw new Error('content_gaps table missing'); });

    const result = await assembleSeoContext('ws-gaps-throws');

    // Degrades gracefully — liveContentGaps stays []
    expect(result.strategy?.contentGaps).toEqual([]);
  });

  it('does not throw even when both page-keywords and content-gaps modules throw', async () => {
    mockGetWorkspace.mockReturnValue(makeWorkspace({ keywordStrategy: makeKeywordStrategy() }));
    mockListPageKeywords.mockImplementation(() => { throw new Error('pk fail'); });
    mockListContentGaps.mockImplementation(() => { throw new Error('cg fail'); });

    await expect(assembleSeoContext('ws-both-throws')).resolves.toBeDefined();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 5. Rank tracking assembly
// ════════════════════════════════════════════════════════════════════════════

describe('rankTracking assembly', () => {
  it('populates rankTracking when tracked keywords and ranks are present', async () => {
    mockGetWorkspace.mockReturnValue(makeWorkspace());
    mockGetTrackedKeywords.mockReturnValue([
      { query: 'seo agency' },
      { query: 'web design' },
    ]);
    mockGetLatestRanks.mockReturnValue([
      { query: 'seo agency', position: 3, clicks: 10, impressions: 100, ctr: 0.1, change: -2 },
      { query: 'web design', position: 7, clicks: 5, impressions: 80, ctr: 0.06, change: 1 },
    ]);

    const result = await assembleSeoContext('ws-rank');

    expect(result.rankTracking).toBeDefined();
    expect(result.rankTracking?.trackedKeywords).toBe(2);
  });

  it('computes avgPosition as mean of positive positions', async () => {
    mockGetWorkspace.mockReturnValue(makeWorkspace());
    mockGetTrackedKeywords.mockReturnValue([{ query: 'kw1' }, { query: 'kw2' }]);
    mockGetLatestRanks.mockReturnValue([
      { query: 'kw1', position: 4, clicks: 1, impressions: 10, ctr: 0.1 },
      { query: 'kw2', position: 6, clicks: 1, impressions: 10, ctr: 0.1 },
    ]);

    const result = await assembleSeoContext('ws-avg');

    expect(result.rankTracking?.avgPosition).toBe(5); // (4 + 6) / 2
  });

  it('excludes position 0 from avgPosition calculation', async () => {
    mockGetWorkspace.mockReturnValue(makeWorkspace());
    mockGetTrackedKeywords.mockReturnValue([{ query: 'kw1' }, { query: 'kw2' }]);
    mockGetLatestRanks.mockReturnValue([
      { query: 'kw1', position: 0, clicks: 0, impressions: 0, ctr: 0 },
      { query: 'kw2', position: 10, clicks: 1, impressions: 10, ctr: 0.1 },
    ]);

    const result = await assembleSeoContext('ws-zero-pos');

    // Position 0 is filtered out — only position 10 counts
    expect(result.rankTracking?.avgPosition).toBe(10);
  });

  it('avgPosition is null when all positions are 0 or no ranks exist', async () => {
    mockGetWorkspace.mockReturnValue(makeWorkspace());
    mockGetTrackedKeywords.mockReturnValue([{ query: 'kw1' }]);
    mockGetLatestRanks.mockReturnValue([
      { query: 'kw1', position: 0, clicks: 0, impressions: 0, ctr: 0 },
    ]);

    const result = await assembleSeoContext('ws-no-valid-pos');

    expect(result.rankTracking?.avgPosition).toBeNull();
  });

  it('counts improved = negative change (position number dropped = moved up)', async () => {
    mockGetWorkspace.mockReturnValue(makeWorkspace());
    mockGetTrackedKeywords.mockReturnValue([{ query: 'a' }, { query: 'b' }, { query: 'c' }]);
    mockGetLatestRanks.mockReturnValue([
      { query: 'a', position: 2, clicks: 1, impressions: 10, ctr: 0.1, change: -3 }, // improved
      { query: 'b', position: 5, clicks: 1, impressions: 10, ctr: 0.1, change: 2 },  // declined
      { query: 'c', position: 8, clicks: 1, impressions: 10, ctr: 0.1, change: 0 },  // stable (change === 0)
    ]);

    const result = await assembleSeoContext('ws-changes');

    expect(result.rankTracking?.positionChanges.improved).toBe(1);
    expect(result.rankTracking?.positionChanges.declined).toBe(1);
    expect(result.rankTracking?.positionChanges.stable).toBe(1);
  });

  it('stable count = total - improved - declined', async () => {
    mockGetWorkspace.mockReturnValue(makeWorkspace());
    mockGetTrackedKeywords.mockReturnValue([{ query: 'a' }, { query: 'b' }, { query: 'c' }, { query: 'd' }]);
    mockGetLatestRanks.mockReturnValue([
      { query: 'a', position: 1, clicks: 0, impressions: 0, ctr: 0, change: -1 }, // improved
      { query: 'b', position: 2, clicks: 0, impressions: 0, ctr: 0, change: -2 }, // improved
      { query: 'c', position: 3, clicks: 0, impressions: 0, ctr: 0, change: 1 },  // declined
      { query: 'd', position: 4, clicks: 0, impressions: 0, ctr: 0 },              // no change field → treated as stable (change ?? 0 = 0)
    ]);

    const result = await assembleSeoContext('ws-stable');

    expect(result.rankTracking?.positionChanges.improved).toBe(2);
    expect(result.rankTracking?.positionChanges.declined).toBe(1);
    expect(result.rankTracking?.positionChanges.stable).toBe(1);
  });

  it('trackedKeywords reflects the count from getTrackedKeywords', async () => {
    mockGetWorkspace.mockReturnValue(makeWorkspace());
    mockGetTrackedKeywords.mockReturnValue([
      { query: 'kw1' }, { query: 'kw2' }, { query: 'kw3' },
    ]);
    mockGetLatestRanks.mockReturnValue([]);

    const result = await assembleSeoContext('ws-tracked-count');

    expect(result.rankTracking?.trackedKeywords).toBe(3);
  });

  it('rankTracking is absent when rank-tracking module throws', async () => {
    mockGetWorkspace.mockReturnValue(makeWorkspace());
    mockGetTrackedKeywords.mockImplementation(() => { throw new Error('no such table: rank_snapshots'); });

    const result = await assembleSeoContext('ws-rank-fail');

    expect(result.rankTracking).toBeUndefined();
  });

  it('rankTracking is absent when getLatestRanks throws', async () => {
    mockGetWorkspace.mockReturnValue(makeWorkspace());
    mockGetTrackedKeywords.mockReturnValue([{ query: 'kw1' }]);
    mockGetLatestRanks.mockImplementation(() => { throw new Error('snap table missing'); });

    const result = await assembleSeoContext('ws-latest-rank-fail');

    expect(result.rankTracking).toBeUndefined();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 6. serpFeatures aggregation
// ════════════════════════════════════════════════════════════════════════════

describe('serpFeatures aggregation', () => {
  it('serpFeatures is absent when livePageMap is empty', async () => {
    mockGetWorkspace.mockReturnValue(makeWorkspace());
    mockListPageKeywords.mockReturnValue([]);

    const result = await assembleSeoContext('ws-no-serp');

    expect(result.serpFeatures).toBeUndefined();
  });

  it('serpFeatures is absent when livePageMap throws (livePageMap stays [])', async () => {
    mockGetWorkspace.mockReturnValue(makeWorkspace());
    mockListPageKeywords.mockImplementation(() => { throw new Error('pk fail'); });

    const result = await assembleSeoContext('ws-serp-throw');

    expect(result.serpFeatures).toBeUndefined();
  });

  it('serpFeatures is absent when livePageMap entries have no serpFeatures', async () => {
    mockGetWorkspace.mockReturnValue(makeWorkspace());
    mockListPageKeywords.mockReturnValue([
      makePageKeywordMap('/page-a', { serpFeatures: [] }),
      makePageKeywordMap('/page-b', { serpFeatures: undefined }),
    ]);

    const result = await assembleSeoContext('ws-empty-serp');

    expect(result.serpFeatures).toBeUndefined();
  });

  it('counts featuredSnippets correctly from all pages', async () => {
    mockGetWorkspace.mockReturnValue(makeWorkspace());
    mockListPageKeywords.mockReturnValue([
      makePageKeywordMap('/a', { serpFeatures: ['featured_snippet', 'people_also_ask'] }),
      makePageKeywordMap('/b', { serpFeatures: ['featured_snippet'] }),
      makePageKeywordMap('/c', { serpFeatures: ['video'] }),
    ]);

    const result = await assembleSeoContext('ws-serp-counts');

    expect(result.serpFeatures?.featuredSnippets).toBe(2);
    expect(result.serpFeatures?.peopleAlsoAsk).toBe(1);
    expect(result.serpFeatures?.videoCarousel).toBe(1);
    expect(result.serpFeatures?.localPack).toBe(false);
  });

  it('localPack is true when any page has local_pack serp feature', async () => {
    mockGetWorkspace.mockReturnValue(makeWorkspace());
    mockListPageKeywords.mockReturnValue([
      makePageKeywordMap('/home', { serpFeatures: ['local_pack'] }),
    ]);

    const result = await assembleSeoContext('ws-localpack');

    expect(result.serpFeatures?.localPack).toBe(true);
  });

  it('localPack is false when no page has local_pack', async () => {
    mockGetWorkspace.mockReturnValue(makeWorkspace());
    mockListPageKeywords.mockReturnValue([
      makePageKeywordMap('/home', { serpFeatures: ['featured_snippet'] }),
    ]);

    const result = await assembleSeoContext('ws-no-localpack');

    expect(result.serpFeatures?.localPack).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 7. discoveredQuerySummary
// ════════════════════════════════════════════════════════════════════════════

describe('discoveredQuerySummary', () => {
  it('populates discoveredQuerySummary on success', async () => {
    mockGetWorkspace.mockReturnValue(makeWorkspace());
    mockGetDiscoveredQuerySummary.mockReturnValue({
      totalDiscovered: 42,
      lostVisibilityCount: 7,
      topLostQueries: [{ query: 'test query', lastPosition: 5, lastSeen: '2026-01-01', totalImpressions: 100 }],
    });

    const result = await assembleSeoContext('ws-dqs');

    expect(result.discoveredQuerySummary?.totalDiscovered).toBe(42);
    expect(result.discoveredQuerySummary?.lostVisibilityCount).toBe(7);
    expect(result.discoveredQuerySummary?.topLostQueries).toHaveLength(1);
  });

  it('discoveredQuerySummary is absent when module throws', async () => {
    mockGetWorkspace.mockReturnValue(makeWorkspace());
    mockGetDiscoveredQuerySummary.mockImplementation(() => { throw new Error('no such table: discovered_queries'); });

    const result = await assembleSeoContext('ws-dqs-fail');

    expect(result.discoveredQuerySummary).toBeUndefined();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 8. businessProfile assembly
// ════════════════════════════════════════════════════════════════════════════

describe('businessProfile assembly', () => {
  it('businessProfile is absent when workspace has no intelligenceProfile or businessPriorities', async () => {
    mockGetWorkspace.mockReturnValue(makeWorkspace({
      intelligenceProfile: undefined,
      businessPriorities: undefined,
      businessProfile: undefined,
    }));

    const result = await assembleSeoContext('ws-no-bp');

    expect(result.businessProfile).toBeUndefined();
  });

  it('populates businessProfile from intelligenceProfile when industry is set', async () => {
    mockGetWorkspace.mockReturnValue(makeWorkspace({
      intelligenceProfile: { industry: 'Healthcare', goals: ['Grow patient volume'], targetAudience: 'Local patients' },
    }));

    const result = await assembleSeoContext('ws-intel-profile');

    expect(result.businessProfile?.industry).toBe('Healthcare');
    expect(result.businessProfile?.goals).toContain('Grow patient volume');
    expect(result.businessProfile?.targetAudience).toBe('Local patients');
  });

  it('merges businessPriorities into businessProfile.goals without duplicates', async () => {
    mockGetWorkspace.mockReturnValue(makeWorkspace({
      intelligenceProfile: { goals: ['Grow traffic'] },
      businessPriorities: ['Grow traffic', 'Launch new service'],
    }));

    const result = await assembleSeoContext('ws-dedup-goals');

    const goals = result.businessProfile?.goals ?? [];
    // 'Grow traffic' appears only once (deduped case-insensitive)
    expect(goals.filter(g => g.toLowerCase().includes('grow traffic'))).toHaveLength(1);
    expect(goals).toContain('Launch new service');
  });

  it('creates businessProfile from businessPriorities alone when intelligenceProfile absent', async () => {
    mockGetWorkspace.mockReturnValue(makeWorkspace({
      intelligenceProfile: undefined,
      businessPriorities: ['Increase revenue by 20%'],
    }));

    const result = await assembleSeoContext('ws-priorities-only');

    expect(result.businessProfile?.goals).toContain('Increase revenue by 20%');
    // industry and targetAudience initialize to empty string
    expect(result.businessProfile?.industry).toBe('');
    expect(result.businessProfile?.targetAudience).toBe('');
  });

  it('merges contact info (phone, email) from workspace.businessProfile', async () => {
    mockGetWorkspace.mockReturnValue(makeWorkspace({
      businessProfile: {
        phone: '555-1234',
        email: 'contact@example.com',
      } as Workspace['businessProfile'],
    }));
    // Need some other trigger to create businessProfile first,
    // so set businessPriorities to create the base object
    const ws = makeWorkspace({
      businessPriorities: ['Test goal'],
      businessProfile: {
        phone: '555-1234',
        email: 'contact@example.com',
      } as Workspace['businessProfile'],
    });
    mockGetWorkspace.mockReturnValue(ws);

    const result = await assembleSeoContext('ws-contact');

    expect(result.businessProfile?.phone).toBe('555-1234');
    expect(result.businessProfile?.email).toBe('contact@example.com');
  });

  it('assembles address string from address parts', async () => {
    mockGetWorkspace.mockReturnValue(makeWorkspace({
      businessPriorities: ['Goal'],
      businessProfile: {
        address: {
          street: '123 Main St',
          city: 'Austin',
          state: 'TX',
          zip: '78701',
          country: 'US',
        },
      } as unknown as Workspace['businessProfile'],
    }));

    const result = await assembleSeoContext('ws-address');

    expect(result.businessProfile?.address).toBe('123 Main St, Austin, TX, 78701, US');
    expect(result.businessProfile?.addressParts?.city).toBe('Austin');
  });

  it('intelligenceProfile with only goals (no industry/targetAudience) triggers businessProfile creation', async () => {
    mockGetWorkspace.mockReturnValue(makeWorkspace({
      intelligenceProfile: { goals: ['SEO growth'], industry: undefined, targetAudience: undefined },
    }));

    const result = await assembleSeoContext('ws-goals-only');

    expect(result.businessProfile).toBeDefined();
    expect(result.businessProfile?.goals).toContain('SEO growth');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 9. strategyHistory
// ════════════════════════════════════════════════════════════════════════════

describe('strategyHistory', () => {
  it('populates strategyHistory when DB rows exist', async () => {
    mockGetWorkspace.mockReturnValue(makeWorkspace());
    mockStrategyHistoryAll.mockReturnValue([
      { generated_at: '2026-05-01T00:00:00Z' },
      { generated_at: '2026-04-01T00:00:00Z' },
    ]);

    const result = await assembleSeoContext('ws-history');

    expect(result.strategyHistory?.revisionsCount).toBe(2);
    // lastRevisedAt is the first row (most recent, ORDER BY DESC)
    expect(result.strategyHistory?.lastRevisedAt).toBe('2026-05-01T00:00:00Z');
  });

  it('strategyHistory is absent when no rows exist', async () => {
    mockGetWorkspace.mockReturnValue(makeWorkspace());
    mockStrategyHistoryAll.mockReturnValue([]);

    const result = await assembleSeoContext('ws-no-history');

    expect(result.strategyHistory).toBeUndefined();
  });

  it('strategyHistory is absent when DB throws', async () => {
    mockGetWorkspace.mockReturnValue(makeWorkspace());
    mockStrategyHistoryAll.mockImplementation(() => { throw new Error('no such table: strategy_history'); });

    const result = await assembleSeoContext('ws-history-fail');

    expect(result.strategyHistory).toBeUndefined();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 10. Backlink enrichment (opt-in)
// ════════════════════════════════════════════════════════════════════════════

describe('backlink enrichment', () => {
  it('does not fetch backlinks when opts.enrichWithBacklinks is not set', async () => {
    mockGetWorkspace.mockReturnValue(makeWorkspace({ liveDomain: 'https://example.com' }));

    const result = await assembleSeoContext('ws-no-backlinks');

    expect(result.backlinkProfile).toBeUndefined();
    expect(mockGetBacklinksProvider).not.toHaveBeenCalled();
  });

  it('does not fetch backlinks when enrichWithBacklinks is false', async () => {
    mockGetWorkspace.mockReturnValue(makeWorkspace({ liveDomain: 'https://example.com' }));

    const result = await assembleSeoContext('ws-bl-false', { enrichWithBacklinks: false });

    expect(result.backlinkProfile).toBeUndefined();
    expect(mockGetBacklinksProvider).not.toHaveBeenCalled();
  });

  it('skips backlink fetch when no provider is configured', async () => {
    mockGetWorkspace.mockReturnValue(makeWorkspace({ liveDomain: 'https://example.com' }));
    mockGetBacklinksProvider.mockReturnValue(null);

    const result = await assembleSeoContext('ws-no-provider', { enrichWithBacklinks: true });

    expect(result.backlinkProfile).toBeUndefined();
  });

  it('skips backlink fetch when provider.isConfigured() returns false', async () => {
    mockGetWorkspace.mockReturnValue(makeWorkspace({ liveDomain: 'https://example.com' }));
    mockGetBacklinksProvider.mockReturnValue({
      isConfigured: () => false,
      getBacklinksOverview: vi.fn(),
    });

    const result = await assembleSeoContext('ws-unconfigured-prov', { enrichWithBacklinks: true });

    expect(result.backlinkProfile).toBeUndefined();
  });

  it('skips backlink fetch when workspace has no liveDomain', async () => {
    mockGetWorkspace.mockReturnValue(makeWorkspace({ liveDomain: undefined }));
    const mockProvider = { isConfigured: () => true, getBacklinksOverview: vi.fn() };
    mockGetBacklinksProvider.mockReturnValue(mockProvider);

    const result = await assembleSeoContext('ws-no-domain', { enrichWithBacklinks: true });

    expect(result.backlinkProfile).toBeUndefined();
    expect(mockProvider.getBacklinksOverview).not.toHaveBeenCalled();
  });

  it('populates backlinkProfile when provider returns data', async () => {
    mockGetWorkspace.mockReturnValue(makeWorkspace({ liveDomain: 'https://example.com' }));
    const mockProvider = {
      isConfigured: () => true,
      getBacklinksOverview: vi.fn().mockResolvedValue({
        totalBacklinks: 1500,
        referringDomains: 230,
      }),
    };
    mockGetBacklinksProvider.mockReturnValue(mockProvider);

    const result = await assembleSeoContext('ws-has-backlinks', { enrichWithBacklinks: true });

    expect(result.backlinkProfile?.totalBacklinks).toBe(1500);
    expect(result.backlinkProfile?.referringDomains).toBe(230);
  });

  it('degrades gracefully when backlinks provider throws', async () => {
    mockGetWorkspace.mockReturnValue(makeWorkspace({ liveDomain: 'https://example.com' }));
    const mockProvider = {
      isConfigured: () => true,
      getBacklinksOverview: vi.fn().mockRejectedValue(new Error('rate limited')),
    };
    mockGetBacklinksProvider.mockReturnValue(mockProvider);

    const result = await assembleSeoContext('ws-bl-throws', { enrichWithBacklinks: true });

    expect(result.backlinkProfile).toBeUndefined();
  });

  it('passes stripped domain (no protocol/trailing slash) to provider', async () => {
    mockGetWorkspace.mockReturnValue(makeWorkspace({ liveDomain: 'https://example.com/' }));
    const mockProvider = {
      isConfigured: () => true,
      getBacklinksOverview: vi.fn().mockResolvedValue({ totalBacklinks: 100, referringDomains: 50 }),
    };
    mockGetBacklinksProvider.mockReturnValue(mockProvider);

    await assembleSeoContext('ws-domain-strip', { enrichWithBacklinks: true });

    const [domain] = mockProvider.getBacklinksOverview.mock.calls[0];
    expect(domain).toBe('example.com');
    expect(domain).not.toContain('https://');
    expect(domain).not.toContain('/');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 11. pageKeywords (per-page enrichment)
// ════════════════════════════════════════════════════════════════════════════

describe('pageKeywords enrichment', () => {
  it('does not populate pageKeywords when no opts.pagePath provided', async () => {
    const page = makePageKeywordMap('/services');
    mockGetWorkspace.mockReturnValue(makeWorkspace({
      keywordStrategy: makeKeywordStrategy({ pageMap: [page] }),
    }));
    mockListPageKeywords.mockReturnValue([page]);

    const result = await assembleSeoContext('ws-no-pagepath');

    expect(result.pageKeywords).toBeUndefined();
  });

  it('populates pageKeywords when pagePath matches a page map entry', async () => {
    const page = makePageKeywordMap('/services', { primaryKeyword: 'managed seo' });
    mockGetWorkspace.mockReturnValue(makeWorkspace({
      keywordStrategy: makeKeywordStrategy({ pageMap: [page] }),
    }));
    mockListPageKeywords.mockReturnValue([page]);
    mockFindPageMapEntry.mockReturnValue(page);

    const result = await assembleSeoContext('ws-pagepath', { pagePath: '/services' });

    expect(result.pageKeywords?.primaryKeyword).toBe('managed seo');
    expect(result.pageKeywords?.pagePath).toBe('/services');
  });

  it('pageKeywords is absent when findPageMapEntry returns undefined', async () => {
    mockGetWorkspace.mockReturnValue(makeWorkspace({
      keywordStrategy: makeKeywordStrategy({ pageMap: [] }),
    }));
    mockListPageKeywords.mockReturnValue([makePageKeywordMap('/other')]);
    mockFindPageMapEntry.mockReturnValue(undefined);

    const result = await assembleSeoContext('ws-no-match', { pagePath: '/missing' });

    expect(result.pageKeywords).toBeUndefined();
  });

  it('calls findPageMapEntry with strategy.pageMap and pagePath', async () => {
    const page = makePageKeywordMap('/blog');
    mockGetWorkspace.mockReturnValue(makeWorkspace({
      keywordStrategy: makeKeywordStrategy({ pageMap: [page] }),
    }));
    mockListPageKeywords.mockReturnValue([page]);
    mockFindPageMapEntry.mockReturnValue(page);

    await assembleSeoContext('ws-fpm-call', { pagePath: '/blog' });

    expect(mockFindPageMapEntry).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ pagePath: '/blog' }),
    ]), '/blog');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 11b. PR6 (Spine D) — quick wins, cannibalization, top opportunity
// ════════════════════════════════════════════════════════════════════════════

describe('quick wins (SI1)', () => {
  it('populates quickWins from listQuickWins when present', async () => {
    mockGetWorkspace.mockReturnValue(makeWorkspace({ keywordStrategy: makeKeywordStrategy() }));
    mockListQuickWins.mockReturnValue([
      { pagePath: '/services', action: 'Add internal links', estimatedImpact: 'high', rationale: 'Boost authority', roiScore: 84 },
    ]);

    const result = await assembleSeoContext('ws-qw');

    expect(result.quickWins).toHaveLength(1);
    expect(result.quickWins?.[0].roiScore).toBe(84);
  });

  it('quickWins is absent when listQuickWins returns empty', async () => {
    mockGetWorkspace.mockReturnValue(makeWorkspace({ keywordStrategy: makeKeywordStrategy() }));
    mockListQuickWins.mockReturnValue([]);

    const result = await assembleSeoContext('ws-no-qw');

    expect(result.quickWins).toBeUndefined();
  });

  it('quickWins is absent when listQuickWins throws (graceful degradation)', async () => {
    mockGetWorkspace.mockReturnValue(makeWorkspace({ keywordStrategy: makeKeywordStrategy() }));
    mockListQuickWins.mockImplementation(() => { throw new Error('quick_wins table missing'); });

    const result = await assembleSeoContext('ws-qw-throws');

    expect(result.quickWins).toBeUndefined();
  });
});

describe('cannibalization issues (SI4)', () => {
  it('populates cannibalizationIssues from listCannibalizationIssues when present', async () => {
    mockGetWorkspace.mockReturnValue(makeWorkspace({ keywordStrategy: makeKeywordStrategy() }));
    mockListCannibalizationIssues.mockReturnValue([
      {
        keyword: 'seo tools',
        pages: [
          { path: '/a', source: 'keyword_map' },
          { path: '/b', source: 'gsc' },
        ],
        severity: 'medium',
        recommendation: 'Consolidate to /a',
      },
    ]);

    const result = await assembleSeoContext('ws-cann');

    expect(result.cannibalizationIssues).toHaveLength(1);
    expect(result.cannibalizationIssues?.[0].keyword).toBe('seo tools');
  });

  it('cannibalizationIssues is absent when none exist', async () => {
    mockGetWorkspace.mockReturnValue(makeWorkspace({ keywordStrategy: makeKeywordStrategy() }));
    mockListCannibalizationIssues.mockReturnValue([]);

    const result = await assembleSeoContext('ws-no-cann');

    expect(result.cannibalizationIssues).toBeUndefined();
  });

  it('cannibalizationIssues is absent when the module throws', async () => {
    mockGetWorkspace.mockReturnValue(makeWorkspace({ keywordStrategy: makeKeywordStrategy() }));
    mockListCannibalizationIssues.mockImplementation(() => { throw new Error('table missing'); });

    const result = await assembleSeoContext('ws-cann-throws');

    expect(result.cannibalizationIssues).toBeUndefined();
  });
});

describe('top opportunity (SI2/MW6)', () => {
  function makeRecSet(opts: { topId: string | null; recs: RecommendationSet['recommendations'] }): RecommendationSet {
    return {
      workspaceId: 'ws-top',
      generatedAt: '2026-05-01T00:00:00Z',
      recommendations: opts.recs,
      summary: {
        fixNow: 0, fixSoon: 0, fixLater: 0, ongoing: 0,
        totalImpactScore: 0, trafficAtRisk: 0,
        estimatedRecoverableClicks: 0, estimatedRecoverableImpressions: 0,
        topRecommendationId: opts.topId,
      },
    };
  }

  it('populates topOpportunity (incl. admin-only emvPerWeek) from the resolved #1 rec', async () => {
    mockGetWorkspace.mockReturnValue(makeWorkspace({ keywordStrategy: makeKeywordStrategy() }));
    mockLoadRecommendations.mockReturnValue(makeRecSet({
      topId: 'rec-1',
      recs: [
        {
          id: 'rec-1', workspaceId: 'ws-top', priority: 'fix_now', type: 'metadata',
          title: 'Fix meta', description: 'd', insight: 'i', impact: 'high', effort: 'low',
          impactScore: 80, source: 'audit:meta', affectedPages: ['home'],
          trafficAtRisk: 0, impressionsAtRisk: 0, estimatedGain: 'g', actionType: 'manual',
          status: 'pending', createdAt: 'x', updatedAt: 'x',
          opportunity: {
            value: 80, emvPerWeek: 999, roiPerEffortDay: 12, confidence: 0.95, calibration: 1,
            groundedSpine: 'roiScore',
            components: [
              { dimension: 'demand', rawValue: 2400, normalized: 0.5, weight: 0.2, contribution: 0.1, evidence: '2,400 searches' },
            ],
            calibrationVersion: 'v1', modelVersion: 'ov-1',
          },
        },
      ],
    }));

    const result = await assembleSeoContext('ws-top');

    expect(result.topOpportunity).toBeDefined();
    expect(result.topOpportunity?.recommendationId).toBe('rec-1');
    expect(result.topOpportunity?.value).toBe(80);
    // emvPerWeek IS carried in the slice for the admin advisor (stripped at the client boundary, not here)
    expect(result.topOpportunity?.emvPerWeek).toBe(999);
    expect(result.topOpportunity?.components).toHaveLength(1);
  });

  it('topOpportunity is absent when the #1 rec carries no opportunity (legacy set)', async () => {
    mockGetWorkspace.mockReturnValue(makeWorkspace({ keywordStrategy: makeKeywordStrategy() }));
    mockLoadRecommendations.mockReturnValue(makeRecSet({
      topId: 'rec-legacy',
      recs: [
        {
          id: 'rec-legacy', workspaceId: 'ws-top', priority: 'fix_now', type: 'metadata',
          title: 'Legacy', description: 'd', insight: 'i', impact: 'high', effort: 'low',
          impactScore: 60, source: 'audit:meta', affectedPages: ['home'],
          trafficAtRisk: 0, impressionsAtRisk: 0, estimatedGain: 'g', actionType: 'manual',
          status: 'pending', createdAt: 'x', updatedAt: 'x',
        },
      ],
    }));

    const result = await assembleSeoContext('ws-top-legacy');

    expect(result.topOpportunity).toBeUndefined();
  });

  it('topOpportunity is absent when the #1 rec is completed/dismissed', async () => {
    mockGetWorkspace.mockReturnValue(makeWorkspace({ keywordStrategy: makeKeywordStrategy() }));
    mockLoadRecommendations.mockReturnValue(makeRecSet({
      topId: 'rec-done',
      recs: [
        {
          id: 'rec-done', workspaceId: 'ws-top', priority: 'fix_now', type: 'metadata',
          title: 'Done', description: 'd', insight: 'i', impact: 'high', effort: 'low',
          impactScore: 90, source: 'audit:meta', affectedPages: ['home'],
          trafficAtRisk: 0, impressionsAtRisk: 0, estimatedGain: 'g', actionType: 'manual',
          status: 'completed', createdAt: 'x', updatedAt: 'x',
          opportunity: {
            value: 90, emvPerWeek: 100, roiPerEffortDay: 1, confidence: 0.9, calibration: 1,
            groundedSpine: 'computed', components: [], calibrationVersion: 'v1', modelVersion: 'ov-1',
          },
        },
      ],
    }));

    const result = await assembleSeoContext('ws-top-done');

    expect(result.topOpportunity).toBeUndefined();
  });

  it('topOpportunity is absent when no recommendations exist', async () => {
    mockGetWorkspace.mockReturnValue(makeWorkspace({ keywordStrategy: makeKeywordStrategy() }));
    mockLoadRecommendations.mockReturnValue(null);

    const result = await assembleSeoContext('ws-no-recs');

    expect(result.topOpportunity).toBeUndefined();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 12. Full happy path integration smoke test
// ════════════════════════════════════════════════════════════════════════════

describe('full happy path', () => {
  it('assembles a complete slice with all subsystems returning data', async () => {
    const page = makePageKeywordMap('/services', {
      serpFeatures: ['featured_snippet', 'people_also_ask', 'local_pack'],
    });
    const gap = makeContentGap('AEO strategy');

    mockGetWorkspace.mockReturnValue(makeWorkspace({
      keywordStrategy: makeKeywordStrategy({
        businessContext: 'SEO agency in Austin',
        pageMap: [page],
      }),
      personas: [{ name: 'Marketing Director', role: 'Decision maker' } as Workspace['personas'][number]],
      intelligenceProfile: { industry: 'Marketing', goals: ['Grow ARR'], targetAudience: 'SMBs' },
      businessPriorities: ['Hit 50 clients by Q4'],
      brandVoice: 'Authoritative yet approachable',
    }));
    mockListPageKeywords.mockReturnValue([page]);
    mockListContentGaps.mockReturnValue([gap]);
    mockGetTrackedKeywords.mockReturnValue([{ query: 'seo austin' }]);
    mockGetLatestRanks.mockReturnValue([
      { query: 'seo austin', position: 4, clicks: 20, impressions: 200, ctr: 0.1, change: -1 },
    ]);
    mockGetDiscoveredQuerySummary.mockReturnValue({
      totalDiscovered: 15,
      lostVisibilityCount: 3,
      topLostQueries: [],
    });
    mockStrategyHistoryAll.mockReturnValue([{ generated_at: '2026-05-20T00:00:00Z' }]);
    mockGetRawBrandVoice.mockReturnValue('Authoritative yet approachable');
    mockBuildEffectiveBrandVoiceBlock.mockReturnValue('\n\nBRAND VOICE & STYLE...');

    const result = await assembleSeoContext('ws-full-happy');

    // Strategy
    expect(result.strategy?.businessContext).toBe('SEO agency in Austin');
    expect(result.strategy?.pageMap).toHaveLength(1);
    expect(result.strategy?.contentGaps).toHaveLength(1);

    // Voice fields
    expect(result.brandVoice).toBe('Authoritative yet approachable');
    expect(result.effectiveBrandVoiceBlock).toContain('BRAND VOICE');

    // Personas
    expect(result.personas).toHaveLength(1);

    // Rank tracking
    expect(result.rankTracking?.trackedKeywords).toBe(1);
    expect(result.rankTracking?.avgPosition).toBe(4);
    expect(result.rankTracking?.positionChanges.improved).toBe(1);

    // SERP features
    expect(result.serpFeatures?.featuredSnippets).toBe(1);
    expect(result.serpFeatures?.localPack).toBe(true);

    // Discovered queries
    expect(result.discoveredQuerySummary?.totalDiscovered).toBe(15);

    // Strategy history
    expect(result.strategyHistory?.revisionsCount).toBe(1);

    // Business profile
    expect(result.businessProfile?.industry).toBe('Marketing');
    expect(result.businessProfile?.goals).toContain('Grow ARR');
    expect(result.businessProfile?.goals).toContain('Hit 50 clients by Q4');
  });
});
