// tests/unit/local-seo-slice-assembly.test.ts
//
// Tests for server/intelligence/local-seo-slice.ts:
//   - selectRelevantLocalCandidates (pure function, no DB needed)
//   - assembleLocalSeo (DB-backed, feature-flag-controlled)

import { describe, it, expect, vi, afterEach } from 'vitest';
import type { LocalSeoSlice } from '../../shared/types/intelligence.js';

// ── vi.mock declarations must come before any import that transitively loads
//    the module under test (hoisting contract). ────────────────────────────────

vi.mock('../../server/feature-flags.js', () => ({
  isFeatureEnabled: vi.fn().mockReturnValue(true),
}));

// The local-seo.ts module is dynamically imported inside assembleLocalSeo.
// We mock it so DB-heavy code doesn't run, while the feature-flag mock above
// lets us flip "enabled" per test.
vi.mock('../../server/local-seo.js', () => ({
  listLocalSeoMarkets: vi.fn().mockReturnValue([]),
  buildLocalSeoKeywordCandidates: vi.fn().mockReturnValue([]),
  buildLocalSeoKeywordVisibilitySummaryByKey: vi.fn().mockReturnValue(new Map()),
  listLatestLocalVisibilitySnapshots: vi.fn().mockReturnValue([]),
}));

vi.mock('../../server/client-locations.js', () => ({
  getClientLocations: vi.fn().mockReturnValue([]),
}));

import { selectRelevantLocalCandidates, assembleLocalSeo } from '../../server/intelligence/local-seo-slice.js';
import { isFeatureEnabled } from '../../server/feature-flags.js';
import * as localSeoModule from '../../server/local-seo.js';
import * as clientLocationsModule from '../../server/client-locations.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

type Candidate = LocalSeoSlice['candidates'][number];

function makeCandidate(keyword: string, score: number, marketId?: string | null): Candidate {
  return {
    keyword,
    source: 'test',
    sourceLabel: 'Test Source',
    score,
    marketId,
  };
}

function makeSlice(
  candidates: LocalSeoSlice['candidates'],
  enabled = true,
  markets: LocalSeoSlice['markets'] = [],
): LocalSeoSlice {
  return {
    locations: [],
    enabled,
    markets,
    visibility: { visible: 0, possibleMatch: 0, notVisible: 0, notChecked: 0, providerDegraded: 0 },
    candidates,
    effectiveLocalSeoBlock: '',
    latestSnapshotAt: null,
  };
}

// ── selectRelevantLocalCandidates tests ───────────────────────────────────────

