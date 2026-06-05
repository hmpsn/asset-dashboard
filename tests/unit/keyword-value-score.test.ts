import { describe, it, expect } from 'vitest';
import {
  toValueIntent, deriveValueIntent, valueIntentWeight, isLocalKeyword,
  localRelevanceMultiplier, computeKeywordValueScore, computeKeywordValueComponents,
  type ScoringContext,
} from '../../server/scoring/keyword-value-score.js';

const NON_LOCAL: ScoringContext = { posture: 'non_local', markets: [] };
const LOCAL: ScoringContext = { posture: 'local', markets: [], city: 'sarasota', state: 'florida' };

describe('toValueIntent (5→4 adapter)', () => {
  it('maps comparison → commercial', () => expect(toValueIntent('comparison')).toBe('commercial'));
  it('passes the 4 buckets through', () => {
    for (const v of ['transactional', 'commercial', 'informational', 'navigational'] as const) {
      expect(toValueIntent(v)).toBe(v);
    }
  });
  it('returns null for unknown / nullish', () => {
    expect(toValueIntent('frobnicate')).toBeNull();
    expect(toValueIntent(null)).toBeNull();
    expect(toValueIntent(undefined)).toBeNull();
  });
});

describe('deriveValueIntent', () => {
  it('prefers a valid provided intent over the regex', () => {
    expect(deriveValueIntent('teeth cleaning sarasota', 'informational')).toBe('informational');
  });
  it('falls back to the regex classifier when none provided', () => {
    expect(deriveValueIntent('what causes bad breath')).toBe('informational'); // question-word prefix
    expect(deriveValueIntent('teeth cleaning sarasota')).toBe('transactional'); // regex default
    expect(deriveValueIntent('dentist vs orthodontist')).toBe('commercial');    // comparison → commercial
  });
});

describe('valueIntentWeight', () => {
  it('weights the 4 buckets and defaults 0.5 on null', () => {
    expect(valueIntentWeight('transactional')).toBe(1.0);
    expect(valueIntentWeight('commercial')).toBe(0.7);
    expect(valueIntentWeight('informational')).toBeCloseTo(0.3);
    expect(valueIntentWeight('navigational')).toBe(0.2);
    expect(valueIntentWeight(null)).toBe(0.5);
  });
});

describe('isLocalKeyword (pure)', () => {
  it('true on near-me / city match / service term', () => {
    expect(isLocalKeyword('dentist near me', NON_LOCAL)).toBe(true);     // hasMarketModifier near-me
    expect(isLocalKeyword('teeth cleaning sarasota', LOCAL)).toBe(true);  // ctx.city
    expect(isLocalKeyword('invisalign cost', NON_LOCAL)).toBe(true);      // service regex
  });
  it('false on a national non-service term', () => {
    expect(isLocalKeyword('what causes bad breath', NON_LOCAL)).toBe(false);
  });
});

describe('localRelevanceMultiplier', () => {
  it('non_local / unknown is a strict no-op', () => {
    expect(localRelevanceMultiplier('non_local', true, 'transactional')).toBe(1.0);
    expect(localRelevanceMultiplier('unknown', false, 'informational')).toBe(1.0);
  });
  it('local boosts local, demotes national-informational, spares national transactional (D5)', () => {
    expect(localRelevanceMultiplier('local', true, 'transactional')).toBe(1.5);
    expect(localRelevanceMultiplier('local', false, 'informational')).toBe(0.6);
    expect(localRelevanceMultiplier('local', false, 'transactional')).toBe(1.0); // D5
  });
  it('hybrid is the moderate version', () => {
    expect(localRelevanceMultiplier('hybrid', true, 'commercial')).toBe(1.25);
    expect(localRelevanceMultiplier('hybrid', false, 'informational')).toBe(0.9);
  });
});

