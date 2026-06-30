/**
 * Format a dollar-per-week EMV (estimated monetary value) figure for display.
 *
 * ADMIN SURFACES ONLY — emvPerWeek is stripped at the public boundary
 * (stripEmvFromPublicRecs) and must never render in a client-facing component.
 */
export function formatEmv(emv: number): string {
  if (emv < 1) return '<$1/wk';
  if (emv >= 10_000) return `$${(emv / 1000).toFixed(0)}k/wk`;
  if (emv >= 1_000) return `$${(emv / 1000).toFixed(1)}k/wk`;
  return `$${Math.round(emv).toLocaleString()}/wk`;
}