describe('selectRelevantLocalCandidates', () => {
  // ── Bug probe 1: short-word tokens (length ≤ 2) never overlap ─────────────

  it('single-word target "of" (length 2) produces no token overlap — falls back to score sort', () => {
    const candidates = [
      makeCandidate('dentist of record', 90),
      makeCandidate('orthodontist near me', 80),
      makeCandidate('emergency dentist', 70),
    ];
    const slice = makeSlice(candidates);

    const results = selectRelevantLocalCandidates(slice, 'of', 3);

    // "of" has length 2 → filtered out by t.length > 2 → no token overlap.
    // Should fall back to score-sorted order.
    expect(results[0].keyword).toBe('dentist of record');  // score 90
    expect(results[1].keyword).toBe('orthodontist near me'); // score 80
    expect(results[2].keyword).toBe('emergency dentist');   // score 70
  });

  it('single-word target "seo" (length 3) DOES produce token overlap', () => {
    const candidates = [
      makeCandidate('local seo services', 50),
      makeCandidate('dentist near me', 100),
    ];
    const slice = makeSlice(candidates);

    const results = selectRelevantLocalCandidates(slice, 'seo', 2);

    // "seo" length 3 passes the > 2 filter → token overlap with "local seo services"
    // → relevance boost puts it first despite lower score.
    expect(results[0].keyword).toBe('local seo services');
  });

  // ── Bug probe 2: no target → top-N by score ────────────────────────────────

  it('no target returns top-limit candidates sorted by score descending', () => {
    const candidates = Array.from({ length: 20 }, (_, i) =>
      makeCandidate(`keyword-${i}`, i * 5), // scores 0, 5, 10, ..., 95
    );
    const slice = makeSlice(candidates);

    const results = selectRelevantLocalCandidates(slice, undefined, 5);

    expect(results).toHaveLength(5);
    // Should be top 5 by score: 95, 90, 85, 80, 75
    expect(results[0].score).toBe(95);
    expect(results[1].score).toBe(90);
    expect(results[2].score).toBe(85);
    expect(results[3].score).toBe(80);
    expect(results[4].score).toBe(75);
  });

  it('no target returns all candidates when count < limit', () => {
    const candidates = [makeCandidate('only one', 42)];
    const slice = makeSlice(candidates);

    const results = selectRelevantLocalCandidates(slice, undefined);
    expect(results).toHaveLength(1);
    expect(results[0].keyword).toBe('only one');
  });

  // ── Bug probe 3: market match boost ───────────────────────────────────────

  it('lower-scored candidate with matching marketId beats higher-scored candidate without one', () => {
    const targetKeyword = 'dentist austin tx';
    const marketId = 'market-austin';

    // Add a candidate that exactly matches the target keyword and carries the marketId.
    const targetCandidate = makeCandidate(targetKeyword, 60, marketId);
    // Low-scored neighbor in same market — should be boosted by market match.
    const marketNeighbor = makeCandidate('emergency dentist austin', 30, marketId);
    // High-scored candidate with no market affiliation.
    const highScoreNoMarket = makeCandidate('national dental chain', 80);

    const slice = makeSlice([targetCandidate, marketNeighbor, highScoreNoMarket]);

    const results = selectRelevantLocalCandidates(slice, targetKeyword, 3);

    // targetCandidate has token overlap AND is the target — gets relevance boost.
    // marketNeighbor has matching marketId → relevance boost.
    // highScoreNoMarket has no overlap and no market match → no boost.
    // Both boosted candidates should rank above highScoreNoMarket.
    const keywords = results.map(r => r.keyword);
    expect(keywords).toContain('dentist austin tx');
    expect(keywords).toContain('emergency dentist austin');
    const noMarketIdx = keywords.indexOf('national dental chain');
    const neighborIdx = keywords.indexOf('emergency dentist austin');
    // marketNeighbor should outrank the unrelated high-score candidate.
    expect(neighborIdx).toBeLessThan(noMarketIdx);
  });

  // ── Bug probe 4: disabled slice or empty candidates → always [] ────────────

  it('returns [] when slice.enabled is false', () => {
    const candidates = [makeCandidate('dentist near me', 80)];
    const slice = makeSlice(candidates, false);

    expect(selectRelevantLocalCandidates(slice, 'dentist')).toEqual([]);
    expect(selectRelevantLocalCandidates(slice, undefined)).toEqual([]);
  });

  it('returns [] when slice.candidates is empty', () => {
    const slice = makeSlice([]);

    expect(selectRelevantLocalCandidates(slice, 'dentist')).toEqual([]);
    expect(selectRelevantLocalCandidates(slice, undefined)).toEqual([]);
  });

  // ── Bug probe 5: limit is respected ─────────────────────────────────────────

  it('returns exactly limit candidates from 100 candidates', () => {
    const candidates = Array.from({ length: 100 }, (_, i) =>
      makeCandidate(`keyword-${i}`, i),
    );
    const slice = makeSlice(candidates);

    const results = selectRelevantLocalCandidates(slice, undefined, 5);
    expect(results).toHaveLength(5);
  });

  it('default limit of 15 is applied when limit not specified', () => {
    const candidates = Array.from({ length: 100 }, (_, i) =>
      makeCandidate(`keyword-${i}`, i),
    );
    const slice = makeSlice(candidates);

    const results = selectRelevantLocalCandidates(slice, undefined);
    expect(results).toHaveLength(15);
  });

  // ── Bug probe 6: token overlap ties broken by score ──────────────────────

  it('two candidates with same overlap count are broken by score (higher score wins)', () => {
    // Both share "dentist" with the target "dentist practice" — same overlap count of 1.
    const lowScore = makeCandidate('local dentist clinic', 20);
    const highScore = makeCandidate('best dentist office', 80);
    const slice = makeSlice([lowScore, highScore]);

    const results = selectRelevantLocalCandidates(slice, 'dentist practice', 2);

    // Both have overlap=1, but highScore (80) > lowScore (20),
    // so highScore should appear first.
    expect(results[0].keyword).toBe('best dentist office');
    expect(results[1].keyword).toBe('local dentist clinic');
  });

  it('candidate with higher overlap beats one with higher score but fewer overlapping tokens', () => {
    // "austin dental clinic" — 1 overlap token ("austin") with target "dentist austin texas"
    // relevance = BOOST + 1*100 + score = 1_000_000 + 100 + 50 = 1_000_150
    const oneOverlap = makeCandidate('austin dental clinic', 50);
    // "austin texas dental" — 2 overlap tokens ("austin", "texas") with target
    // relevance = BOOST + 2*100 + score = 1_000_000 + 200 + 10 = 1_000_210
    const twoOverlap = makeCandidate('austin texas dental', 10);
    const slice = makeSlice([oneOverlap, twoOverlap]);

    const results = selectRelevantLocalCandidates(slice, 'dentist austin texas', 2);

    // twoOverlap's extra 100-point overlap bonus exceeds the 40-point score gap.
    expect(results[0].keyword).toBe('austin texas dental');
  });
});

