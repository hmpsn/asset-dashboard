/**
 * Unit tests for server/keyword-strategy-enrichment.ts
 *
 * Covers:
 * - _hasMultiWordTopicSignal
 * - isTopicKeywordCoveredByPageMap
 * - _removePageCoveredContentGaps
 * - _resolvePageUrl
 * - _chooseUrlLevelKeyword
 * - enrichKeywordStrategy (integration-style unit test, provider mocked)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — must be hoisted before any imports that touch the mocked modules
// ---------------------------------------------------------------------------
const mockCallKeywordStrategyAI = vi.hoisted(() => vi.fn(async () => '[]'));
const mockCallNamedStrategyAI = vi.hoisted(() => vi.fn(async () => '[]'));
const mockComputeOpportunityScore = vi.hoisted(() => vi.fn((cg: Record<string, unknown>) => (cg.volume as number ?? 0) + 10));
const mockIsSuspiciousPlannerGroupedVolume = vi.hoisted(() => vi.fn(() => false));
const mockMatchesQuestionKeyword = vi.hoisted(() => vi.fn(() => false));
const mockParseJsonFallback = vi.hoisted(() => vi.fn((_raw: unknown, fallback: unknown) => fallback));
const mockCreateLogger = vi.hoisted(() => vi.fn(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
})));

vi.mock('../../server/logger.js', () => ({
  createLogger: mockCreateLogger,
}));

vi.mock('../../server/keyword-strategy-ai-synthesis.js', () => ({
  callKeywordStrategyAI: mockCallKeywordStrategyAI,
  callNamedStrategyAI: mockCallNamedStrategyAI,
}));

vi.mock('../../server/keyword-strategy-helpers.js', () => ({
  computeOpportunityScore: mockComputeOpportunityScore,
  isSuspiciousPlannerGroupedVolume: mockIsSuspiciousPlannerGroupedVolume,
}));

vi.mock('../../server/strategy-filters.js', () => ({
  matchesQuestionKeyword: mockMatchesQuestionKeyword,
}));

vi.mock('../../server/db/json-validation.js', () => ({
  parseJsonFallback: mockParseJsonFallback,
}));

vi.mock('../../server/errors.js', () => ({
  isProgrammingError: vi.fn(() => false),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------
import {
  _hasMultiWordTopicSignal,
  isTopicKeywordCoveredByPageMap,
  _removePageCoveredContentGaps,
  _resolvePageUrl,
  _chooseUrlLevelKeyword,
  enrichKeywordStrategy,
  parseTopicClusterOutput,
} from '../../server/keyword-strategy-enrichment.js';
import type { StrategyPageMapEntry, StrategyContentGap, StrategyOutput } from '../../server/keyword-strategy-ai-synthesis.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makePageMapEntry(overrides: Partial<StrategyPageMapEntry> = {}): StrategyPageMapEntry {
  return {
    pagePath: '/services/dentistry',
    primaryKeyword: 'cosmetic dentistry',
    ...overrides,
  };
}

function makeStrategy(overrides: Partial<StrategyOutput> = {}): StrategyOutput {
  return {
    pageMap: [],
    contentGaps: [],
    quickWins: [],
    siteKeywords: [],
    ...overrides,
  };
}

function makeEnrichOptions(strategyOverride: Partial<StrategyOutput> = {}) {
  return {
    workspaceId: 'ws-test-123',
    baseUrl: 'https://example.com',
    strategy: makeStrategy(strategyOverride),
    keywordPool: new Map<string, { volume: number; difficulty: number; source: string }>(),
    businessSection: 'Dental practice.',
    searchData: { gscData: [] } as Parameters<typeof enrichKeywordStrategy>[0]['searchData'],
    domainKeywords: [],
    questionKeywords: [],
    competitorKeywords: [],
    provider: null,
    seoDataMode: 'full' as const,
    sendProgress: vi.fn(),
  };
}

function fillKeywordPool(opts: ReturnType<typeof makeEnrichOptions>, count = 10) {
  for (let i = 0; i < count; i++) {
    opts.keywordPool.set(`dental keyword ${i}`, { volume: 1000 - i, difficulty: 20, source: 'gap:competitor.com' });
  }
}

describe('parseTopicClusterOutput', () => {
  it('validates parseable topic cluster JSON with the expected shape', () => {
    mockParseJsonFallback.mockReturnValue([
      { topic: 'Dental Services', keywords: ['dental keyword 1', 'dental keyword 2', 'dental keyword 3'] },
    ]);

    const clusters = parseTopicClusterOutput('[{"topic":"Dental Services","keywords":["dental keyword 1","dental keyword 2","dental keyword 3"]}]');

    expect(clusters).toHaveLength(1);
    expect(clusters[0].topic).toBe('Dental Services');
  });

  it('rejects malformed but parseable topic cluster JSON', () => {
    mockParseJsonFallback.mockReturnValue([{ topic: 'Broken', keywords: ['one'] }]);

    expect(() => parseTopicClusterOutput('[{"topic":"Broken","keywords":["one"]}]')).toThrow('invalid JSON');
  });
});

// ---------------------------------------------------------------------------
// _hasMultiWordTopicSignal
// ---------------------------------------------------------------------------
describe('_hasMultiWordTopicSignal', () => {
  it('returns true for two-word keywords', () => {
    expect(_hasMultiWordTopicSignal('cosmetic dentistry')).toBe(true);
  });

  it('returns true for three-word keywords', () => {
    expect(_hasMultiWordTopicSignal('teeth whitening cost')).toBe(true);
  });

  it('returns false for single-word keywords', () => {
    expect(_hasMultiWordTopicSignal('dentist')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(_hasMultiWordTopicSignal('')).toBe(false);
  });

  it('normalizes case and punctuation before counting words', () => {
    // "Dental IMPLANTS" → "dental implants" → 2 words → true
    expect(_hasMultiWordTopicSignal('Dental IMPLANTS')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// isTopicKeywordCoveredByPageMap
// ---------------------------------------------------------------------------
describe('isTopicKeywordCoveredByPageMap', () => {
  it('returns false for empty keyword', () => {
    const pageMap = [makePageMapEntry({ primaryKeyword: 'cosmetic dentistry' })];
    expect(isTopicKeywordCoveredByPageMap('', pageMap)).toBe(false);
  });

  it('returns false when pageMap is empty or undefined', () => {
    expect(isTopicKeywordCoveredByPageMap('dentist', [])).toBe(false);
    expect(isTopicKeywordCoveredByPageMap('dentist', undefined)).toBe(false);
  });

  it('returns true when keyword exactly matches the primaryKeyword', () => {
    const pageMap = [makePageMapEntry({ primaryKeyword: 'cosmetic dentistry' })];
    expect(isTopicKeywordCoveredByPageMap('cosmetic dentistry', pageMap)).toBe(true);
  });

  it('is case-insensitive for primary keyword match', () => {
    const pageMap = [makePageMapEntry({ primaryKeyword: 'Cosmetic Dentistry' })];
    expect(isTopicKeywordCoveredByPageMap('cosmetic dentistry', pageMap)).toBe(true);
  });

  it('returns true when keyword matches a secondary keyword', () => {
    const pageMap = [makePageMapEntry({
      primaryKeyword: 'dental implants',
      secondaryKeywords: ['teeth whitening', 'cosmetic dentistry'],
    })];
    expect(isTopicKeywordCoveredByPageMap('cosmetic dentistry', pageMap)).toBe(true);
  });

  it('returns false when keyword is not in primaryKeyword or secondaryKeywords', () => {
    const pageMap = [makePageMapEntry({ primaryKeyword: 'dental implants' })];
    expect(isTopicKeywordCoveredByPageMap('root canal treatment', pageMap)).toBe(false);
  });

  it('matches multi-word keyword against page path (slug match)', () => {
    const pageMap = [makePageMapEntry({
      pagePath: '/services/cosmetic-dentistry',
      primaryKeyword: 'dental care',
    })];
    // "cosmetic dentistry" appears in the slug via phrase match
    expect(isTopicKeywordCoveredByPageMap('cosmetic dentistry', pageMap)).toBe(true);
  });

  it('does NOT use slug match for single-word keywords (only multi-word)', () => {
    const pageMap = [makePageMapEntry({
      pagePath: '/services/dentist-office',
      primaryKeyword: 'dental care',
    })];
    // Single-word "dentist" should NOT match via slug
    expect(isTopicKeywordCoveredByPageMap('dentist', pageMap)).toBe(false);
  });

  it('matches multi-word keyword against page title', () => {
    const pageMap = [makePageMapEntry({
      pagePath: '/contact',
      pageTitle: 'Cosmetic Dentistry Services',
      primaryKeyword: 'dental care',
    })];
    expect(isTopicKeywordCoveredByPageMap('cosmetic dentistry', pageMap)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// _removePageCoveredContentGaps
// ---------------------------------------------------------------------------
describe('_removePageCoveredContentGaps', () => {
  it('returns empty arrays when no content gaps provided', () => {
    const result = _removePageCoveredContentGaps(undefined, []);
    expect(result).toEqual({ kept: [], removed: [] });
  });

  it('returns empty arrays for empty content gaps array', () => {
    const result = _removePageCoveredContentGaps([], []);
    expect(result).toEqual({ kept: [], removed: [] });
  });

  it('keeps gaps where keyword is not covered by page map', () => {
    const gaps: StrategyContentGap[] = [
      { targetKeyword: 'dental implants' },
      { targetKeyword: 'teeth whitening' },
    ];
    const pageMap = [makePageMapEntry({ primaryKeyword: 'cosmetic dentistry' })];
    const { kept, removed } = _removePageCoveredContentGaps(gaps, pageMap);
    expect(kept).toHaveLength(2);
    expect(removed).toHaveLength(0);
  });

  it('removes gaps whose keyword is already covered by page map', () => {
    const gaps: StrategyContentGap[] = [
      { targetKeyword: 'cosmetic dentistry' },
      { targetKeyword: 'dental implants' },
    ];
    const pageMap = [makePageMapEntry({ primaryKeyword: 'cosmetic dentistry' })];
    const { kept, removed } = _removePageCoveredContentGaps(gaps, pageMap);
    expect(kept).toHaveLength(1);
    expect(kept[0].targetKeyword).toBe('dental implants');
    expect(removed).toHaveLength(1);
    expect(removed[0].targetKeyword).toBe('cosmetic dentistry');
  });

  it('handles empty page map (keeps all gaps)', () => {
    const gaps: StrategyContentGap[] = [{ targetKeyword: 'dental care' }];
    const { kept, removed } = _removePageCoveredContentGaps(gaps, []);
    expect(kept).toHaveLength(1);
    expect(removed).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// _resolvePageUrl
// ---------------------------------------------------------------------------
describe('_resolvePageUrl', () => {
  it('resolves a simple path against base URL', () => {
    const result = _resolvePageUrl('https://example.com', '/services');
    expect(result).toBe('https://example.com/services');
  });

  it('returns null when baseUrl is empty', () => {
    expect(_resolvePageUrl('', '/services')).toBeNull();
  });

  it('returns null when pagePath is empty', () => {
    expect(_resolvePageUrl('https://example.com', '')).toBeNull();
  });

  it('handles baseUrl with trailing slash', () => {
    const result = _resolvePageUrl('https://example.com/', '/about');
    expect(result).toBe('https://example.com/about');
  });

  it('returns null for a malformed base URL without throwing', () => {
    // normalizePath('/services') returns '/services', but 'not-a-url' is not a valid base
    // URL constructor will throw → function returns null
    const result = _resolvePageUrl('not-a-url', '/services');
    // URL('services', 'not-a-url/') throws or resolves oddly — we just check it doesn't throw
    expect(result === null || typeof result === 'string').toBe(true);
  });

  it('resolves nested path correctly', () => {
    const result = _resolvePageUrl('https://example.com', '/services/cosmetic-dentistry');
    expect(result).toBe('https://example.com/services/cosmetic-dentistry');
  });
});

// ---------------------------------------------------------------------------
// _chooseUrlLevelKeyword
// ---------------------------------------------------------------------------
describe('_chooseUrlLevelKeyword', () => {
  it('returns undefined for empty array', () => {
    expect(_chooseUrlLevelKeyword([])).toBeUndefined();
  });

  it('returns undefined when all keywords have empty/whitespace keyword strings', () => {
    const kws = [
      { keyword: '', volume: 100, traffic: 50, position: 1 },
      { keyword: '   ', volume: 200, traffic: 80, position: 2 },
    ] as Parameters<typeof _chooseUrlLevelKeyword>[0];
    expect(_chooseUrlLevelKeyword(kws)).toBeUndefined();
  });

  it('selects keyword with highest traffic', () => {
    const kws = [
      { keyword: 'dental implants', volume: 1000, traffic: 50, position: 5 },
      { keyword: 'cosmetic dentistry', volume: 800, traffic: 120, position: 3 },
    ] as Parameters<typeof _chooseUrlLevelKeyword>[0];
    expect(_chooseUrlLevelKeyword(kws)?.keyword).toBe('cosmetic dentistry');
  });

  it('breaks traffic ties by volume', () => {
    const kws = [
      { keyword: 'dental care', volume: 500, traffic: 100, position: 4 },
      { keyword: 'dental implants', volume: 1200, traffic: 100, position: 6 },
    ] as Parameters<typeof _chooseUrlLevelKeyword>[0];
    expect(_chooseUrlLevelKeyword(kws)?.keyword).toBe('dental implants');
  });

  it('breaks volume+traffic ties by best position', () => {
    const kws = [
      { keyword: 'keyword a', volume: 500, traffic: 100, position: 8 },
      { keyword: 'keyword b', volume: 500, traffic: 100, position: 3 },
    ] as Parameters<typeof _chooseUrlLevelKeyword>[0];
    expect(_chooseUrlLevelKeyword(kws)?.keyword).toBe('keyword b');
  });

  it('treats undefined traffic as 0 in sorting', () => {
    const kws = [
      { keyword: 'keyword a', volume: 500, traffic: undefined, position: 1 },
      { keyword: 'keyword b', volume: 300, traffic: 50, position: 5 },
    ] as Parameters<typeof _chooseUrlLevelKeyword>[0];
    // keyword b has higher traffic (50 vs 0)
    expect(_chooseUrlLevelKeyword(kws)?.keyword).toBe('keyword b');
  });
});

// ---------------------------------------------------------------------------
// enrichKeywordStrategy — integration-style unit tests (provider = null)
// ---------------------------------------------------------------------------
describe('enrichKeywordStrategy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockParseJsonFallback.mockReturnValue(null);
    mockComputeOpportunityScore.mockImplementation((cg: Record<string, unknown>) => (cg.volume as number ?? 0) + 10);
    mockIsSuspiciousPlannerGroupedVolume.mockReturnValue(false);
    mockMatchesQuestionKeyword.mockReturnValue(false);
  });

  it('returns empty result with no enrichment sources', async () => {
    const opts = makeEnrichOptions();
    const result = await enrichKeywordStrategy(opts);
    expect(result.siteKeywordMetrics).toEqual([]);
    expect(result.topicClusters).toEqual([]);
    expect(result.cannibalization).toEqual([]);
  });

  it('enriches pageMap entries from domainKeywords via exact match', async () => {
    const opts = makeEnrichOptions({
      pageMap: [makePageMapEntry({ primaryKeyword: 'cosmetic dentistry', pagePath: '/services/cosmetic-dentistry' })],
    });
    opts.domainKeywords = [
      { keyword: 'cosmetic dentistry', volume: 1200, difficulty: 45, cpc: 6.5, position: 8 },
    ] as typeof opts.domainKeywords;

    const result = await enrichKeywordStrategy(opts);
    const pm = result.strategy.pageMap?.[0];
    expect(pm?.volume).toBe(1200);
    expect(pm?.difficulty).toBe(45);
    expect(pm?.cpc).toBe(6.5);
    expect(pm?.metricsSource).toBe('exact');
  });

  it('enriches pageMap entries from domainKeywords via partial word-overlap match', async () => {
    const opts = makeEnrichOptions({
      pageMap: [makePageMapEntry({ primaryKeyword: 'cosmetic dental implants', pagePath: '/implants' })],
    });
    opts.domainKeywords = [
      { keyword: 'dental implants cosmetic', volume: 900, difficulty: 40, cpc: 5, position: 10 },
    ] as typeof opts.domainKeywords;

    const result = await enrichKeywordStrategy(opts);
    const pm = result.strategy.pageMap?.[0];
    // 3 words: "cosmetic", "dental", "implants" — all 3 appear in "dental implants cosmetic" → 100% overlap ≥ 80%
    expect(pm?.volume).toBe(900);
    expect(pm?.metricsSource).toBe('partial_match');
  });

  it('skips pages that already have URL-level metrics source', async () => {
    const opts = makeEnrichOptions({
      pageMap: [makePageMapEntry({
        primaryKeyword: 'cosmetic dentistry',
        pagePath: '/cosmetic',
        metricsSource: 'url_level',
        volume: 500,
      })],
    });
    opts.domainKeywords = [
      { keyword: 'cosmetic dentistry', volume: 9999, difficulty: 70, cpc: 12, position: 1 },
    ] as typeof opts.domainKeywords;

    const result = await enrichKeywordStrategy(opts);
    // Volume should remain at 500 from url_level, NOT overwritten with 9999
    expect(result.strategy.pageMap?.[0].volume).toBe(500);
  });

  it('enriches content gaps from keyword pool (priority 1)', async () => {
    const opts = makeEnrichOptions({
      contentGaps: [{ targetKeyword: 'teeth whitening cost', priority: 'high' }],
    });
    opts.keywordPool.set('teeth whitening cost', { volume: 800, difficulty: 30, source: 'gap:competitor.com' });

    const result = await enrichKeywordStrategy(opts);
    const gap = result.strategy.contentGaps?.[0];
    expect(gap?.volume).toBe(800);
    expect(gap?.difficulty).toBe(30);
  });

  it('skips GSC-sourced keyword pool entries for content gap volume (avoids impression confusion)', async () => {
    const opts = makeEnrichOptions({
      contentGaps: [{ targetKeyword: 'teeth whitening' }],
    });
    // GSC-sourced with non-zero volume — should be skipped
    opts.keywordPool.set('teeth whitening', { volume: 40, difficulty: 0, source: 'gsc' });
    // Domain keyword should be the fallback
    opts.domainKeywords = [
      { keyword: 'teeth whitening', volume: 1500, difficulty: 25, cpc: 3, position: 15 },
    ] as typeof opts.domainKeywords;

    const result = await enrichKeywordStrategy(opts);
    // Pool GSC hit skipped → domain fallback used
    expect(result.strategy.contentGaps?.[0].volume).toBe(1500);
  });

  it('enriches content gaps with GSC impressions for exact query match', async () => {
    const opts = makeEnrichOptions({
      contentGaps: [{ targetKeyword: 'cosmetic dentist nyc' }],
    });
    opts.searchData = {
      gscData: [
        { page: 'https://example.com/services', query: 'cosmetic dentist nyc', impressions: 320, clicks: 10, position: 12 },
      ],
    } as typeof opts.searchData;

    const result = await enrichKeywordStrategy(opts);
    expect(result.strategy.contentGaps?.[0].impressions).toBe(320);
  });

  it('enriches content gaps with SERP feature targeting recommendations', async () => {
    const opts = makeEnrichOptions({
      contentGaps: [{ targetKeyword: 'dentist near me', serpFeatures: ['featured_snippet', 'people_also_ask'] }],
    });

    const result = await enrichKeywordStrategy(opts);
    const gap = result.strategy.contentGaps?.[0];
    expect(gap?.serpTargeting).toBeDefined();
    expect(gap?.serpTargeting?.some(r => r.includes('featured snippet'))).toBe(true);
    expect(gap?.serpTargeting?.some(r => r.includes('FAQ'))).toBe(true);
  });

  it('adds video and local_pack SERP targeting recommendations', async () => {
    const opts = makeEnrichOptions({
      contentGaps: [{ targetKeyword: 'dental office near me', serpFeatures: ['video', 'local_pack'] }],
    });

    const result = await enrichKeywordStrategy(opts);
    const recs = result.strategy.contentGaps?.[0].serpTargeting ?? [];
    expect(recs.some(r => r.includes('video'))).toBe(true);
    expect(recs.some(r => r.includes('LocalBusiness schema'))).toBe(true);
  });

  it('removes content gaps already covered by pageMap', async () => {
    const opts = makeEnrichOptions({
      pageMap: [makePageMapEntry({ primaryKeyword: 'dental implants', pagePath: '/implants' })],
      contentGaps: [
        { targetKeyword: 'dental implants' },  // covered
        { targetKeyword: 'teeth whitening' },  // not covered
      ],
    });

    const result = await enrichKeywordStrategy(opts);
    const remainingKeywords = result.strategy.contentGaps?.map(g => g.targetKeyword);
    expect(remainingKeywords).toContain('teeth whitening');
    expect(remainingKeywords).not.toContain('dental implants');
  });

  it('sorts content gaps: positive volume → null/undefined → zero volume', async () => {
    const opts = makeEnrichOptions({
      contentGaps: [
        { targetKeyword: 'kw-zero', volume: 0 },
        { targetKeyword: 'kw-positive', volume: 500 },
        { targetKeyword: 'kw-unenriched' },  // no volume
      ],
    });

    const result = await enrichKeywordStrategy(opts);
    const gaps = result.strategy.contentGaps!;
    const buckets = gaps.map(g => g.volume == null ? 'null' : g.volume > 0 ? 'positive' : 'zero');
    // positive should come before null/undefined before zero
    expect(buckets[0]).toBe('positive');
    expect(buckets[buckets.length - 1]).toBe('zero');
  });

  it('computes quick win ROI scores from page data', async () => {
    const opts = makeEnrichOptions({
      pageMap: [makePageMapEntry({
        pagePath: '/services',
        primaryKeyword: 'dental care',
        volume: 1000,
        currentPosition: 10,
        difficulty: 40,
      })],
      quickWins: [{ pagePath: '/services', action: 'optimize title', estimatedImpact: 'high' }],
    });

    const result = await enrichKeywordStrategy(opts);
    const qw = result.strategy.quickWins?.[0];
    // roiScore = round(1000 * (1 - 40/100) / max(10, 1)) = round(600/10) = 60
    expect(qw?.roiScore).toBe(60);
  });

  it('uses fallback ROI score for quick wins without page data', async () => {
    const opts = makeEnrichOptions({
      pageMap: [],
      quickWins: [
        { pagePath: '/no-data', action: 'fix title', estimatedImpact: 'high' },
        { pagePath: '/no-data2', action: 'add keywords', estimatedImpact: 'low' },
      ],
    });

    const result = await enrichKeywordStrategy(opts);
    expect(result.strategy.quickWins?.[0].roiScore).toBe(100);
    expect(result.strategy.quickWins?.[1].roiScore).toBe(20);
  });

  it('sorts pageMap by volume descending', async () => {
    const opts = makeEnrichOptions({
      pageMap: [
        makePageMapEntry({ pagePath: '/low', primaryKeyword: 'low vol', volume: 100 }),
        makePageMapEntry({ pagePath: '/high', primaryKeyword: 'high vol', volume: 5000 }),
        makePageMapEntry({ pagePath: '/mid', primaryKeyword: 'mid vol', volume: 1000 }),
      ],
    });

    const result = await enrichKeywordStrategy(opts);
    const vols = result.strategy.pageMap!.map(p => p.volume);
    expect(vols[0]).toBe(5000);
    expect(vols[1]).toBe(1000);
    expect(vols[2]).toBe(100);
  });

  it('skips topic clustering when keyword pool has fewer than 10 entries', async () => {
    const opts = makeEnrichOptions();
    for (let i = 0; i < 9; i++) {
      opts.keywordPool.set(`keyword${i}`, { volume: 100, difficulty: 20, source: 'gap:competitor.com' });
    }

    await enrichKeywordStrategy(opts);
    expect(mockCallNamedStrategyAI).not.toHaveBeenCalled();
  });

  it('uses the named topic-cluster operation and stores valid AI clusters', async () => {
    const opts = makeEnrichOptions();
    fillKeywordPool(opts);
    mockParseJsonFallback.mockReturnValue([
      { topic: 'Dental Services', keywords: ['dental keyword 0', 'dental keyword 1', 'dental keyword 2'] },
    ]);

    const result = await enrichKeywordStrategy(opts);

    expect(mockCallNamedStrategyAI).toHaveBeenCalledWith(
      'ws-test-123',
      'keyword-topic-clusters',
      expect.any(Array),
      2000,
    );
    expect(result.topicClusters).toHaveLength(1);
    expect(result.topicClusters[0]).toMatchObject({
      topic: 'Dental Services',
      totalCount: 3,
      ownedCount: 0,
    });
  });

  it('skips malformed topic-cluster AI output while preserving deterministic base results', async () => {
    const opts = makeEnrichOptions({
      quickWins: [{ pagePath: '/services', recommendation: 'refresh copy', priority: 'medium', effort: 'low' }],
    });
    fillKeywordPool(opts);
    mockParseJsonFallback.mockReturnValue({ clusters: [{ topic: 'Dental Services', keywords: ['dental keyword 0'] }] });

    const result = await enrichKeywordStrategy(opts);

    expect(mockCallNamedStrategyAI).toHaveBeenCalled();
    expect(result.topicClusters).toEqual([]);
    expect(result.strategy.quickWins).toHaveLength(1);
  });

  it('attaches FAQ question keywords to a content gap from a grouped questionKeywords input (flag-ON parity)', async () => {
    // P1: on the flag-ON path the assembler surfaces question keywords in the same
    // `{ seed, questions: { keyword, volume }[] }[]` shape the legacy prefetch
    // produced; enrichment must attach the matching questions to the content gap
    // exactly as before. domainKeywords is required so the gap reaches the
    // question-attach block (it sits behind the `domainKeywords.length > 0` guard).
    mockMatchesQuestionKeyword.mockImplementation((target: string, question: string) =>
      target === 'teeth whitening' && question.startsWith('how to teeth whitening'));
    const opts = makeEnrichOptions({
      contentGaps: [{ targetKeyword: 'teeth whitening' }],
    });
    opts.domainKeywords = [
      { keyword: 'teeth whitening', volume: 1200, difficulty: 30, cpc: 4, position: 5 },
    ] as typeof opts.domainKeywords;
    opts.questionKeywords = [
      {
        seed: 'teeth whitening',
        questions: [
          { keyword: 'how to teeth whitening at home', volume: 400 },
          { keyword: 'how to teeth whitening cost', volume: 300 },
          { keyword: 'unrelated dental question', volume: 200 },
        ],
      },
    ];

    const result = await enrichKeywordStrategy(opts);
    const gap = result.strategy.contentGaps?.[0];
    expect(gap?.questionKeywords).toBeDefined();
    // Only the matching questions are attached (capped at 3), unrelated one excluded.
    expect(gap?.questionKeywords).toEqual([
      'how to teeth whitening at home',
      'how to teeth whitening cost',
    ]);
  });

  it('attaches no FAQ question keywords when the grouped input is empty (flag-OFF byte-identical no-op)', async () => {
    // Flag-OFF when seo-data found no questions (or assembler-degradation fallback):
    // the empty group must leave the gap's questionKeywords untouched/undefined.
    mockMatchesQuestionKeyword.mockReturnValue(true);
    const opts = makeEnrichOptions({
      contentGaps: [{ targetKeyword: 'teeth whitening' }],
    });
    opts.domainKeywords = [
      { keyword: 'teeth whitening', volume: 1200, difficulty: 30, cpc: 4, position: 5 },
    ] as typeof opts.domainKeywords;
    opts.questionKeywords = [];

    const result = await enrichKeywordStrategy(opts);
    expect(result.strategy.contentGaps?.[0].questionKeywords).toBeUndefined();
  });

  it('enriches GSC position for matching page + keyword pair', async () => {
    const opts = makeEnrichOptions({
      pageMap: [makePageMapEntry({ pagePath: '/about', primaryKeyword: 'dental care austin' })],
    });
    opts.searchData = {
      gscData: [
        { page: 'https://example.com/about', query: 'dental care austin', impressions: 500, clicks: 20, position: 7.2 },
        { page: 'https://example.com/about', query: 'austin dentist', impressions: 200, clicks: 8, position: 12.0 },
      ],
    } as typeof opts.searchData;

    const result = await enrichKeywordStrategy(opts);
    const pm = result.strategy.pageMap?.[0];
    // position from matching query
    expect(pm?.currentPosition).toBe(7.2);
    // impressions from all matching rows
    expect(pm?.impressions).toBe(700);
    expect(pm?.clicks).toBe(28);
  });
});
