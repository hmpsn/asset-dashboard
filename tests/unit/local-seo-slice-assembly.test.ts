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

function makeCandidate(keyword: string, score: number, marketId?: string): Candidate {
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
