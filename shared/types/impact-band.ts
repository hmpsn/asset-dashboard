// ── Client-safe impact band (D-IMPACT) ──────────────────────────
//
// Clients NEVER see the raw `emvPerWeek` exposure (admin/AI-only, stripped on
// every public route — see tests/integration/recommendations-public-emv-leak.test.ts).
// Instead, the client-facing recommendation projection carries a CONSERVATIVE
// banded monthly dollar RANGE derived from emvPerWeek, plus a low/medium/high
// label. This is the "Est. impact: ~$80–$160/mo" line on the Health tab.
//
// CROSS-LANE CONTRACT (the HealthTab UI lane codes against this exact shape):
//   impactBand?: { band: 'low' | 'medium' | 'high'; monthlyRangeUsd?: [number, number] }
//
// The `ImpactBand` interface is the single source of truth and lives in this
// leaf module so recommendation payload types and fix-catalog metadata do not
// form an import cycle.

export interface ImpactBand {
  band: 'low' | 'medium' | 'high';
  /** Conservative monthly USD range [lower, upper] — absent when below floor */
  monthlyRangeUsd?: [number, number];
}

/** Band magnitude label for the impact line + (i) methodology popover. */
export type ImpactBandLevel = ImpactBand['band'];

/** Weeks per month (52 / 12). emvPerWeek × this ≈ monthly expected value. */
const WEEKS_PER_MONTH = 4.33;

/** Below this projected monthly value we show NO impact line (over-promise guard). */
const DISPLAY_FLOOR_USD = 25;

/** Upper display cap — a defensible ceiling so a noisy emv can't render "$40k/mo".
 *  Chosen conservatively: above this, the per-fix framing stops being credible and
 *  the relationship is better had as a conversation than a number on a button. */
const DISPLAY_CAP_USD = 2000;

/** Conservative low-end multiplier: the bottom of the range is 70% of the midpoint. */
const LOW_END_FACTOR = 0.7;

/** Round to a "nice" step appropriate to the magnitude (no ugly decimals on a CTA). */
function niceStep(value: number): number {
  if (value < 100) return 5;
  if (value < 500) return 10;
  return 25;
}

function roundDownNice(value: number): number {
  const step = niceStep(value);
  return Math.floor(value / step) * step;
}

function roundUpNice(value: number): number {
  const step = niceStep(value);
  return Math.ceil(value / step) * step;
}

function bandLevel(monthlyMid: number): ImpactBandLevel {
  if (monthlyMid < 250) return 'low';
  if (monthlyMid < 750) return 'medium';
  return 'high';
}

/**
 * Project a raw weekly EMV into a client-safe banded monthly impact.
 * Returns `undefined` when the projection falls below the display floor (no
 * impact line should render) or when `emvPerWeek` is non-positive.
 */
export function computeImpactBand(emvPerWeek: number | null | undefined): ImpactBand | undefined {
  if (typeof emvPerWeek !== 'number' || !Number.isFinite(emvPerWeek) || emvPerWeek <= 0) {
    return undefined;
  }

  const monthlyMid = emvPerWeek * WEEKS_PER_MONTH;
  if (monthlyMid < DISPLAY_FLOOR_USD) return undefined;

  const band = bandLevel(monthlyMid);

  // Conservative range, capped, rounded to nice steps. The HIGH end is the
  // midpoint (we never display above the conservative projection); the LOW end
  // is 70% of it. Cap the high end, then floor the low end to the cap as well.
  const highRaw = Math.min(monthlyMid, DISPLAY_CAP_USD);
  const lowRaw = Math.min(monthlyMid * LOW_END_FACTOR, DISPLAY_CAP_USD);

  let high = Math.min(roundUpNice(highRaw), DISPLAY_CAP_USD);
  let low = roundDownNice(lowRaw);

  // Never let the low end exceed the (possibly capped) high end.
  if (low > high) low = high;
  // Keep the low end at or above the display floor so the range reads sanely.
  if (low < DISPLAY_FLOOR_USD) low = Math.min(roundDownNice(DISPLAY_FLOOR_USD), high);

  return { band, monthlyRangeUsd: [low, high] };
}