// ── P7.0 per-market regression: cross-market candidate noise ──────────────────
//
// Mirrors the documented Swish multi-market case (Austin vs Houston). Before the
// marketId passthrough, market-scoped candidates dropped their marketId, so the
// slice fell back to flat top-N and a high-scoring Austin keyword could bleed into
// a Houston-targeted selection (~27.5% cross-market noise). These tests assert
// that, once candidates carry marketId, market-A candidates do NOT appear in
// market-B's selection (and vice-versa), while market-less candidates are
// unaffected.

describe('selectRelevantLocalCandidates — per-market scoping (P7.0)', () => {
  const AUSTIN = 'market-austin';
  const HOUSTON = 'market-houston';

  // Two markets, each with its own local-variant candidates, plus a market-less
  // (market-agnostic) candidate that should remain eligible to either market.
  function swishLikeCandidates(): LocalSeoSlice['candidates'] {
    return [
      // Austin market candidates
      makeCandidate('dental implants austin', 70, AUSTIN),
      makeCandidate('emergency dentist austin', 65, AUSTIN),
      // Houston market candidates — note: a Houston candidate scored HIGHER than
      // the Austin target, so flat top-N would surface it for an Austin target.
      makeCandidate('dental implants houston', 95, HOUSTON),
      makeCandidate('emergency dentist houston', 90, HOUSTON),
      // Market-agnostic candidate (e.g. tracking/strategy source, or `near me`).
      makeCandidate('dental implants near me', 50, null),
    ];
  }

  it('does NOT bleed market-A (Houston) candidates into a market-B (Austin) selection', () => {
    const slice = makeSlice(swishLikeCandidates());

    // Target exactly matches an Austin candidate → target resolves to AUSTIN market.
    const results = selectRelevantLocalCandidates(slice, 'dental implants austin', 5);
    const keywords = results.map(r => r.keyword);

    // Austin candidates present.
    expect(keywords).toContain('dental implants austin');
    expect(keywords).toContain('emergency dentist austin');
    // Houston candidates excluded entirely — even the higher-scored ones.
    expect(keywords).not.toContain('dental implants houston');
    expect(keywords).not.toContain('emergency dentist houston');
    // Market-agnostic candidate stays eligible.
    expect(keywords).toContain('dental implants near me');
  });

  it('does NOT bleed market-B (Austin) candidates into a market-A (Houston) selection', () => {
    const slice = makeSlice(swishLikeCandidates());

    const results = selectRelevantLocalCandidates(slice, 'dental implants houston', 5);
    const keywords = results.map(r => r.keyword);

    expect(keywords).toContain('dental implants houston');
    expect(keywords).toContain('emergency dentist houston');
    expect(keywords).not.toContain('dental implants austin');
    expect(keywords).not.toContain('emergency dentist austin');
    expect(keywords).toContain('dental implants near me');
  });

  it('without marketId passthrough the higher-scored cross-market candidate WOULD win (proves the fix is load-bearing)', () => {
    // Same candidates but with marketId stripped — simulates the pre-fix state
    // where the slice dropped marketId. The Houston candidate (score 95) now
    // outranks the Austin target (score 70) because nothing scopes by market.
    const stripped: LocalSeoSlice['candidates'] = swishLikeCandidates().map(c => ({
      ...c,
      marketId: undefined,
    }));
    const slice = makeSlice(stripped);

    const results = selectRelevantLocalCandidates(slice, 'dental implants austin', 5);
    const keywords = results.map(r => r.keyword);

    // Pre-fix behavior: the Houston keyword bleeds in (token overlap + higher score).
    expect(keywords).toContain('dental implants houston');
  });

  it('market-less target behaves exactly as the prior flat heuristic (no regression)', () => {
    const slice = makeSlice(swishLikeCandidates());

    // Target is the market-less candidate → targetMarketId is null → no scoping,
    // so all candidates with token overlap remain eligible (flat behavior).
    const results = selectRelevantLocalCandidates(slice, 'dental implants near me', 5);
    const keywords = results.map(r => r.keyword);

    // Both markets' "dental implants" candidates share tokens with the target and
    // remain eligible — exactly the prior cross-market flat behavior.
    expect(keywords).toContain('dental implants houston');
    expect(keywords).toContain('dental implants austin');
    expect(keywords).toContain('dental implants near me');
  });
});

