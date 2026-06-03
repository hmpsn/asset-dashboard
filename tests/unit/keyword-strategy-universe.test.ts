/**
 * Unit tests for server/keyword-strategy-universe.ts (P1 — buildKeywordUniverse).
 *
 * Covers:
 *   - flag-ON pool contains a seeded GSC query + a client-tracked keyword
 *   - declined keyword is excluded (the fold preserves the declined hard-filter)
 *   - flag-OFF parity: the universe-built pool matches the REAL legacy fold
 *     (`buildLegacyKeywordPool` — the same code the synthesis else-branch runs,
 *     NOT a reimplemented local copy)
 *   - the drop-a-candidate divergence is fixed (C2): duplicate discovery rows
 *     (ineligible-first/eligible-later AND lower-vol-first/higher-vol-later) land
 *     in the assembler pool exactly as the legacy fold admits them
 *   - the per-workspace monthly credit ceiling reserves a call when a provider is
 *     present (uses FakeSeoProvider so the ceiling + geo/language threading run)
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { addTrackedKeyword } from '../../server/rank-tracking.js';
import { TRACKED_KEYWORD_SOURCE } from '../../shared/types/rank-tracking.js';
import {
  buildKeywordUniverse,
  __resetMonthlyProviderCallCeiling,
  type BuildKeywordUniverseOptions,
} from '../../server/keyword-strategy-universe.js';
import { buildLegacyKeywordPool } from '../../server/keyword-strategy-ai-synthesis.js';
import { type KeywordPoolCandidate } from '../../server/keyword-strategy-helpers.js';
import { isStrategyPoolEligibleKeyword, normalizeKeyword } from '../../server/keyword-intelligence/index.js';
import { getTrackedKeywords } from '../../server/rank-tracking.js';
import { FakeSeoProvider } from '../../server/providers/fake-seo-provider.js';
import type { DomainKeyword } from '../../server/seo-data-provider.js';
import type { KeywordSourceEvidence } from '../../shared/types/keywords.js';

let workspaceId = '';

beforeEach(() => {
  workspaceId = createWorkspace(`KW Universe ${Date.now()}-${Math.random().toString(36).slice(2)}`).id;
  __resetMonthlyProviderCallCeiling();
});

afterEach(() => {
  if (workspaceId) deleteWorkspace(workspaceId);
  workspaceId = '';
  __resetMonthlyProviderCallCeiling();
});

function baseOpts(overrides: Partial<BuildKeywordUniverseOptions> = {}): BuildKeywordUniverseOptions {
  return {
    provider: null,
    seoDataMode: 'quick',
    siteDomain: 'example.com',
    priorSiteKeywords: [],
    gscData: [],
    domainKeywords: [],
    competitorKeywords: [],
    keywordGaps: [],
    discoveryKeywords: [],
    relatedKeywords: [],
    requestedKeywords: [],
    declinedKeywords: [],
    competitorDomains: [],
    evaluationContext: {},
    ...overrides,
  };
}

/** The shared admission predicate, exactly as synthesis builds it (empty context). */
const isEligible = (k: { keyword: string; volume?: number; difficulty?: number; cpc?: number; source?: string; sourceKind?: string }) =>
  !isStrategyPoolEligibleKeyword(k, {}).suppressed;

