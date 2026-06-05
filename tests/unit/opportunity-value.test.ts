import { describe, it, expect } from 'vitest';
import {
  computeOpportunityValue,
  normalizeToScore,
  DEFAULT_WEIGHTS,
  MODEL_VERSION,
} from '../../server/scoring/opportunity-value.js';
import type { OpportunityInput } from '../../shared/types/recommendations.js';

const base = (over: Partial<OpportunityInput>): OpportunityInput => ({ branch: 'ranking_opp', ...over });

describe('computeOpportunityValue — shape & invariants', () => {
  it('returns a bounded 0..100 value, finite EMV, and the ov-1 model version', () => {
    const s = computeOpportunityValue(base({ branch: 'quick_win', volume: 800, currentPosition: 7, difficulty: 25, authorityStrength: 50, cpc: 2, intent: 'commercial', roiScore: 90 }));
    expect(s.value).toBeGreaterThanOrEqual(0);
    expect(s.value).toBeLessThanOrEqual(100);
    expect(Number.isInteger(s.value)).toBe(true);
    expect(Number.isFinite(s.emvPerWeek)).toBe(true);
    expect(s.modelVersion).toBe(MODEL_VERSION);
    expect(s.components).toHaveLength(7);
    expect(s.calibrationVersion).toBe(DEFAULT_WEIGHTS.calibrationVersion);
  });

  it('GROUNDED-BEATS-UNGROUNDED: a real striking-distance win outranks an LLM "high" with no metrics', () => {
    const grounded = computeOpportunityValue(base({ branch: 'quick_win', volume: 2000, currentPosition: 8, difficulty: 20, authorityStrength: 50, cpc: 3, intent: 'commercial', roiScore: 140 }));
    const ungrounded = computeOpportunityValue(base({ branch: 'quick_win', llmLabel: 'high' }));
    expect(grounded.confidence).toBeGreaterThanOrEqual(0.95);
    expect(ungrounded.confidence).toBeLessThanOrEqual(0.5);
    expect(grounded.value).toBeGreaterThan(ungrounded.value);
    expect(grounded.groundedSpine).toBe('roiScore');
    expect(ungrounded.groundedSpine).toBe('computed');
  });

  it('demotes the LLM label to a confidence discount, never a score', () => {
    const s = computeOpportunityValue(base({ branch: 'quick_win', llmLabel: 'high' }));
    expect(s.confidence).toBe(0.5);
    // the evidence component reflects "estimated", not a grounded spine
    const ev = s.components.find((c) => c.dimension === 'evidence');
    expect(ev?.evidence.toLowerCase()).toContain('estimated');
  });
});

describe('computeOpportunityValue — per-branch grounding', () => {
  it('quick_win / ranking_opp value rises with demand and with winnability', () => {
    const lowVol = computeOpportunityValue(base({ branch: 'ranking_opp', volume: 100, currentPosition: 8, difficulty: 30, authorityStrength: 50 }));
    const highVol = computeOpportunityValue(base({ branch: 'ranking_opp', volume: 3000, currentPosition: 8, difficulty: 30, authorityStrength: 50 }));
    expect(highVol.value).toBeGreaterThan(lowVol.value);

    const winnable = computeOpportunityValue(base({ branch: 'ranking_opp', volume: 1000, currentPosition: 8, difficulty: 20, authorityStrength: 60 })); // within-reach
    const unwinnable = computeOpportunityValue(base({ branch: 'ranking_opp', volume: 1000, currentPosition: 8, difficulty: 95, authorityStrength: 20 })); // very-challenging
    expect(winnable.value).toBeGreaterThan(unwinnable.value);
  });

  it('content_gap rides the grounded opportunityScore composite', () => {
    const s = computeOpportunityValue(base({ branch: 'content_gap', volume: 1500, currentPosition: 15, difficulty: 30, opportunityScore: 80, trendDirection: 'rising', intent: 'commercial' }));
    expect(s.groundedSpine).toBe('opportunityScore');
    expect(s.value).toBeGreaterThan(0);
  });

  it('decay weights recoverability and penalizes repeat decay', () => {
    const fresh = computeOpportunityValue(base({ branch: 'decay', previousClicks: 500, currentClicks: 100, currentPosition: 6, difficulty: 30, authorityStrength: 50, isRepeatDecay: false }));
    const repeat = computeOpportunityValue(base({ branch: 'decay', previousClicks: 500, currentClicks: 100, currentPosition: 6, difficulty: 30, authorityStrength: 50, isRepeatDecay: true }));
    expect(fresh.value).toBeGreaterThan(repeat.value); // repeat decay is a worse bet for the same play
  });

  it('technical: critical errors score above info, and value is bounded/finite', () => {
    const critical = computeOpportunityValue(base({ branch: 'technical', currentClicks: 1000, severity: 'error', isCritical: true }));
    const info = computeOpportunityValue(base({ branch: 'technical', currentClicks: 1000, severity: 'info', isCritical: false }));
    expect(critical.value).toBeGreaterThan(info.value);
    expect(Number.isFinite(critical.value)).toBe(true);
  });

  it('freshness scales with impressions', () => {
    const hi = computeOpportunityValue(base({ branch: 'freshness', impressions: 5000, intent: 'informational' }));
    const lo = computeOpportunityValue(base({ branch: 'freshness', impressions: 200, intent: 'informational' }));
    expect(hi.value).toBeGreaterThan(lo.value);
  });
});

