import { describe, it, expect } from 'vitest';
import { computeOpportunityValue } from '../../server/scoring/opportunity-value.js';
import { deriveValueIntent } from '../../server/scoring/keyword-value-score.js';

// Full-object OV parity harness for the keyword intent consolidation (PR 1).
//
// Captures a CONCRETE pre-change snapshot for the byte-identical transactional
// (non-comparison, intent-present) case, and asserts the INTENDED post-migration
// values for the comparison case (OLD: null→0.5 default; NEW: commercial→0.7).
//
// `input.intent` drives the intent component's rawValue/normalized/evidence (and
// thus contribution + the top-2 ordering that feeds topOpportunityRationale), so a
// value-only diff is insufficient — we assert the full OpportunityScore here.
describe('OV intent parity after full-derive consolidation', () => {
  const base = { branch: 'ranking_opp' as const, volume: 500, difficulty: 30, currentPosition: 8 };

  it('comparison searchIntent now resolves commercial (0.7), not the 0.5 default', () => {
    const intent = deriveValueIntent('invisalign vs braces', 'comparison'); // 'commercial'
    const ov = computeOpportunityValue({ ...base, intent });
    const intentComp = ov.components.find(c => c.dimension === 'intent')!;
    expect(intentComp.rawValue).toBe('commercial');
    expect(intentComp.normalized).toBe(0.7);
    expect(intentComp.evidence).toContain('commercial intent');
    expect(intentComp.contribution).toBe(0.126); // 0.18 weight × 0.7 normalized
    expect(ov.value).toBe(50);
    expect(ov.value).toBeGreaterThan(0);
  });

  it('a transactional keyword is byte-identical pre/post (non-comparison, intent present)', () => {
    // Concrete pre-change snapshot captured from the CURRENT scorer (baseline).
    // The refactor must NOT move any of this — it is the byte-identical guarantee.
    const ov = computeOpportunityValue({ ...base, intent: 'transactional' });
    expect(ov).toEqual({
      value: 54,
      emvPerWeek: 37.5,
      predictedEmv: 450,
      roiPerEffortDay: 90,
      confidence: 1,
      calibration: 1,
      groundedSpine: 'computed',
      components: [
        { dimension: 'demand', rawValue: 500, normalized: 0.1, evidence: '500 monthly searches/impressions', weight: 0.22, contribution: 0.022 },
        { dimension: 'winnability', rawValue: 30, normalized: 0.8333333333333334, evidence: 'KD 30 vs domain authority', weight: 0.2, contribution: 0.167 },
        { dimension: 'intent', rawValue: 'transactional', normalized: 1, evidence: 'transactional intent', weight: 0.18, contribution: 0.18 },
        { dimension: 'effort', rawValue: 5, normalized: 0, evidence: '~5 day(s) to implement', weight: 0.12, contribution: 0 },
        { dimension: 'businessFit', rawValue: null, normalized: 0, evidence: 'no explicit priority match', weight: 0.13, contribution: 0 },
        { dimension: 'timing', rawValue: 0, normalized: 0, evidence: 'no active timing event', weight: 0.08, contribution: 0 },
        { dimension: 'evidence', rawValue: 'computed', normalized: 1, evidence: 'grounded in computed', weight: 0.07, contribution: 0.07 },
      ],
      calibrationVersion: 'platform-default',
      modelVersion: 'ov-1',
    });
  });

  it('value-inert content_gap path: deriveValueIntent(cg.targetKeyword, cg.intent) === cg.intent for 4-bucket', () => {
    for (const v of ['transactional', 'commercial', 'informational', 'navigational'] as const) {
      expect(deriveValueIntent('teeth whitening', v)).toBe(v); // no change vs reading cg.intent directly
    }
  });
});