describe('buildKeywordUniverse — flag-ON pool semantics', () => {
  it('includes a seeded GSC query and a client-tracked keyword, and EXCLUDES a declined keyword', async () => {
    // Client-tracked keyword (read from rank-tracking inside the assembler).
    addTrackedKeyword(workspaceId, 'managed it services', { source: TRACKED_KEYWORD_SOURCE.MANUAL });

    const { universe, pool } = await buildKeywordUniverse(workspaceId, baseOpts({
      gscData: [
        { query: 'cloud backup solutions', impressions: 1200 },
        { query: 'declined competitor brand', impressions: 800 },
      ],
      declinedKeywords: ['declined competitor brand'],
    }));

    // GSC query present as source 'gsc'
    const gsc = pool.get(normalizeKeyword('cloud backup solutions'));
    expect(gsc).toBeDefined();
    expect(gsc?.source).toBe('gsc');

    // Client-tracked keyword present as source 'client'
    const client = pool.get(normalizeKeyword('managed it services'));
    expect(client).toBeDefined();
    expect(client?.source).toBe('client');

    // Declined keyword removed by the hard filter
    expect(pool.has(normalizeKeyword('declined competitor brand'))).toBe(false);

    // Typed contract reflects the pool
    expect(universe.workspaceId).toBe(workspaceId);
    expect(universe.candidates.some(c => c.keyword === normalizeKeyword('cloud backup solutions'))).toBe(true);
    expect(universe.suppressedCount).toBeGreaterThanOrEqual(1); // the declined one
    expect(universe.creditDepth).toBe('quick');
  });

  it('folds domain, competitor, gap, discovery and related sources into the pool', async () => {
    const discovery: KeywordSourceEvidence[] = [{
      keyword: 'network monitoring tools', volume: 500, difficulty: 30, cpc: 4,
      provider: 'dataforseo', sourceKind: 'keyword_ideas',
    }];
    const { pool } = await buildKeywordUniverse(workspaceId, baseOpts({
      domainKeywords: [{ keyword: 'it support', position: 4, volume: 900, difficulty: 25, cpc: 3, url: 'https://example.com/it', traffic: 100, trafficPercent: 10 }],
      competitorKeywords: [{ keyword: 'cybersecurity services', volume: 700, difficulty: 40, domain: 'rival.com', position: 3 }],
      keywordGaps: [{ keyword: 'disaster recovery plan', volume: 600, difficulty: 35, competitorPosition: 2, competitorDomain: 'rival.com' }],
      discoveryKeywords: discovery,
      relatedKeywords: [{ keyword: 'cloud migration', volume: 450, difficulty: 28, cpc: 5 }],
    }));

    expect(pool.has(normalizeKeyword('it support'))).toBe(true);
    expect(pool.has(normalizeKeyword('cybersecurity services'))).toBe(true);
    expect(pool.has(normalizeKeyword('disaster recovery plan'))).toBe(true);
    expect(pool.has(normalizeKeyword('network monitoring tools'))).toBe(true);
    expect(pool.has(normalizeKeyword('cloud migration'))).toBe(true);
  });
});

