// ── next-bets $-forecast (the-issue-client-next-bets, P1) ────────────────────
//
// Reframes the top recommended moves as a forward-looking dollar forecast: each
// "bet" carries the client-safe banded monthly $ range (ImpactBand.monthlyRangeUsd —
// already conservative + floored + capped server-side; NEVER raw emvPerWeek), and an
// optional outcome-unit equivalent derived from the verdict's valuePerOutcome.
//
// Framing contract (owner decision): lead with the $ band; show outcome-units ONLY
// when they round to ≥1 (a "$300/mo ÷ $850/patient ≈ 0.4 patients" line is noise, not
// signal). Only recs that carry a monthlyRangeUsd are forecastable bets — recs below
// the display floor have no $ and are excluded (they still appear in the plan lists).

import type { ImpactBand } from '../../../../shared/types/impact-band';

/** Minimal rec shape the forecast needs — keeps the helper testable without full fixtures. */
export interface NextBetRec {
  id: string;
  title: string;
  impactBand?: ImpactBand;
  impactScore: number;
  opportunity?: { value: number } | null;
}

export interface NextBet {
  id: string;
  title: string;
  monthlyLow: number;
  monthlyHigh: number;
  /** Rounded outcome-unit range — null unless the high end rounds to ≥1 (framing contract). */
  outcomeLow: number | null;
  outcomeHigh: number | null;
}

export interface NextBetsForecast {
  bets: NextBet[];
  combinedLow: number;
  combinedHigh: number;
  combinedOutcomeLow: number | null;
  combinedOutcomeHigh: number | null;
}

/** Outcome-unit range for a $ band, honoring the "only when ≥1" framing. Returns nulls
 *  when there's no per-outcome value or the band doesn't reach a whole outcome. */
function outcomeRange(
  low: number,
  high: number,
  valuePerOutcome: number | null | undefined,
): { lo: number | null; hi: number | null } {
  if (!valuePerOutcome || valuePerOutcome <= 0) return { lo: null, hi: null };
  const hi = Math.round(high / valuePerOutcome);
  if (hi < 1) return { lo: null, hi: null }; // sub-1 outcome → $-only (no fractional noise)
  const lo = Math.max(0, Math.floor(low / valuePerOutcome));
  return { lo, hi };
}

/**
 * Build the next-bets forecast from the curated recs.
 *
 * @param recs             curated client recs (only those with impactBand.monthlyRangeUsd are bets)
 * @param valuePerOutcome  the verdict's $ per outcome (for the optional outcome-unit line); null when no outcomeValue
 * @param max              max bets to surface (default 3)
 * @returns the forecast, or null when there are no forecastable bets (caller renders nothing)
 */
export function computeNextBetsForecast(
  recs: NextBetRec[],
  valuePerOutcome: number | null | undefined,
  max = 3,
): NextBetsForecast | null {
  const forecastable = recs
    .filter((r): r is NextBetRec & { impactBand: Required<Pick<ImpactBand, 'monthlyRangeUsd'>> & ImpactBand } =>
      Array.isArray(r.impactBand?.monthlyRangeUsd) && r.impactBand!.monthlyRangeUsd!.length === 2)
    // Same ordering as the plan lists: strategic opportunity first, impactScore as fallback.
    .sort((a, b) => (b.opportunity?.value ?? b.impactScore) - (a.opportunity?.value ?? a.impactScore))
    .slice(0, max);

  if (forecastable.length === 0) return null;

  const bets: NextBet[] = forecastable.map((r) => {
    const [low, high] = r.impactBand!.monthlyRangeUsd!;
    const o = outcomeRange(low, high, valuePerOutcome);
    return { id: r.id, title: r.title, monthlyLow: low, monthlyHigh: high, outcomeLow: o.lo, outcomeHigh: o.hi };
  });

  const combinedLow = bets.reduce((s, b) => s + b.monthlyLow, 0);
  const combinedHigh = bets.reduce((s, b) => s + b.monthlyHigh, 0);
  const combinedOutcome = outcomeRange(combinedLow, combinedHigh, valuePerOutcome);

  return {
    bets,
    combinedLow,
    combinedHigh,
    combinedOutcomeLow: combinedOutcome.lo,
    combinedOutcomeHigh: combinedOutcome.hi,
  };
}
