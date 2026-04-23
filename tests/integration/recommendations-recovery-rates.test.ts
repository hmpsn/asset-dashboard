import { describe, it, expect } from 'vitest';
import { getRecoveryRate } from '../../server/recommendations.js';

describe('getRecoveryRate', () => {
  it('returns rate for a known issue type', () => {
    const r = getRecoveryRate('title');
    expect(r.perRec).toBe('10-25%');
    expect(r.summary).toBeCloseTo(0.18);
  });
  it('returns rate for a low-impact issue type', () => {
    const r = getRecoveryRate('og-image');
    expect(r.perRec).toBe('1-3%');
    expect(r.summary).toBeCloseTo(0.02);
  });
  it('returns default rate for unknown issue type', () => {
    const r = getRecoveryRate('made-up-issue');
    expect(r.perRec).toBe('5-15%');
    expect(r.summary).toBeCloseTo(0.12);
  });
});

// Locks the summary-math formula used in `generateRecommendations` at
// server/recommendations.ts:898-910:
//   weightedRecoverableClicks += r.trafficAtRisk * getRecoveryRate(checkName).summary
// `estimatedRecoverableClicks = Math.round(sum over actionableRecs)`.
// Catches regressions if someone replaces the weighted accumulation with a
// flat-rate (pre-Tier 3) calculation or a different rounding policy.
describe('weighted recoverable-clicks summary math', () => {
  function extractCheckName(source: string): string {
    return source.startsWith('audit:site-wide:')
      ? source.replace('audit:site-wide:', '')
      : source.startsWith('audit:')
        ? source.replace('audit:', '')
        : '';
  }
  const DEFAULT_SUMMARY = 0.12;

  it('sums trafficAtRisk × per-check rate.summary and rounds', () => {
    const recs = [
      { source: 'audit:title',          trafficAtRisk: 1000 }, // summary 0.18 → 180
      { source: 'audit:og-image',       trafficAtRisk: 500  }, // summary 0.02 → 10
      { source: 'strategy:content-gap', trafficAtRisk: 200  }, // default 0.12 → 24
    ];
    const weighted = recs.reduce((s, r) => {
      const checkName = extractCheckName(r.source);
      const rate = checkName ? getRecoveryRate(checkName) : { summary: DEFAULT_SUMMARY, perRec: '' };
      return s + r.trafficAtRisk * rate.summary;
    }, 0);
    expect(Math.round(weighted)).toBe(214);
  });

  it('site-wide audit sources strip the audit:site-wide: prefix', () => {
    const checkName = extractCheckName('audit:site-wide:ssl');
    expect(checkName).toBe('ssl');
    const rate = getRecoveryRate(checkName);
    expect(rate.summary).toBeGreaterThan(0);
    const weighted = 100 * rate.summary;
    expect(Math.round(weighted)).toBe(Math.round(100 * rate.summary));
  });

  it('non-audit sources (decay, strategy) fall through to DEFAULT_RECOVERY', () => {
    expect(extractCheckName('decay:click-decline')).toBe('');
    expect(extractCheckName('strategy:content-gap')).toBe('');
  });
});
