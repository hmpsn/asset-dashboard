/**
 * Unit tests for the client-safe impactBand projection (D-IMPACT).
 *
 * Clients NEVER see raw emvPerWeek. We project it into a conservative monthly
 * dollar BAND. Contract (documented in shared/types/impact-band.ts JSDoc):
 *   - monthlyMid = emvPerWeek × 4.33 (weeks/month)
 *   - DISPLAY FLOOR: monthlyMid < $25 → no band at all (undefined)
 *   - CONSERVATIVE RANGE: low = 0.7 × mid, high = mid, each rounded down/up to a
 *     "nice" $5 (<$100) / $10 (<$500) / $25 (≥$500) step
 *   - DISPLAY CAP: high clamped to $2,000; low never exceeds high
 *   - BAND LABEL by monthlyMid: <$250 → low, <$750 → medium, ≥$750 → high
 */
import { describe, it, expect } from 'vitest';
import { computeImpactBand } from '../../shared/types/impact-band.js';

describe('computeImpactBand — display floor', () => {
  it('emvPerWeek 0 → undefined', () => {
    expect(computeImpactBand(0)).toBeUndefined();
  });
  it('monthly mid below $25 → undefined (e.g. $5/wk ≈ $21.65/mo)', () => {
    expect(computeImpactBand(5)).toBeUndefined();
  });
  it('negative emv → undefined', () => {
    expect(computeImpactBand(-100)).toBeUndefined();
  });
  it('just above the floor produces a band (e.g. $7/wk ≈ $30.31/mo)', () => {
    const band = computeImpactBand(7);
    expect(band).toBeDefined();
    expect(band!.band).toBe('low');
    expect(band!.monthlyRangeUsd).toBeDefined();
  });
});

describe('computeImpactBand — band labels', () => {
  it('low band: mid ≈ $100/mo (~$23/wk)', () => {
    expect(computeImpactBand(23)!.band).toBe('low');
  });
  it('medium band: mid ≈ $400/mo (~$92.4/wk)', () => {
    expect(computeImpactBand(92.4)!.band).toBe('medium');
  });
  it('high band: mid ≈ $900/mo (~$208/wk)', () => {
    expect(computeImpactBand(208)!.band).toBe('high');
  });
  it('boundary: exactly $250/mo mid is medium (not low)', () => {
    // 250 / 4.33 ≈ 57.74 /wk
    expect(computeImpactBand(250 / 4.33)!.band).toBe('medium');
  });
  it('boundary: exactly $750/mo mid is high', () => {
    expect(computeImpactBand(750 / 4.33)!.band).toBe('high');
  });
});

describe('computeImpactBand — conservative range', () => {
  it('low end is below the mid (high end)', () => {
    const band = computeImpactBand(100)!; // mid ≈ $433/mo
    const [low, high] = band.monthlyRangeUsd!;
    expect(low).toBeGreaterThan(0);
    expect(low).toBeLessThan(high);
  });
  it('range endpoints are rounded to nice steps (no ugly decimals)', () => {
    const band = computeImpactBand(100)!;
    const [low, high] = band.monthlyRangeUsd!;
    expect(Number.isInteger(low)).toBe(true);
    expect(Number.isInteger(high)).toBe(true);
    // mid ≈ $433/mo → $10 nice step (values < $500)
    expect(high % 10).toBe(0);
    expect(low % 5).toBe(0);
  });
});

describe('computeImpactBand — display cap', () => {
  it('huge emv → high end capped at $2,000', () => {
    const band = computeImpactBand(100_000)!; // mid would be ~$433k/mo
    const [low, high] = band.monthlyRangeUsd!;
    expect(high).toBe(2000);
    expect(low).toBeLessThanOrEqual(2000);
    expect(band.band).toBe('high');
  });
  it('low never exceeds the capped high', () => {
    const band = computeImpactBand(100_000)!;
    const [low, high] = band.monthlyRangeUsd!;
    expect(low).toBeLessThanOrEqual(high);
  });
});
