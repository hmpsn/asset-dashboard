// server/briefing-templates/_helpers.ts
//
// Shared helpers for the deterministic briefing-story templates.
// Phase 2.5a — extracted from per-template inline duplicates after the
// scaled-review caught a `k`/`K` casing divergence between content-gap and
// the other templates' fmtNum implementations. One canonical formatter
// here; every template imports from this module.

const MONTH_ABBREVIATIONS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/**
 * Compact number formatter. Uses lowercase `k` and `m` suffixes
 * (newsroom convention — distinct from currency, where uppercase is
 * standard). Falls through to `Number.toLocaleString()` for values
 * below 1,000.
 *
 * Examples:
 *   - `8600` → `"8.6k"`
 *   - `611` → `"611"`
 *   - `1_840_000` → `"1.8m"`
 *   - `0` → `"0"`
 *
 * Negative values are clamped to 0 — every consumer in the briefing
 * layer is rendering a count or magnitude, never a signed delta. Use a
 * dedicated `formatDelta` helper if signed values become a need.
 */
export function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return '0';
  const safe = n < 0 ? 0 : n;
  if (safe >= 1_000_000) return `${(safe / 1_000_000).toFixed(1)}m`;
  if (safe >= 1_000) return `${(safe / 1_000).toFixed(1)}k`;
  return safe.toLocaleString();
}

/**
 * Format a date as `"Mon DD"` (UTC) — e.g. `"Apr 14"`.
 * Used in `dataReceipt` strings to anchor data windows.
 *
 * Accepts an ISO-8601 string OR a Date object OR a milliseconds-epoch
 * number. Returns the empty string when the input is unparsable; the
 * caller should fall back to a generic phrasing in that case.
 */
export function fmtShortDateUTC(input: string | Date | number): string {
  const d = typeof input === 'string' || typeof input === 'number'
    ? new Date(input)
    : input;
  if (Number.isNaN(d.getTime())) return '';
  return `${MONTH_ABBREVIATIONS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/**
 * Format a date as `"Mon DD, YYYY"` (UTC) — e.g. `"Apr 14, 2026"`.
 * Used when a longer-form date helps the reader anchor a year-old
 * datapoint (e.g. freshness alerts where the page was last touched
 * months ago).
 */
export function fmtLongDateUTC(input: string | Date | number): string {
  const d = typeof input === 'string' || typeof input === 'number'
    ? new Date(input)
    : input;
  if (Number.isNaN(d.getTime())) return '';
  return `${MONTH_ABBREVIATIONS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}