describe('computeOpportunityValue — value-per-click & calibration', () => {
  it('degrades gracefully when CPC is null (intent-weight proxy, no NaN)', () => {
    const s = computeOpportunityValue(base({ branch: 'quick_win', volume: 1000, currentPosition: 6, difficulty: 25, authorityStrength: 50, intent: 'transactional' /* no cpc */ }));
    expect(Number.isFinite(s.emvPerWeek)).toBe(true);
    expect(s.emvPerWeek).toBeGreaterThan(0);
    expect(Number.isNaN(s.value)).toBe(false);
  });

  it('transactional intent beats informational at equal demand', () => {
    const txn = computeOpportunityValue(base({ branch: 'ranking_opp', volume: 1000, currentPosition: 8, difficulty: 30, authorityStrength: 50, intent: 'transactional' }));
    const info = computeOpportunityValue(base({ branch: 'ranking_opp', volume: 1000, currentPosition: 8, difficulty: 30, authorityStrength: 50, intent: 'informational' }));
    expect(txn.value).toBeGreaterThan(info.value);
  });

  it('per-workspace calibration shifts the score and is clamped to [0.75,1.25]', () => {
    const input = base({ branch: 'ranking_opp', volume: 200, currentPosition: 12, difficulty: 40, authorityStrength: 50, intent: 'informational' });
    const hi = computeOpportunityValue(input, { calibration: 1.25 });
    const lo = computeOpportunityValue(input, { calibration: 0.75 });
    const over = computeOpportunityValue(input, { calibration: 99 });
    expect(hi.value).toBeGreaterThan(lo.value);
    expect(over.calibration).toBe(1.25); // clamped
    expect(lo.calibration).toBe(0.75);
  });

  it('businessFit alignment raises the score', () => {
    const aligned = computeOpportunityValue(base({ branch: 'ranking_opp', volume: 1000, currentPosition: 8, difficulty: 30, authorityStrength: 50, businessFitAlignment: 1 }));
    const neutral = computeOpportunityValue(base({ branch: 'ranking_opp', volume: 1000, currentPosition: 8, difficulty: 30, authorityStrength: 50, businessFitAlignment: 0 }));
    expect(aligned.value).toBeGreaterThan(neutral.value);
  });
});

describe('normalizeToScore', () => {
  it('is monotonic, bounded 0..100, and 0 for non-positive ROI', () => {
    expect(normalizeToScore(0)).toBe(0);
    expect(normalizeToScore(-5)).toBe(0);
    expect(normalizeToScore(100)).toBeLessThanOrEqual(100);
    expect(normalizeToScore(1000)).toBeGreaterThan(normalizeToScore(100));
    expect(normalizeToScore(1e9)).toBe(100);
  });
});

describe('grounded composites are consumed numerically (Q6/MW1/CC1/IW1)', () => {
  it('a quick_win with roiScore but NO provider volume still scores > 0 and beats an ungrounded "high"', () => {
    const grounded = computeOpportunityValue(base({ branch: 'quick_win', roiScore: 140, intent: 'commercial' /* no volume */ }));
    const ungrounded = computeOpportunityValue(base({ branch: 'quick_win', llmLabel: 'high' }));
    expect(grounded.value).toBeGreaterThan(0);
    expect(grounded.groundedSpine).toBe('roiScore');
    expect(grounded.value).toBeGreaterThan(ungrounded.value); // the invariant the audit set out to close
  });

  it('roiScore MAGNITUDE moves the quick_win score (not just the confidence label)', () => {
    const strong = computeOpportunityValue(base({ branch: 'quick_win', roiScore: 200 }));
    const weak = computeOpportunityValue(base({ branch: 'quick_win', roiScore: 5 }));
    expect(strong.value).toBeGreaterThan(weak.value);
  });

  it('a content_gap with opportunityScore but no volume still scores > 0 and beats an ungrounded "high"', () => {
    const grounded = computeOpportunityValue(base({ branch: 'content_gap', opportunityScore: 85, trendDirection: 'rising', intent: 'commercial' /* no volume */ }));
    const ungrounded = computeOpportunityValue(base({ branch: 'content_gap', llmLabel: 'high' }));
    expect(grounded.value).toBeGreaterThan(0);
    expect(grounded.groundedSpine).toBe('opportunityScore');
    expect(grounded.value).toBeGreaterThan(ungrounded.value);
  });
});

