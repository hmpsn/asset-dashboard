/**
 * Centralized number formatting utilities.
 * Replaces duplicate fmtNum / formatNum / fmtMoney / fmtMoneyFull across components.
 */

/** Compact number: 1234 → "1.2K", 1_500_000 → "1.5M" */
export function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
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
