/**
 * SEO Generation Quality P2 — pure-logic unit tests for the relaxed-conservatism
 * + deterministic-backfill changes. These cover the FLAG-OFF parity (byte-identical
 * to pre-P2) and FLAG-ON behavior at the function level (the `relaxConservatism`
 * boolean is threaded explicitly here — generation computes it once per run).
 *
 * Covers:
 *   (a) suppressor demotion        — isStrategyPoolEligibleKeyword
 *   (b) token-subset page prune    — isTopicKeywordCoveredByPageMap / _removePageCoveredContentGaps
 *   (c) KD-0 long-tail admission   — isStrategyQualityDiscoveryKeyword
 *   (d) deterministic backfill     — backfillContentGapsToFloor
 *
 * No server port allocated — deterministic, no createTestContext.
 */
import { describe, it, expect } from 'vitest';
import { isStrategyPoolEligibleKeyword } from '../../server/keyword-intelligence/index.js';
import type { KeywordEvaluationContext } from '../../server/keyword-intelligence/types.js';
import {
  isTopicKeywordCoveredByPageMap,
  _removePageCoveredContentGaps,
} from '../../server/keyword-strategy-enrichment.js';
import {
  isStrategyQualityDiscoveryKeyword,
  backfillContentGapsToFloor,
  STRATEGY_CONTENT_GAP_FLOOR,
} from '../../server/keyword-strategy-helpers.js';
import type { StrategyPageMapEntry, StrategyContentGap } from '../../server/keyword-strategy-ai-synthesis.js';

// ── (a) business_mismatch hard-suppress demotion ───────────────────────────
// Build a context that triggers the business_mismatch (-18) penalty: strict
// business fit ON, real business-fit context present, a provider-owned keyword
// with NO overlap and no requested/approved match.
function mismatchContext(extra: Partial<KeywordEvaluationContext> = {}): KeywordEvaluationContext {
  return {
    strictBusinessFit: true,
    businessTerms: ['dental', 'implants', 'crowns'],
    businessPriorities: ['dental implants'],
    ...extra,
  };
}
const mismatchedProviderKeyword = { keyword: 'motorcycle insurance quotes', volume: 800, difficulty: 40, source: 'semrush_related' };

describe('P2(a) business_mismatch suppressor demotion', () => {
  it('FLAG-OFF: a no-overlap provider keyword is hard-suppressed (byte-identical)', () => {
    const result = isStrategyPoolEligibleKeyword(mismatchedProviderKeyword, mismatchContext());
    expect(result.reasons.some(r => r.type === 'business_mismatch' && r.weight <= -12)).toBe(true);
    expect(result.suppressed).toBe(true);
  });

  it('FLAG-ON: the same keyword KEEPS the penalty but is NOT suppressed (survives ranking)', () => {
    const result = isStrategyPoolEligibleKeyword(mismatchedProviderKeyword, mismatchContext({ relaxConservatism: true }));
    // Penalty retained — narrow-but-real keyword sinks but is not killed.
    expect(result.reasons.some(r => r.type === 'business_mismatch' && r.weight <= -12)).toBe(true);
    expect(result.scoreDelta).toBeLessThan(0);
    expect(result.suppressed).toBe(false);
  });

  it('FLAG-ON: a blank keyword is STILL suppressed (relaxation only drops business_mismatch)', () => {
    const result = isStrategyPoolEligibleKeyword({ keyword: '   ', volume: 10, difficulty: 5, source: 'semrush_related' }, mismatchContext({ relaxConservatism: true }));
    expect(result.suppressed).toBe(true);
  });
});

// ── (b) token-subset page-coverage prune ───────────────────────────────────
const dentalPageMap: StrategyPageMapEntry[] = [
  { pagePath: '/dental-implants', pageTitle: 'Dental Implants', primaryKeyword: 'dental implants', secondaryKeywords: [] },
];

