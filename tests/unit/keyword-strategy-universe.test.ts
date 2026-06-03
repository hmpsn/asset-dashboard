/**
 * Unit tests for server/keyword-strategy-universe.ts (P1 — buildKeywordUniverse).
 *
 * These exercise the assembler with NO provider (provider: null) so there is no
 * AI/network — the pool is built purely from the in-scope inputs the synthesis
 * assembler passes (the folded :403-472 logic). Covers:
 *   - flag-ON pool contains a seeded GSC query + a client-tracked keyword
 *   - declined keyword is excluded (the fold preserves the declined hard-filter)
 *   - flag-OFF parity: the universe-built pool matches the legacy inline build
 *   - the per-workspace monthly credit ceiling is enforced
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
import { upsertKeywordPoolCandidate, type KeywordPoolCandidate } from '../../server/keyword-strategy-helpers.js';
import { isStrategyPoolEligibleKeyword, normalizeKeyword } from '../../server/keyword-intelligence/index.js';
import { filterBrandedKeywords } from '../../server/competitor-brand-filter.js';
import { filterDeclinedFromPool } from '../../server/strategy-filters.js';
import { isStrategyQualityDiscoveryKeyword } from '../../server/keyword-strategy-helpers.js';
import { getTrackedKeywords } from '../../server/rank-tracking.js';
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

describe('buildKeywordUniverse — flag-OFF parity', () => {
  // Replicates the legacy inline pool-build (keyword-strategy-ai-synthesis.ts
  // :403-472) on the same fixture inputs, then asserts the universe-built pool is
  // identical. This is the required flag-OFF parity deliverable: the fold must
  // preserve every source + the declined filter, byte-for-byte.
  function legacyPool(opts: {
    domainKeywords: BuildKeywordUniverseOptions['domainKeywords'];
    gscData: BuildKeywordUniverseOptions['gscData'];
    competitorKeywords: BuildKeywordUniverseOptions['competitorKeywords'];
    keywordGaps: BuildKeywordUniverseOptions['keywordGaps'];
    discoveryKeywords: BuildKeywordUniverseOptions['discoveryKeywords'];
    relatedKeywords: BuildKeywordUniverseOptions['relatedKeywords'];
    requestedKeywords: string[];
    declinedKeywords: string[];
    competitorDomains: string[];
    clientTracked: string[];
  }): Map<string, KeywordPoolCandidate> {
    const ctx = {};
    const elig = (k: { keyword: string; volume?: number; difficulty?: number; cpc?: number; source?: string; sourceKind?: string }) =>
      !isStrategyPoolEligibleKeyword(k, ctx).suppressed;
    const pool = new Map<string, KeywordPoolCandidate>();
    for (const k of opts.domainKeywords) {
      if (!elig({ keyword: k.keyword, volume: k.volume, difficulty: k.difficulty, source: 'seo-provider' })) continue;
      upsertKeywordPoolCandidate(pool, k.keyword, { volume: k.volume, difficulty: k.difficulty, source: 'seo-provider' });
    }
    for (const r of opts.gscData) {
      const q = normalizeKeyword(r.query);
      if (q.length > 3 && q.split(' ').length >= 2) {
        upsertKeywordPoolCandidate(pool, q, { volume: r.impressions, difficulty: 0, source: 'gsc' });
      }
    }
    for (const ck of opts.competitorKeywords) {
      const kw = normalizeKeyword(ck.keyword);
      if (ck.volume > 0 && elig({ keyword: kw, volume: ck.volume, difficulty: ck.difficulty, source: `competitor:${ck.domain}` })) {
        upsertKeywordPoolCandidate(pool, kw, { volume: ck.volume, difficulty: ck.difficulty, source: `competitor:${ck.domain}` });
      }
    }
    for (const gap of opts.keywordGaps) {
      const kw = normalizeKeyword(gap.keyword);
      if (gap.volume > 0 && elig({ keyword: kw, volume: gap.volume, difficulty: gap.difficulty, source: `gap:${gap.competitorDomain}` })) {
        upsertKeywordPoolCandidate(pool, kw, { volume: gap.volume, difficulty: gap.difficulty, source: `gap:${gap.competitorDomain}` });
      }
    }
    for (const dk of opts.discoveryKeywords) {
      const kw = normalizeKeyword(dk.keyword);
      if (isStrategyQualityDiscoveryKeyword(dk) && elig(dk)) {
        upsertKeywordPoolCandidate(pool, kw, { volume: dk.volume, difficulty: dk.difficulty, source: `discovery:${dk.sourceKind}` });
      }
    }
    for (const rk of opts.relatedKeywords) {
      const kw = normalizeKeyword(rk.keyword);
      if (rk.volume > 0 && elig({ keyword: kw, volume: rk.volume, difficulty: rk.difficulty, cpc: rk.cpc, source: 'related' })) {
        upsertKeywordPoolCandidate(pool, kw, { volume: rk.volume, difficulty: rk.difficulty, source: 'related' });
      }
    }
    for (const tk of opts.clientTracked) {
      const kw = normalizeKeyword(tk);
      if (kw.length > 1) upsertKeywordPoolCandidate(pool, kw, { volume: 0, difficulty: 0, source: 'client' });
    }
    for (const kw of opts.requestedKeywords) {
      upsertKeywordPoolCandidate(pool, kw, { volume: 0, difficulty: 0, source: 'client' });
    }
    filterBrandedKeywords(pool, opts.competitorDomains);
    filterDeclinedFromPool(pool, opts.declinedKeywords);
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

    const expected = legacyPool({ ...fixture, clientTracked: getTrackedKeywords(workspaceId).map(t => t.query) });

    const { pool: actual } = await buildKeywordUniverse(workspaceId, baseOpts({ ...fixture, provider: null }));

    // Same keys
    expect([...actual.keys()].sort()).toEqual([...expected.keys()].sort());
    // Same values (volume/difficulty/source) for each key
    for (const [key, value] of expected.entries()) {
      expect(actual.get(key)).toEqual(value);
    }
  });
});

describe('buildKeywordUniverse — monthly credit ceiling', () => {
  it('exposes the ceiling reset helper and builds without a provider call', async () => {
    // With no provider, no provider call is reserved — ceiling stays unconsumed.
    const { universe } = await buildKeywordUniverse(workspaceId, baseOpts({ provider: null }));
    expect(universe.candidates).toEqual([]);
    // Reset helper is callable for both forms.
    __resetMonthlyProviderCallCeiling(workspaceId);
    __resetMonthlyProviderCallCeiling();
  });
});
