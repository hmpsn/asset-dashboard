/**
 * Centralized number formatting utilities.
 * Replaces duplicate fmtNum / formatNum / fmtMoney / fmtMoneyFull across components.
 */
import type { OutcomeProvenance } from '../../shared/types/outcome-tracking';

/** Compact number: 1234 → "1.2K", 1_500_000 → "1.5M" */
export function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

/**
 * Null-safe volume formatter.
 * Returns '-' for null/undefined (preserving the sentinel that KCC callers rely on),
 * and delegates to fmtNum for all valid numbers.
 */
export function fmtNumSafe(n: number | null | undefined): string {
  if (n == null) return '-';
  return fmtNum(n);
}

/** Compact money: 1234 → "$1.2k", 50 → "$50.00" */
export function fmtMoney(value: number): string {
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}k`;
  return `$${value.toFixed(2)}`;
}

/** Full currency: 12345 → "$12,345" */
export function fmtMoneyFull(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

/**
 * Estimate-labeled money band. Used ONLY when provenance === 'estimate_ga4'. Rounds to two
 * significant figures and prefixes "~"; never emits cents. Exact figures use fmtMoneyFull.
 */
export function fmtEstimateMoney(value: number): string {
  if (!Number.isFinite(value)) return '—';
  if (value === 0) return '~$0';
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  const magnitude = Math.pow(10, Math.floor(Math.log10(abs)) - 1);
  const banded = Math.round(abs / magnitude) * magnitude;
  return `~${sign}$${banded.toLocaleString('en-US')}`;
}

/**
 * Estimate-labeled ratio ("~7×"). One significant figure at/above 1×, one decimal below.
 * Non-finite → em-dash sentinel.
 */
export function fmtEstimateRatio(ratio: number): string {
  if (!Number.isFinite(ratio)) return '—';
  if (ratio >= 1) {
    const magnitude = Math.pow(10, Math.floor(Math.log10(ratio)));
    return `~${Math.round(ratio / magnitude) * magnitude}×`;
  }
  return `~${ratio.toFixed(1)}×`;
}

/**
 * Measured-action money: EXACT figure (we measured the real on-site actions), whole dollars, no ~ band.
 * Used when provenance graduates past 'estimate_ga4' (measured_action / actual_reconciled). The COUNT
 * is what graduates to exact + "tracked on your site" — the dollar still rides count × lead value, but
 * we drop the estimate band because the underlying count is now a measured truth, not a projection.
 */
export function fmtMeasuredMoney(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return fmtMoneyFull(value);
}

/** The SINGLE place that maps an OutcomeProvenance → its money formatter (estimate band vs exact). */
export function fmtOutcomeMoney(value: number, provenance: OutcomeProvenance): string {
  return provenance === 'estimate_ga4' ? fmtEstimateMoney(value) : fmtMeasuredMoney(value);
}

/** Human-readable file size: 0 → "0 B", 1024 → "1.0 KB", 1048576 → "1.0 MB" */
export function formatBytes(bytes: number, decimals = 1): string {
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  if (i === 0) return `${bytes} B`;
  return `${(bytes / Math.pow(1024, i)).toFixed(decimals)} ${units[i]}`;
}
