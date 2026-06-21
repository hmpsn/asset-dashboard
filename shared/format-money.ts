// shared/format-money.ts — the SINGLE source of money banding for The Issue.
//
// Authority rule (CLAUDE.md authority-layered-fields): there is exactly ONE banding implementation
// shared by the client hero (src/utils/formatNumbers.ts delegates here) AND the forwardable export
// assembler (server/the-issue-export.ts). No second banding definition may exist anywhere.
//
// Gate D: the dollar value is BANDED (`~$`) for `estimate_ga4` AND `measured_action` (the value is
// outcomeCount × an estimated per-outcome rate — editorial, not sourced), and EXACT (`$`) ONLY for
// `actual_reconciled` (the value itself is reconciled to closed records). This matches the hero's
// `resolveProvenanceRender` contract (measured_action → banded). Pure module — no React, no DOM.
import type { OutcomeProvenance } from './types/the-issue.js';

/**
 * Estimate-labeled money band. Rounds to two significant figures and prefixes "~"; never emits cents.
 * IDENTICAL output to the legacy fmtEstimateMoney (pure extraction). `~$0` for 0, em-dash for
 * non-finite, sign preserved before the `$`.
 */
export function bandEstimateMoney(value: number): string {
  if (!Number.isFinite(value)) return '—';
  if (value === 0) return '~$0';
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  const magnitude = Math.pow(10, Math.floor(Math.log10(abs)) - 1);
  const banded = Math.round(abs / magnitude) * magnitude;
  return `~${sign}$${banded.toLocaleString('en-US')}`;
}

/**
 * Exact whole-dollar money (no `~` band, no cents). IDENTICAL output to the legacy
 * fmtMoneyFull / fmtMeasuredMoney for whole dollars. Em-dash for non-finite.
 */
export function exactMoney(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

/**
 * The canonical provenance → money formatter: band UNLESS `actual_reconciled`.
 * estimate_ga4 → banded, measured_action → banded, actual_reconciled → exact.
 */
export function formatOutcomeMoney(value: number, provenance: OutcomeProvenance): string {
  return provenance === 'actual_reconciled' ? exactMoney(value) : bandEstimateMoney(value);
}