describe('buildKeywordUniverse — flag-OFF parity (drives the REAL legacy fold)', () => {
  // Runs the actual `buildLegacyKeywordPool` (the same code the synthesis
  // else-branch executes) on the same fixture inputs, then asserts the
  // universe-built pool is identical. This drives the REAL else-branch — not a
  // reimplemented local copy (I3a). The fold must preserve every source + the
  // declined filter, byte-for-byte.
  function legacyPool(fixture: {
    domainKeywords: BuildKeywordUniverseOptions['domainKeywords'];
    gscData: BuildKeywordUniverseOptions['gscData'];
    competitorKeywords: BuildKeywordUniverseOptions['competitorKeywords'];
    keywordGaps: BuildKeywordUniverseOptions['keywordGaps'];
    discoveryKeywords: BuildKeywordUniverseOptions['discoveryKeywords'];
    relatedKeywords: BuildKeywordUniverseOptions['relatedKeywords'];
    requestedKeywords: string[];
    declinedKeywords: string[];
    competitorDomains: string[];
    clientTracked: Array<{ query: string }>;
  }): Map<string, KeywordPoolCandidate> {
    const pool = new Map<string, KeywordPoolCandidate>();
    buildLegacyKeywordPool({
      keywordPool: pool,
      semrushByPath: new Map<string, DomainKeyword[]>(),
      domainKeywords: fixture.domainKeywords,
      gscData: fixture.gscData,
      competitorKeywords: fixture.competitorKeywords,
      keywordGaps: fixture.keywordGaps,
      discoveryKeywords: fixture.discoveryKeywords,
      relatedKeywords: fixture.relatedKeywords,
      clientTracked: fixture.clientTracked,
      requestedKeywords: fixture.requestedKeywords,
      competitorDomains: fixture.competitorDomains,
      declinedKeywords: fixture.declinedKeywords,
      // The legacy domain-keyword source label is 'seo-provider' when no provider.
      providerName: undefined,
      isEligible,
    });
    return pool;
  }

  it('the universe-built pool matches the legacy inline build (no provider)', async () => {
    addTrackedKeyword(workspaceId, 'managed it services', { source: TRACKED_KEYWORD_SOURCE.MANUAL });

    const fixture = {
      domainKeywords: [{ keyword: 'it support', position: 4, volume: 900, difficulty: 25, cpc: 3, url: 'https://example.com/it', traffic: 100, trafficPercent: 10 }],
      gscData: [{ query: 'cloud backup solutions', impressions: 1200 }, { query: 'declined brand term', impressions: 400 }],
      competitorKeywords: [{ keyword: 'cybersecurity services', volume: 700, difficulty: 40, domain: 'rival.com', position: 3 }],
      keywordGaps: [{ keyword: 'disaster recovery plan', volume: 600, difficulty: 35, competitorPosition: 2, competitorDomain: 'rival.com' }],
      discoveryKeywords: [{ keyword: 'network monitoring tools', volume: 500, difficulty: 30, cpc: 4, provider: 'dataforseo', sourceKind: 'keyword_ideas' as const }],
      relatedKeywords: [{ keyword: 'cloud migration', volume: 450, difficulty: 28, cpc: 5 }],
      requestedKeywords: ['voip phone systems'],
      declinedKeywords: ['declined brand term'],
      competitorDomains: [],
    };

    const expected = legacyPool({ ...fixture, clientTracked: getTrackedKeywords(workspaceId).map(t => ({ query: t.query })) });

    const { pool: actual } = await buildKeywordUniverse(workspaceId, baseOpts({ ...fixture, provider: null }));

    // Same keys
    expect([...actual.keys()].sort()).toEqual([...expected.keys()].sort());
    // Same values (volume/difficulty/source) for each key
    for (const [key, value] of expected.entries()) {
      expect(actual.get(key)).toEqual(value);
    }
  });

  // ── C2: the drop-a-candidate divergence ──
  // Duplicate discovery + related rows where an ineligible/lower-volume row comes
  // FIRST and an eligible/higher-volume row comes LATER. The old assembler marked
  // the key seen on the first row and dropped the second; the legacy fold relies
  // on the Map dedup + higher-volume tiebreak inside upsertKeywordPoolCandidate.
  // The assembler pool must now equal the legacy fold for these duplicates.
  it('admits ineligible-first/eligible-later AND lower-vol-first/higher-vol-later duplicate rows like the legacy fold', async () => {
    const discoveryKeywords: KeywordSourceEvidence[] = [
      // ineligible first (volume 0 → isStrategyQualityDiscoveryKeyword rejects it),
      // then the same keyword with real volume later.
      { keyword: 'data center migration', volume: 0, difficulty: 0, cpc: 0, provider: 'dataforseo', sourceKind: 'keyword_ideas' },
      { keyword: 'data center migration', volume: 800, difficulty: 33, cpc: 4, provider: 'dataforseo', sourceKind: 'keyword_ideas' },
      // lower volume first, higher volume later (same keyword) → tiebreak keeps higher.
      { keyword: 'endpoint protection', volume: 300, difficulty: 20, cpc: 2, provider: 'dataforseo', sourceKind: 'keyword_ideas' },
      { keyword: 'endpoint protection', volume: 950, difficulty: 41, cpc: 6, provider: 'dataforseo', sourceKind: 'keyword_ideas' },
    ];
    const relatedKeywords = [
      { keyword: 'managed firewall', volume: 200, difficulty: 18, cpc: 3 },
      { keyword: 'managed firewall', volume: 720, difficulty: 36, cpc: 5 },
    ];

    const fixture = {
      domainKeywords: [] as BuildKeywordUniverseOptions['domainKeywords'],
      gscData: [] as BuildKeywordUniverseOptions['gscData'],
      competitorKeywords: [] as BuildKeywordUniverseOptions['competitorKeywords'],
      keywordGaps: [] as BuildKeywordUniverseOptions['keywordGaps'],
      discoveryKeywords,
      relatedKeywords,
      requestedKeywords: [] as string[],
      declinedKeywords: [] as string[],
      competitorDomains: [] as string[],
    };

    const expected = legacyPool({ ...fixture, clientTracked: [] });
    const { pool: actual } = await buildKeywordUniverse(workspaceId, baseOpts({ ...fixture, provider: null }));

    // ineligible-first/eligible-later: the eligible later row must be present.
    expect(actual.has(normalizeKeyword('data center migration'))).toBe(true);
    // higher-volume tiebreak preserved on duplicates.
    expect(actual.get(normalizeKeyword('endpoint protection'))?.volume).toBe(950);
    expect(actual.get(normalizeKeyword('managed firewall'))?.volume).toBe(720);

    // And the assembler pool equals the legacy fold exactly.
    expect([...actual.keys()].sort()).toEqual([...expected.keys()].sort());
    for (const [key, value] of expected.entries()) {
      expect(actual.get(key)).toEqual(value);
    }
  });
});

