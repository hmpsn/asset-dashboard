// ── Per-keyword realized dollar value (the ONE $ definition) ─────────────────
// `keywordDollarValue` is the SOLE producer of the per-keyword realized $/mo and
// its position-uplift potential. It is reused by `roi.ts` (Revenue at stake), the
// client strategy serialization, and the admin Keyword Hub — so there is exactly
// one dollar formula across every surface (spec D2/D5, no second dollar engine).
//
//   currentMonthly = clicks × cpc          // IDENTICAL to roi.ts `value = clicks * cpc`
//   upsideMonthly  = impressions × Δctr × cpc  // realized $ only — NO intentWeight
//
// Intent stays in the value SCORE, never in the $ (spec D2). CPC sparsity floors
// everything to 0 (no $ shown when cpc is unknown), so the helper never throws.

import { ctrAt, type CtrCurve } from './ctr-curve.js';

export interface KeywordDollarValueArgs {
  clicks?: number;
  cpc?: number;
  currentPosition?: number | null;
  impressions?: number;
  ctrCurve?: CtrCurve | null;
}

export interface KeywordDollarValue {
  /** Realized monthly dollar value: clicks × cpc (matches roi.ts trafficValue). */
  currentMonthly: number;
  /** Upside if the keyword moved up: impressions × CTR uplift × cpc (0-floored). */
  upsideMonthly: number;
}

/**
 * Compute a keyword's realized $/mo and the upside $/mo of moving it up.
 *
 * The target position mirrors `opportunity-value.ts`: a keyword already in the top
 * three is nudged one position higher (min 1); everything else targets position 3.
 * The CTR uplift is read off the (optional) calibrated curve via the EXPORTED
 * `ctrAt`, falling back to the documented industry curve when no curve is supplied.
 */
export function keywordDollarValue(args: KeywordDollarValueArgs): KeywordDollarValue {
  const clicks = args.clicks ?? 0;
  const cpc = args.cpc ?? 0;
  const impressions = args.impressions ?? 0;

  const currentMonthly = clicks * cpc;

  const currentPosition = args.currentPosition;
  const target = currentPosition != null && currentPosition <= 3
    ? Math.max(1, currentPosition - 1)
    : 3;
  const curve = args.ctrCurve?.curve;
  const ctrUplift = Math.max(0, ctrAt(target, curve) - ctrAt(currentPosition ?? 20, curve));
  const upsideMonthly = impressions * ctrUplift * cpc;

  return { currentMonthly, upsideMonthly };
}