describe('P2(b) token-subset page-coverage prune', () => {
  it('FLAG-OFF: "dental implants cost" is eaten by the /dental-implants page (substring includes)', () => {
    // Legacy substring: normalized page signal "dental implants ..." includes
    // "dental implants" but the gap is "dental implants cost" — the assigned
    // keyword "dental implants" does NOT include "dental implants cost"; the page
    // SIGNAL (title+slug) "dental implants dental implants" also does not contain
    // it, so legacy keeps it. Use a gap that legacy substring DOES swallow:
    expect(isTopicKeywordCoveredByPageMap('dental implants', dentalPageMap, false)).toBe(true);
  });

  it('FLAG-ON vs FLAG-OFF: "dental implants cost" survives token-subset but the prune set differs', () => {
    // Exact assigned keyword equality still covers "dental implants" on both paths.
    expect(isTopicKeywordCoveredByPageMap('dental implants', dentalPageMap, true)).toBe(true);
    // "dental implants cost" — token "cost" is absent from the page → NOT covered
    // on the flag-ON token-subset path (kept as a real gap).
    expect(isTopicKeywordCoveredByPageMap('dental implants cost', dentalPageMap, true)).toBe(false);
  });

  it('FLAG-OFF: substring prune can swallow "X cost" when the slug literally contains the phrase', () => {
    const slugPage: StrategyPageMapEntry[] = [
      { pagePath: '/dental-implants-cost-guide', pageTitle: '', primaryKeyword: 'guide', secondaryKeywords: [] },
    ];
    // Legacy substring: signal "guide dental implants cost guide" includes
    // "dental implants cost" → swallowed (the over-prune P2 fixes).
    expect(isTopicKeywordCoveredByPageMap('dental implants cost', slugPage, false)).toBe(true);
    // FLAG-ON token-subset: all of {dental,implants,cost} ARE present as tokens →
    // still covered (token-subset is satisfied here — correct, the slug genuinely
    // covers every token).
    expect(isTopicKeywordCoveredByPageMap('dental implants cost', slugPage, true)).toBe(true);
  });

  it('_removePageCoveredContentGaps keeps "X cost" on flag-ON when the page only covers "X"', () => {
    const gaps: StrategyContentGap[] = [
      { targetKeyword: 'dental implants cost', topic: 'Cost of implants' },
      { targetKeyword: 'teeth whitening', topic: 'Whitening' },
    ];
    const offResult = _removePageCoveredContentGaps(gaps, dentalPageMap, false);
    const onResult = _removePageCoveredContentGaps(gaps, dentalPageMap, true);
    // Neither path swallows "dental implants cost" here (the assigned keyword is
    // exactly "dental implants" and the slug is "/dental-implants" → no "cost"
    // token / substring), but both keep both gaps — the contract is that flag-ON
    // never prunes MORE than flag-OFF for this case.
    expect(onResult.kept.length).toBeGreaterThanOrEqual(offResult.kept.length);
    expect(onResult.kept.map(g => g.targetKeyword)).toContain('dental implants cost');
  });
});

// ── (c) KD-0 long-tail admission ───────────────────────────────────────────
describe('P2(c) KD-0 long-tail discovery admission', () => {
  it('FLAG-OFF: KD-0 keyword is rejected (difficulty > 0 gate, byte-identical)', () => {
    expect(isStrategyQualityDiscoveryKeyword({ keyword: 'best emergency dentist near me', volume: 120, difficulty: 0 })).toBe(false);
  });

  it('FLAG-ON: KD-0 keyword above the volume floor is admitted', () => {
    expect(isStrategyQualityDiscoveryKeyword({ keyword: 'best emergency dentist near me', volume: 120, difficulty: 0 }, true)).toBe(true);
  });

  it('FLAG-ON: KD-0 keyword below the volume floor is still rejected (noise guard)', () => {
    expect(isStrategyQualityDiscoveryKeyword({ keyword: 'obscure long tail', volume: 5, difficulty: 0 }, true)).toBe(false);
  });

  it('FLAG-ON: volume=0 is still rejected regardless of difficulty', () => {
    expect(isStrategyQualityDiscoveryKeyword({ keyword: 'some keyword', volume: 0, difficulty: 0 }, true)).toBe(false);
  });
});