// ── P7.0 per-market regression: stratified prompt sampling ────────────────────
//
// stratifiedSample is internal to assembleLocalSeo (it feeds effectiveLocalSeoBlock).
// We exercise it through assembleLocalSeo with a tight per-market cap so a
// high-scoring market cannot crowd the other market out of the prompt block.

describe('assembleLocalSeo — per-market stratified sampling (P7.0)', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.mocked(isFeatureEnabled).mockReturnValue(true);
    vi.mocked(localSeoModule.listLocalSeoMarkets).mockReturnValue([]);
    vi.mocked(localSeoModule.buildLocalSeoKeywordCandidates).mockReturnValue([]);
    vi.mocked(localSeoModule.buildLocalSeoKeywordVisibilitySummaryByKey).mockReturnValue(new Map());
    vi.mocked(localSeoModule.listLatestLocalVisibilitySnapshots).mockReturnValue([]);
    vi.mocked(clientLocationsModule.getClientLocations).mockReturnValue([]);
  });

  it('surfaces both markets in the prompt block even when one market dominates by score', async () => {
    vi.mocked(isFeatureEnabled).mockReturnValue(true);
    vi.mocked(clientLocationsModule.getClientLocations).mockReturnValue([]);
    vi.mocked(localSeoModule.listLocalSeoMarkets).mockReturnValue([
      { id: 'market-austin', label: 'Austin, TX', status: 'active' as const, city: 'Austin', stateOrRegion: 'TX', country: 'US' } as any,
      { id: 'market-houston', label: 'Houston, TX', status: 'active' as const, city: 'Houston', stateOrRegion: 'TX', country: 'US' } as any,
    ]);
    // Houston candidates all score higher than Austin's. With flat top-N and a
    // small cap, Austin would be crowded out. Per-market stratification guarantees
    // Austin coverage.
    vi.mocked(localSeoModule.buildLocalSeoKeywordCandidates).mockReturnValue([
      { keyword: 'dental implants houston', normalizedKeyword: 'dental implants houston', source: 'local_variant', sourceLabel: 'Local candidate', marketId: 'market-houston', score: 95, selected: false, reasons: [], intent: 'transactional' },
      { keyword: 'emergency dentist houston', normalizedKeyword: 'emergency dentist houston', source: 'local_variant', sourceLabel: 'Local candidate', marketId: 'market-houston', score: 92, selected: false, reasons: [], intent: 'transactional' },
      { keyword: 'dental implants austin', normalizedKeyword: 'dental implants austin', source: 'local_variant', sourceLabel: 'Local candidate', marketId: 'market-austin', score: 60, selected: false, reasons: [], intent: 'transactional' },
      { keyword: 'emergency dentist austin', normalizedKeyword: 'emergency dentist austin', source: 'local_variant', sourceLabel: 'Local candidate', marketId: 'market-austin', score: 55, selected: false, reasons: [], intent: 'transactional' },
    ] as any);

    const result = await assembleLocalSeo('ws-stratified');
    const block = result.effectiveLocalSeoBlock;

    // Both markets' candidates appear in the sampled prompt block (annotated with
    // their marketId by renderLocalSeoBlock).
    expect(block).toContain('dental implants houston');
    expect(block).toContain('dental implants austin');
    expect(block).toContain('[market-austin]');
    expect(block).toContain('[market-houston]');
  });
});