describe('grounded-beats-ungrounded holds CROSS-BRANCH (effort floor on ungrounded items)', () => {
  it('a grounded ranking_opp (effort 5) outranks an ungrounded low-effort diagnostic "high"', () => {
    const grounded = computeOpportunityValue(base({ branch: 'ranking_opp', volume: 300, currentPosition: 10, difficulty: 40, authorityStrength: 50, intent: 'commercial' }));
    const ungroundedQuick = computeOpportunityValue(base({ branch: 'diagnostic', llmLabel: 'high' }));
    expect(grounded.confidence).toBeGreaterThanOrEqual(0.95);
    expect(ungroundedQuick.confidence).toBeLessThanOrEqual(0.5);
    expect(grounded.value).toBeGreaterThan(ungroundedQuick.value);
  });

  it('an ungrounded item cannot exploit a low per-branch effort divisor (quick_win effort 1)', () => {
    const grounded = computeOpportunityValue(base({ branch: 'ranking_opp', volume: 250, currentPosition: 9, difficulty: 35, authorityStrength: 50 }));
    const ungroundedQuickWin = computeOpportunityValue(base({ branch: 'quick_win', llmLabel: 'high' }));
    expect(grounded.value).toBeGreaterThan(ungroundedQuickWin.value);
  });
});

describe('effort hardening', () => {
  it('non-positive effortDays overrides fall back to the per-branch default (no ROI inflation to 100)', () => {
    const zero = computeOpportunityValue(base({ branch: 'ranking_opp', volume: 200, currentPosition: 10, difficulty: 40, authorityStrength: 50, effortDays: 0 }));
    const neg = computeOpportunityValue(base({ branch: 'ranking_opp', volume: 200, currentPosition: 10, difficulty: 40, authorityStrength: 50, effortDays: -5 }));
    const def = computeOpportunityValue(base({ branch: 'ranking_opp', volume: 200, currentPosition: 10, difficulty: 40, authorityStrength: 50 }));
    expect(zero.value).toBe(def.value);
    expect(neg.value).toBe(def.value);
    expect(zero.value).toBeLessThan(100);
  });

  it('every component normalized stays within [0,1] even for odd inputs', () => {
    const s = computeOpportunityValue(base({ branch: 'ranking_opp', volume: 999999, currentPosition: 1, difficulty: 5, authorityStrength: 80, businessFitAlignment: 1, effortDays: 0.01 }));
    for (const c of s.components) {
      expect(c.normalized).toBeGreaterThanOrEqual(0);
      expect(c.normalized).toBeLessThanOrEqual(1);
    }
  });
});

describe('timing component honesty (no score effect until P7 events)', () => {
  it('reports a 0-contribution "no active timing event" when timingBoost is absent', () => {
    const s = computeOpportunityValue(base({ branch: 'ranking_opp', volume: 1000, currentPosition: 8, difficulty: 30, authorityStrength: 50 }));
    const timing = s.components.find((c) => c.dimension === 'timing');
    expect(timing?.contribution).toBe(0);
    expect(timing?.evidence).toContain('no active timing event');
  });

  it('once timingBoost is set, it both shows a contribution AND raises the score (pre-wired for P7)', () => {
    const inputBase = base({ branch: 'ranking_opp', volume: 1000, currentPosition: 8, difficulty: 30, authorityStrength: 50 });
    const without = computeOpportunityValue(inputBase);
    const withBoost = computeOpportunityValue({ ...inputBase, timingBoost: 0.6 });
    expect(withBoost.value).toBeGreaterThanOrEqual(without.value);
    const timing = withBoost.components.find((c) => c.dimension === 'timing');
    expect(timing && timing.contribution).toBeGreaterThan(0);
  });
});

describe('grounded fallbacks for impressions-only / precomputed-gap branches (PR3 review)', () => {
  it('consumes a precomputed expectedClickGap directly (CTR-opportunity) — non-zero, scales with the gap', () => {
    const small = computeOpportunityValue(base({ branch: 'ranking_opp', expectedClickGap: 20, currentPosition: 5 }));
    const big = computeOpportunityValue(base({ branch: 'ranking_opp', expectedClickGap: 200, currentPosition: 5 }));
    expect(small.value).toBeGreaterThan(0);
    expect(big.value).toBeGreaterThan(small.value);
    expect(big.confidence).toBeGreaterThanOrEqual(0.95); // GSC-grounded
  });

  it('falls back to GSC impressions when SEMrush volume is absent (intent-mismatch) — non-zero', () => {
    const s = computeOpportunityValue(base({ branch: 'ranking_opp', impressions: 4000, currentPosition: 6, difficulty: 30, authorityStrength: 50 }));
    expect(s.value).toBeGreaterThan(0);
    expect(s.confidence).toBeGreaterThanOrEqual(0.95);
    const higher = computeOpportunityValue(base({ branch: 'ranking_opp', impressions: 200, currentPosition: 6, difficulty: 30, authorityStrength: 50 }));
    expect(s.value).toBeGreaterThan(higher.value); // more impressions → more value
  });

  it('an out-of-union llmLabel yields a finite value (no NaN) so the opportunity round-trips', () => {
    const s = computeOpportunityValue(base({ branch: 'quick_win', llmLabel: 'critical' as any }));
    expect(Number.isFinite(s.value)).toBe(true);
    expect(Number.isFinite(s.emvPerWeek)).toBe(true);
    expect(s.value).toBe(0); // unknown label → 0 fallback, never NaN
  });
});
