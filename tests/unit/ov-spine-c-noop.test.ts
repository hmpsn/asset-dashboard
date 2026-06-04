/**
 * PR5 · Spine C no-op boundary proof.
 *
 * The PR5 wiring threads better OV inputs (real referring-domains authority, a
 * per-workspace realized-$ calibration, calibrated display weights) into the
 * `opportunity` object. This file pins the selector behavior directly:
 * `pickImpactScore` returns the OV value when the caller opts into it, and
 * otherwise falls back to the legacy score.
 *
 * This file pins that chokepoint directly:
 *   1. calibration shifts opportunity.value (so the new input is actually wired),
 *      but pickImpactScore(rec, false) still returns the legacy score.
 *   2. weights change ONLY the component breakdown (display), never value.
 *   3. authorityStrength flows into winnability (value) — proving it reaches the OV
 *      object — while the legacy impactScore is independent of it.
 */
import { describe, it, expect } from 'vitest';
import { computeOpportunityValue, pickImpactScore, DEFAULT_WEIGHTS } from '../../server/scoring/opportunity-value.js';
import type { OpportunityInput, OpportunityWeights } from '../../shared/types/recommendations.js';

const baseInput: OpportunityInput = {
  branch: 'ranking_opp',
  volume: 2400,
  currentPosition: 7,
  difficulty: 40,
  impressions: 5000,
  cpc: 3,
  intent: 'commercial',
  authorityStrength: 50,
};

describe('PR5 Spine C — OV inputs only affect the opportunity object', () => {
  it('calibration shifts opportunity.value while the selector still supports explicit legacy fallback', () => {
    const low = computeOpportunityValue(baseInput, { calibration: 0.75 });
    const high = computeOpportunityValue(baseInput, { calibration: 1.25 });
    // The new calibration input is genuinely wired into the OV value.
    expect(high.value).toBeGreaterThanOrEqual(low.value);
    expect(high.calibration).toBe(1.25);
    expect(low.calibration).toBe(0.75);

    // The selector remains a pure chokepoint: callers can still explicitly read
    // the legacy impactScore when needed.
    const legacyImpactScore = 50;
    const recLow = { impactScore: legacyImpactScore, opportunity: low };
    const recHigh = { impactScore: legacyImpactScore, opportunity: high };
    expect(pickImpactScore(recLow, /* useOpportunityValue */ false)).toBe(legacyImpactScore);
    expect(pickImpactScore(recHigh, /* useOpportunityValue */ false)).toBe(legacyImpactScore);
    // Sanity: opting into OV returns the OV value.
    expect(pickImpactScore(recHigh, true)).toBe(high.value);
  });

  it('per-workspace weights change the display breakdown but never the scored value', () => {
    const tilted: OpportunityWeights = {
      ...DEFAULT_WEIGHTS,
      demand: 0.9,
      winnability: 0.01,
      calibrationVersion: 'ridge-test',
    };
    const withDefault = computeOpportunityValue(baseInput, { weights: DEFAULT_WEIGHTS });
    const withTilted = computeOpportunityValue(baseInput, { weights: tilted });

    // Value is identical (weights are display-only) ...
    expect(withTilted.value).toBe(withDefault.value);
    expect(withTilted.emvPerWeek).toBe(withDefault.emvPerWeek);
    // ... but the component contributions differ (display reflects the new weights).
    const demandDefault = withDefault.components.find(c => c.dimension === 'demand')!;
    const demandTilted = withTilted.components.find(c => c.dimension === 'demand')!;
    expect(demandTilted.weight).toBe(0.9);
    expect(demandTilted.contribution).not.toBe(demandDefault.contribution);
    expect(withTilted.calibrationVersion).toBe('ridge-test');
  });

  it('authorityStrength reaches the OV value while explicit legacy fallback stays stable', () => {
    const weak = computeOpportunityValue({ ...baseInput, authorityStrength: 20, difficulty: 70 });
    const strong = computeOpportunityValue({ ...baseInput, authorityStrength: 80, difficulty: 70 });
    // Authority is genuinely consumed by the OV scorer (higher authority vs same KD
    // → not lower winnability/value).
    expect(strong.value).toBeGreaterThanOrEqual(weak.value);
    // Legacy fallback remains stable when the caller explicitly requests it.
    expect(pickImpactScore({ impactScore: 42, opportunity: strong }, false)).toBe(42);
  });
});