// ── assembleLocalSeo tests ────────────────────────────────────────────────────

describe('assembleLocalSeo', () => {
  afterEach(() => {
    vi.clearAllMocks();
    // Restore default mock state.
    vi.mocked(isFeatureEnabled).mockReturnValue(true);
    vi.mocked(localSeoModule.listLocalSeoMarkets).mockReturnValue([]);
    vi.mocked(localSeoModule.buildLocalSeoKeywordCandidates).mockReturnValue([]);
    vi.mocked(localSeoModule.buildLocalSeoKeywordVisibilitySummaryByKey).mockReturnValue(new Map());
    vi.mocked(localSeoModule.listLatestLocalVisibilitySnapshots).mockReturnValue([]);
    vi.mocked(clientLocationsModule.getClientLocations).mockReturnValue([]);
  });

  // ── Bug probe: feature flag disabled → returns baseline, never throws ────────

  it('returns baseline with enabled=false and empty candidates when flag is off', async () => {
    vi.mocked(isFeatureEnabled).mockReturnValue(false);

    const result = await assembleLocalSeo('ws-flag-off');

    expect(result.enabled).toBe(false);
    expect(result.candidates).toHaveLength(0);
    expect(result.markets).toHaveLength(0);
    expect(result.locations).toHaveLength(0);
    expect(result.effectiveLocalSeoBlock).toContain('disabled');
  });

  it('does not throw when flag is off', async () => {
    vi.mocked(isFeatureEnabled).mockReturnValue(false);

    await expect(assembleLocalSeo('ws-flag-off-nothrow')).resolves.toBeDefined();
  });

  // ── Bug probe: no markets → returns locations but empty candidates ────────────

  it('returns populated locations but empty candidates when no markets are configured', async () => {
    vi.mocked(isFeatureEnabled).mockReturnValue(true);

    // Simulate confirmed locations
    vi.mocked(clientLocationsModule.getClientLocations).mockReturnValue([
      {
        id: 'loc-1',
        workspaceId: 'ws-no-markets',
        name: 'Main Office',
        isPrimary: true,
        status: 'confirmed',
      } as any,
    ]);

    // No markets configured
    vi.mocked(localSeoModule.listLocalSeoMarkets).mockReturnValue([]);

    const result = await assembleLocalSeo('ws-no-markets');

    expect(result.enabled).toBe(true);
    expect(result.markets).toHaveLength(0);
    expect(result.candidates).toHaveLength(0);
    // Locations should be populated
    expect(result.locations).toHaveLength(1);
    expect(result.locations[0].name).toBe('Main Office');
  });

  it('only includes "confirmed" locations — ignores pending/needs_review', async () => {
    vi.mocked(isFeatureEnabled).mockReturnValue(true);

    vi.mocked(clientLocationsModule.getClientLocations).mockReturnValue([
      { id: 'loc-confirmed', workspaceId: 'ws-loc', name: 'Confirmed Branch', isPrimary: false, status: 'confirmed' } as any,
      { id: 'loc-pending', workspaceId: 'ws-loc', name: 'Pending Branch', isPrimary: false, status: 'needs_review' } as any,
    ]);
    vi.mocked(localSeoModule.listLocalSeoMarkets).mockReturnValue([]);

    const result = await assembleLocalSeo('ws-loc-filter');

    expect(result.locations).toHaveLength(1);
    expect(result.locations[0].name).toBe('Confirmed Branch');
  });

  // ── Bug probe: inner failure degrades gracefully ─────────────────────────────

  it('returns baseline when an inner module throws — never re-throws', async () => {
    vi.mocked(isFeatureEnabled).mockReturnValue(true);

    // Simulate a failure in the DB-backed module
    vi.mocked(clientLocationsModule.getClientLocations).mockImplementation(() => {
      throw new Error('DB connection lost');
    });

    const result = await assembleLocalSeo('ws-inner-throw');

    // Should NOT throw — degrades gracefully to baseline
    expect(result.enabled).toBe(true);   // flag was on when baseline was created
    expect(result.candidates).toHaveLength(0);
    expect(result.markets).toHaveLength(0);
  });

  it('returns baseline when listLocalSeoMarkets throws — no re-throw', async () => {
    vi.mocked(isFeatureEnabled).mockReturnValue(true);
    vi.mocked(clientLocationsModule.getClientLocations).mockReturnValue([]);
    vi.mocked(localSeoModule.listLocalSeoMarkets).mockImplementation(() => {
      throw new Error('Market table missing');
    });

    await expect(assembleLocalSeo('ws-markets-throw')).resolves.toMatchObject({
      candidates: [],
      markets: [],
    });
  });

  it('counts notChecked per active market and dedupes duplicate market visibility entries', async () => {
    vi.mocked(isFeatureEnabled).mockReturnValue(true);
    vi.mocked(clientLocationsModule.getClientLocations).mockReturnValue([]);
    vi.mocked(localSeoModule.listLocalSeoMarkets).mockReturnValue([
      {
        id: 'market-austin',
        label: 'Austin, TX',
        status: 'active' as const,
        city: 'Austin',
        stateOrRegion: 'TX',
        country: 'US',
      } as any,
      {
        id: 'market-dallas',
        label: 'Dallas, TX',
        status: 'active' as const,
        city: 'Dallas',
        stateOrRegion: 'TX',
        country: 'US',
      } as any,
    ]);
    vi.mocked(localSeoModule.buildLocalSeoKeywordCandidates).mockReturnValue([
      {
        keyword: 'dentist austin',
        normalizedKeyword: 'dentist austin',
        source: 'local_variant',
        sourceLabel: 'Local Variant',
        score: 90,
        selected: false,
        reasons: [],
      },
      {
        keyword: 'emergency dentist',
        normalizedKeyword: 'emergency dentist',
        source: 'strategy',
        sourceLabel: 'Strategy',
        score: 75,
        selected: false,
        reasons: [],
      },
    ]);
    vi.mocked(localSeoModule.buildLocalSeoKeywordVisibilitySummaryByKey).mockReturnValue(new Map([
      ['dentist austin', {
        keyword: 'dentist austin',
        normalizedKeyword: 'dentist austin',
        marketId: 'market-austin',
        marketLabel: 'Austin, TX',
        capturedAt: '2026-05-26T00:00:00.000Z',
        posture: 'visible',
        label: 'Visible #1',
        detail: 'Visible',
        localPackPresent: true,
        businessFound: true,
        businessMatchConfidence: 'verified',
        sourceEndpoint: 'google_organic_serp',
        provider: 'dataforseo',
        marketCount: 2,
        visibleMarketCount: 1,
        possibleMatchMarketCount: 1,
        localPackOnlyMarketCount: 0,
        notVisibleMarketCount: 0,
        degradedMarketCount: 0,
        markets: [
          {
            keyword: 'dentist austin',
            normalizedKeyword: 'dentist austin',
            marketId: 'market-austin',
            marketLabel: 'Austin, TX',
            capturedAt: '2026-05-26T00:00:00.000Z',
            posture: 'possible_match',
            label: 'Possible',
            detail: 'Possible',
            localPackPresent: true,
            businessFound: true,
            businessMatchConfidence: 'possible_match',
            sourceEndpoint: 'google_organic_serp',
            provider: 'dataforseo',
          },
          {
            keyword: 'dentist austin',
            normalizedKeyword: 'dentist austin',
            marketId: 'market-austin',
            marketLabel: 'Austin, TX',
            capturedAt: '2026-05-26T00:00:00.000Z',
            posture: 'visible',
            label: 'Visible #1',
            detail: 'Visible',
            localPackPresent: true,
            businessFound: true,
            businessMatchConfidence: 'verified',
            sourceEndpoint: 'google_organic_serp',
            provider: 'dataforseo',
          },
        ],
      } as any],
    ]));
    vi.mocked(localSeoModule.listLatestLocalVisibilitySnapshots).mockReturnValue([]);

    const result = await assembleLocalSeo('ws-local-coverage');

    expect(result.visibility.visible).toBe(1);
    expect(result.visibility.possibleMatch).toBe(0);
    expect(result.visibility.notChecked).toBe(3);
  });

  // ── Happy-path smoke: full slice assembled correctly ────────────────────────

  it('assembles a full slice when markets and candidates are present', async () => {
    vi.mocked(isFeatureEnabled).mockReturnValue(true);
    vi.mocked(clientLocationsModule.getClientLocations).mockReturnValue([]);
    vi.mocked(localSeoModule.listLocalSeoMarkets).mockReturnValue([
      {
        id: 'market-1',
        label: 'Austin, TX',
        status: 'active' as const,
        city: 'Austin',
        stateOrRegion: 'TX',
        country: 'US',
        providerLocationCode: 1026201,
        workspaceId: 'ws-full',
        posture: 'local' as const,
        deviceMix: ['desktop', 'mobile'] as const,
        languageCode: 'en',
        updatedAt: '2026-01-01T00:00:00Z',
      },
    ]);
    vi.mocked(localSeoModule.buildLocalSeoKeywordCandidates).mockReturnValue([
      {
        keyword: 'dentist austin',
        normalizedKeyword: 'dentist austin',
        source: 'local_variant',
        sourceLabel: 'Local Variant',
        score: 75,
        selected: false,
        reasons: [],
      },
    ]);
    vi.mocked(localSeoModule.buildLocalSeoKeywordVisibilitySummaryByKey).mockReturnValue(new Map());
    vi.mocked(localSeoModule.listLatestLocalVisibilitySnapshots).mockReturnValue([]);

    const result = await assembleLocalSeo('ws-full');

    expect(result.enabled).toBe(true);
    expect(result.markets).toHaveLength(1);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].keyword).toBe('dentist austin');
    expect(result.effectiveLocalSeoBlock).toBeTruthy();
    // Block should mention the market
    expect(result.effectiveLocalSeoBlock).toContain('Austin, TX');
  });
});