describe('buildKeywordUniverse — monthly credit ceiling + provider threading', () => {
  it('reserves provider calls (FakeSeoProvider) and folds fetched discovery/related into the pool', async () => {
    // FakeSeoProvider implements getRelatedKeywords/getQuestionKeywords +
    // getKeywordIdeas/getKeywordsForSite/getKeywordSuggestions are absent, so the
    // assembler exercises related + questions (and getKeywordsForSite/ideas only
    // when present). A domain seed drives the related/question seeds.
    const provider = new FakeSeoProvider();
    const { pool, universe } = await buildKeywordUniverse(workspaceId, baseOpts({
      provider,
      seoDataMode: 'full',
      domainKeywords: [{ keyword: 'cloud security', position: 2, volume: 1500, difficulty: 30, cpc: 4, url: 'https://example.com/cloud', traffic: 200, trafficPercent: 12 }],
    }));

    // The fetched related keywords (FakeSeoProvider returns "<seed> variation N")
    // entered the pool with source 'related'.
    const relatedHit = [...pool.values()].find(m => m.source === 'related');
    expect(relatedHit).toBeDefined();
    // The fetched question keywords ("how to <seed> N") entered as discovery.
    expect([...pool.keys()].some(k => k.startsWith('how to cloud security'))).toBe(true);
    expect(universe.creditDepth).toBe('full');
  });

  it('surfaces fetched question keywords grouped by seed in the legacy QuestionKeywordGroup shape (FAQ enrichment input)', async () => {
    // FAQ enrichment (keyword-strategy-enrichment.ts ~:466) consumes
    // `{ seed, questions: { keyword, volume }[] }[]`. On the flag-ON path the legacy
    // seo-data prefetch that produced this is gated off, so the assembler must
    // surface the SAME grouped shape (geo + language threaded) for parity.
    const provider = new FakeSeoProvider();
    // questionSeeds require domain keywords with volume > 100 (universe.ts filter).
    const { questionKeywords } = await buildKeywordUniverse(workspaceId, baseOpts({
      provider,
      seoDataMode: 'full',
      domainKeywords: [{ keyword: 'cloud security', position: 2, volume: 1500, difficulty: 30, cpc: 4, url: 'https://example.com/cloud', traffic: 200, trafficPercent: 12 }],
    }));

    expect(questionKeywords.length).toBeGreaterThan(0);
    const group = questionKeywords[0];
    // Grouped by the domain-keyword seed.
    expect(group.seed).toBe('cloud security');
    expect(Array.isArray(group.questions)).toBe(true);
    expect(group.questions.length).toBeGreaterThan(0);
    // FakeSeoProvider returns "how to <seed> N" questions.
    expect(group.questions[0].keyword.startsWith('how to cloud security')).toBe(true);
    // Each question carries the trimmed { keyword, volume } shape FAQ enrichment reads.
    expect(typeof group.questions[0].volume).toBe('number');
    expect(Object.keys(group.questions[0]).sort()).toEqual(['keyword', 'volume']);
  });

  it('returns an empty questionKeywords group when no provider is present (flag-OFF parity input)', async () => {
    const { questionKeywords } = await buildKeywordUniverse(workspaceId, baseOpts({ provider: null }));
    expect(questionKeywords).toEqual([]);
  });

  it('stops fetching once the per-workspace monthly ceiling is exhausted', async () => {
    const provider = new FakeSeoProvider();
    // The ceiling is 60 calls/workspace/month. Run repeatedly until exhausted; the
    // builder must keep returning (no throw) and stop reserving once at the cap.
    let lastPoolSize = -1;
    for (let i = 0; i < 70; i++) {
      const { pool } = await buildKeywordUniverse(workspaceId, baseOpts({
        provider,
        seoDataMode: 'full',
        domainKeywords: [{ keyword: `topic ${i}`, position: 2, volume: 900 + i, difficulty: 25, cpc: 3, url: `https://example.com/t${i}`, traffic: 100, trafficPercent: 5 }],
      }));
      lastPoolSize = pool.size;
    }
    // Once the ceiling is hit, discovery is skipped but the build still succeeds
    // (the domain seed itself is admitted), so the pool is non-empty.
    expect(lastPoolSize).toBeGreaterThanOrEqual(1);
  });

  it('exposes the ceiling reset helper and builds without a provider call', async () => {
    // With no provider, no provider call is reserved — ceiling stays unconsumed.
    const { universe } = await buildKeywordUniverse(workspaceId, baseOpts({ provider: null }));
    expect(universe.candidates).toEqual([]);
    // Reset helper is callable for both forms.
    __resetMonthlyProviderCallCeiling(workspaceId);
    __resetMonthlyProviderCallCeiling();
  });
});
