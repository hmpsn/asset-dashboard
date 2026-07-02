import { describe, it, expect } from 'vitest';
import { computeNextBetsForecast, type NextBetRec } from '../../src/components/client/the-issue/nextBetsForecast';

/** Build a forecastable rec with a $ band. */
function rec(id: string, range: [number, number] | undefined, opportunityValue: number, impactScore = 0): NextBetRec {
  return {
    id,
    title: `Move ${id}`,
    impactBand: range ? { band: 'medium', monthlyRangeUsd: range } : { band: 'low' },
    impactScore,
    opportunity: { value: opportunityValue },
  };
}

describe('computeNextBetsForecast', () => {
  it('returns null when no rec carries a $ band (all below the display floor)', () => {
    expect(computeNextBetsForecast([rec('a', undefined, 90), rec('b', undefined, 80)], 850)).toBeNull();
    expect(computeNextBetsForecast([], 850)).toBeNull();
  });

  it('keeps only forecastable recs, sorts by opportunity value, and caps at max', () => {
    const f = computeNextBetsForecast(
      [
        rec('low', [10, 20], 10),
        rec('mid', [40, 60], 50),
        rec('top', [100, 200], 90),
        rec('nofloor', undefined, 100), // excluded — no $ band
        rec('extra', [5, 10], 5),
      ],
      null,
      3,
    )!;
    expect(f.bets.map((b) => b.id)).toEqual(['top', 'mid', 'low']); // opportunity desc, top 3, nofloor excluded
    expect(f.combinedLow).toBe(150); // 100 + 40 + 10
    expect(f.combinedHigh).toBe(280); // 200 + 60 + 20
  });

  it('omits outcome-units when there is no per-outcome value', () => {
    const f = computeNextBetsForecast([rec('a', [800, 1700], 50)], null)!;
    expect(f.bets[0].outcomeLow).toBeNull();
    expect(f.bets[0].outcomeHigh).toBeNull();
    expect(f.combinedOutcomeLow).toBeNull();
    expect(f.combinedOutcomeHigh).toBeNull();
  });

  it('omits per-bet outcome-units when the band is worth less than one outcome', () => {
    // $300 high ÷ $850/outcome = 0.35 → rounds to 0 → no outcome line (framing contract).
    const f = computeNextBetsForecast([rec('small', [150, 300], 50)], 850)!;
    expect(f.bets[0].outcomeHigh).toBeNull();
    expect(f.bets[0].outcomeLow).toBeNull();
  });

  it('shows outcome-units when the band reaches ≥1 outcome', () => {
    // high $1700 ÷ $850 = 2; low $900 ÷ $850 = 1.06 → floor 1.
    const f = computeNextBetsForecast([rec('a', [900, 1700], 50)], 850)!;
    expect(f.bets[0].outcomeLow).toBe(1);
    expect(f.bets[0].outcomeHigh).toBe(2);
  });

  it('computes combined outcome-units from the combined $ band even when each bet rounds to 0', () => {
    // Two $200–300 bets: each alone (300/850=0.35 → round 0) shows no outcomes, but the combined
    // 400–600 band (600/850=0.7 → round 1) does — the forecast aggregates before rounding.
    const f = computeNextBetsForecast([rec('a', [200, 300], 50), rec('b', [200, 300], 40)], 850)!;
    expect(f.bets[0].outcomeHigh).toBeNull(); // per-bet rounds to 0 → no outcome line
    expect(f.combinedLow).toBe(400);
    expect(f.combinedHigh).toBe(600);
    expect(f.combinedOutcomeHigh).toBe(1); // 600 / 850 = 0.7 → round 1
  });
});