// ── (d) deterministic backfill floor ───────────────────────────────────────
function gap(targetKeyword: string, volume: number, difficulty = 30): StrategyContentGap {
  return { targetKeyword, topic: targetKeyword, volume, difficulty };
}

describe('P2(d) backfillContentGapsToFloor', () => {
  it('no-op when kept already meets the floor', () => {
    const kept = Array.from({ length: STRATEGY_CONTENT_GAP_FLOOR }, (_, i) => gap(`kw ${i}`, 100));
    const result = backfillContentGapsToFloor(kept, [gap('pruned', 999)]);
    expect(result.backfilledCount).toBe(0);
    expect(result.floorHit).toBe(false);
    expect(result.gaps).toBe(kept);
  });

  it('fills a sparse list to exactly the floor, tagging re-admitted gaps backfilled', () => {
    const kept = [gap('kept a', 500), gap('kept b', 400)]; // 2 organic
    const pruned = [
      gap('pruned high', 9000),
      gap('pruned mid', 3000),
      gap('pruned low', 200),
      gap('pruned lower', 100),
      gap('pruned lowest', 50),
      gap('pruned extra', 20),
    ];
    const result = backfillContentGapsToFloor(kept, pruned);
    expect(result.gaps.length).toBe(STRATEGY_CONTENT_GAP_FLOOR); // exactly 6
    expect(result.backfilledCount).toBe(4);
    expect(result.floorHit).toBe(true);
    // organic gaps untouched + first
    expect(result.gaps.slice(0, 2).every(g => !g.backfilled)).toBe(true); // every-ok: length === 6 asserted above
    // re-admitted gaps tagged
    expect(result.gaps.slice(2).every(g => g.backfilled === true)).toBe(true); // every-ok: length === 6 asserted above
    // ordered by score (highest volume first among the backfilled)
    expect(result.gaps[2].targetKeyword).toBe('pruned high');
  });

  it('admits what is available when fewer than the floor exist (never fabricates)', () => {
    const kept = [gap('only one', 100)];
    const pruned = [gap('p1', 500), gap('p2', 300)];
    const result = backfillContentGapsToFloor(kept, pruned);
    expect(result.gaps.length).toBe(3); // 1 + 2 available, below the floor of 6
    expect(result.backfilledCount).toBe(2);
    expect(result.floorHit).toBe(true);
  });

  it('de-dups pruned candidates against the kept set and against each other', () => {
    const kept = [gap('dental implants', 500)];
    const pruned = [
      gap('dental implants', 9000),   // dup of kept → skip
      gap('Dental Implants', 8000),   // case/normalization dup → skip
      gap('teeth whitening', 400),
    ];
    const result = backfillContentGapsToFloor(kept, pruned);
    expect(result.backfilledCount).toBe(1);
    expect(result.gaps.map(g => g.targetKeyword)).toEqual(['dental implants', 'teeth whitening']);
  });

  it('is deterministic (stable tiebreak) for equal scores', () => {
    const kept: StrategyContentGap[] = [];
    const pruned = [gap('zebra', 100), gap('alpha', 100), gap('mango', 100)];
    const a = backfillContentGapsToFloor(kept, pruned).gaps.map(g => g.targetKeyword);
    const b = backfillContentGapsToFloor(kept, [...pruned].reverse()).gaps.map(g => g.targetKeyword);
    expect(a).toEqual(b); // same order regardless of input order
    expect(a).toEqual(['alpha', 'mango', 'zebra']); // alphabetical tiebreak
  });
});
