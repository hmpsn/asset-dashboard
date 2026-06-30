// ── outcomeProvenance — the SINGLE provenance→render contract for The Issue client surface ──
//
// Authority-layered-fields rule (CLAUDE.md): the OutcomeProvenance → human label + money
// precision + disclosure-sentence mapping lives ONLY here. Components import the resolved
// `ProvenanceRender` object and render its fields — they NEVER branch on `provenance === …`
// inline. A new tier (e.g. P3 'actual_reconciled') is handled by adding a case here, once.
//
// P1a graduates the COUNT's confidence to 'measured_action' ("tracked on your site", exact count),
// but the DOLLAR stays BANDED ("~$"): the dollar is count × valuePerOutcome, and valuePerOutcome may
// be an agency_estimate / ai_enriched figure — so a measured count multiplied by an estimated rate is
// still an estimate at the dollar layer. Only the COUNT graduates to exact. Three contracts pin this
// (shared/types/outcome-tracking.ts:65-66, the plan's D3, the plan architecture line). Exact dollars
// arrive only at P3 'actual_reconciled', where the value itself is reconciled to closed records.

import type { OutcomeProvenance } from '../../../../shared/types/outcome-tracking';
import { fmtEstimateMoney, fmtMeasuredMoney } from '../../../utils/formatNumbers';

export interface ProvenanceRender {
  /** Human honesty qualifier: "estimate" | "tracked on your site" | "actual". */
  qualifier: string;
  /** Whether the COUNT is an exact measured truth (true for measured_action / actual_reconciled) vs an
   *  estimate (false for estimate_ga4). NOTE: the DOLLAR band is governed independently by `fmtMoney` —
   *  measured_action has an exact count but a banded (~$) dollar, because value = count × estimated
   *  lead rate. Only actual_reconciled is exact at BOTH the count and the dollar layer. */
  isExact: boolean;
  /** Provenance-appropriate money formatter for the DOLLAR (banded ~$ for estimate_ga4 AND
   *  measured_action; exact only for actual_reconciled). */
  fmtMoney: (value: number) => string;
  /** Provenance-appropriate disclosure sentence, given the per-outcome lead value. */
  disclosure: (valuePerOutcome: number) => string;
}

export function resolveProvenanceRender(provenance: OutcomeProvenance): ProvenanceRender {
  switch (provenance) {
    case 'measured_action':
      return {
        // The COUNT is exact ("tracked on your site"), but the DOLLAR stays banded (~$) because the
        // value is count × an estimated lead value. Only P3 'actual_reconciled' graduates the dollar.
        qualifier: 'tracked on your site',
        isExact: true,
        fmtMoney: fmtEstimateMoney,
        disclosure: (v) =>
          `Measured from real actions on your site — your tracked conversions valued at about ${fmtEstimateMoney(v)} each.`,
      };
    case 'actual_reconciled':
      return {
        qualifier: 'actual',
        isExact: true,
        fmtMoney: fmtMeasuredMoney,
        disclosure: (v) =>
          `Reconciled to your closed records — valued at ${fmtMeasuredMoney(v)} each.`,
      };
    case 'estimate_ga4':
    default:
      return {
        qualifier: 'estimate',
        isExact: false,
        fmtMoney: fmtEstimateMoney,
        disclosure: (v) =>
          `This is an estimate — your tracked conversions valued at ${fmtEstimateMoney(v)} each.`,
      };
  }
}
