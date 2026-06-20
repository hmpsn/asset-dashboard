// ── outcomeProvenance — the SINGLE provenance→render contract for The Issue client surface ──
//
// Authority-layered-fields rule (CLAUDE.md): the OutcomeProvenance → human label + money
// precision + disclosure-sentence mapping lives ONLY here. Components import the resolved
// `ProvenanceRender` object and render its fields — they NEVER branch on `provenance === …`
// inline. A new tier (e.g. P3 'actual_reconciled') is handled by adding a case here, once.
//
// P1a graduates the COUNT's confidence to 'measured_action' ("tracked on your site", exact $),
// but the dollar still rides count × lead value — see fmtOutcomeMoney / fmtMeasuredMoney.

import type { OutcomeProvenance } from '../../../../shared/types/outcome-tracking';
import { fmtEstimateMoney, fmtMeasuredMoney } from '../../../utils/formatNumbers';

export interface ProvenanceRender {
  /** Human honesty qualifier: "estimate" | "tracked on your site" | "actual". */
  qualifier: string;
  /** true → exact figure, no ~ band; false → banded estimate. */
  isExact: boolean;
  /** Provenance-appropriate money formatter (banded vs exact). */
  fmtMoney: (value: number) => string;
  /** Provenance-appropriate disclosure sentence, given the per-outcome lead value. */
  disclosure: (valuePerOutcome: number) => string;
}

export function resolveProvenanceRender(provenance: OutcomeProvenance): ProvenanceRender {
  switch (provenance) {
    case 'measured_action':
      return {
        qualifier: 'tracked on your site',
        isExact: true,
        fmtMoney: fmtMeasuredMoney,
        disclosure: (v) =>
          `Measured from real actions on your site — your tracked conversions valued at ${fmtMeasuredMoney(v)} each.`,
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