describe('computeKeywordValueScore', () => {
  it('signal gate: returns undefined for a fully data-less, no-provided-intent input', () => {
    expect(computeKeywordValueScore({ keyword: 'anything at all' }, NON_LOCAL)).toBeUndefined();
  });
  it('a regex-derived intent does NOT rescue a metric-less keyword', () => {
    // "best dentist" classifies commercial via regex, but no volume/impr/diff/cpc and no PROVIDED intent → gated out
    expect(computeKeywordValueScore({ keyword: 'best dentist' }, NON_LOCAL)).toBeUndefined();
  });
  it('value-first: high-volume informational ranks below modest transactional (no CPC, non_local)', () => {
    const info = computeKeywordValueScore({ keyword: 'what causes bad breath', volume: 30000, difficulty: 15 }, NON_LOCAL)!;
    const txn  = computeKeywordValueScore({ keyword: 'teeth cleaning service', volume: 400, difficulty: 70, intent: 'transactional' }, NON_LOCAL)!;
    expect(txn).toBeGreaterThan(info);
  });
  it('§5.1 counterexample: low-difficulty high-volume informational < high-difficulty transactional (non_local)', () => {
    const info = computeKeywordValueScore({ keyword: 'what is teeth whitening', volume: 50000, difficulty: 0 }, NON_LOCAL)!;
    const txn  = computeKeywordValueScore({ keyword: 'buy whitening kit', volume: 100, difficulty: 95, cpc: 6, intent: 'transactional' }, NON_LOCAL)!;
    expect(txn).toBeGreaterThan(info);
  });
  it('named regression: sarasota transactional ≫ bad-breath informational under local posture', () => {
    const breath   = computeKeywordValueScore({ keyword: 'what causes bad breath', volume: 22000, difficulty: 40 }, LOCAL)!;
    const sarasota = computeKeywordValueScore({ keyword: 'teeth cleaning sarasota', volume: 480, difficulty: 30, cpc: 6 }, LOCAL)!;
    expect(sarasota).toBeGreaterThan(breath);
    expect(breath).toBeLessThan(15);
  });
  it('known high CPC lifts a transactional keyword above the same intent with low CPC', () => {
    const hi = computeKeywordValueScore({ keyword: 'commercial roofing quote', volume: 500, difficulty: 40, cpc: 20, intent: 'transactional' }, NON_LOCAL)!;
    const lo = computeKeywordValueScore({ keyword: 'commercial roofing price', volume: 500, difficulty: 40, cpc: 1, intent: 'transactional' }, NON_LOCAL)!;
    expect(hi).toBeGreaterThan(lo);
  });
  it('within tier, demand/winnability order two same-intent keywords', () => {
    const easy = computeKeywordValueScore({ keyword: 'service a', volume: 9000, difficulty: 10, intent: 'transactional' }, NON_LOCAL)!;
    const hard = computeKeywordValueScore({ keyword: 'service b', volume: 200, difficulty: 90, intent: 'transactional' }, NON_LOCAL)!;
    expect(easy).toBeGreaterThan(hard);
  });
  it('impression-only keyword (volume 0) takes its demand from impressions, not 0', () => {
    // volume:0 (providers coerce absent volume to 0) must NOT mask real impressions —
    // within-tier, higher impressions ⇒ higher score for a not-yet-ranking keyword.
    const hiImpr = computeKeywordValueScore({ keyword: 'service a', volume: 0, impressions: 8000, difficulty: 30, intent: 'transactional' }, NON_LOCAL)!;
    const loImpr = computeKeywordValueScore({ keyword: 'service b', volume: 0, impressions: 50, difficulty: 30, intent: 'transactional' }, NON_LOCAL)!;
    expect(hiImpr).toBeGreaterThan(loImpr);
  });
  it('is bounded 0..100', () => {
    const s = computeKeywordValueScore({ keyword: 'dentist near me', volume: 999999, difficulty: 0, cpc: 999, intent: 'transactional' }, LOCAL)!;
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(100);
  });
});

describe('computeKeywordValueComponents (Task 2.1)', () => {
  it('sibling .score equals the scalar wrapper for the same input', () => {
    const ctx = { posture: 'non_local' as const, markets: [] };
    const input = { keyword: 'teeth cleaning sarasota', volume: 480, difficulty: 30, cpc: 6, intent: 'transactional' };
    const { score, components } = computeKeywordValueComponents(input, ctx);
    expect(score).toBe(computeKeywordValueScore(input, ctx));
    expect(components).toMatchObject({
      commercialValue: expect.any(Number),
      demand: expect.any(Number),
      winnability: expect.any(Number),
      localMultiplier: expect.any(Number),
      intent: 'transactional',
    });
  });
  it('signal-gated input returns {score: undefined, components: undefined} and wrapper stays undefined', () => {
    const ctx = { posture: 'non_local' as const, markets: [] };
    const r = computeKeywordValueComponents({ keyword: 'anything' }, ctx);
    expect(r.score).toBeUndefined();
    expect(r.components).toBeUndefined();
    expect(computeKeywordValueScore({ keyword: 'anything' }, ctx)).toBeUndefined();
  });
  it('components carry the correct resolved intent for a comparison keyword', () => {
    const ctx = { posture: 'non_local' as const, markets: [] };
    const { components } = computeKeywordValueComponents(
      { keyword: 'invisalign vs braces', volume: 500, difficulty: 30, intent: 'comparison' },
      ctx,
    );
    // comparison → commercial via toValueIntent
    expect(components?.intent).toBe('commercial');
  });
});
