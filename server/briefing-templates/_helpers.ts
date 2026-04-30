// server/briefing-templates/_helpers.ts
//
// Shared helpers for the deterministic briefing-story templates.
// Phase 2.5a — extracted from per-template inline duplicates after the
// scaled-review caught a `k`/`K` casing divergence between content-gap and
// the other templates' fmtNum implementations. One canonical formatter
// here; every template imports from this module.

import { findBestWeekSince } from '../briefing-anchors.js';
import type { SnapshotMetricName } from '../workspace-metrics-snapshots.js';

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

/**
 * Phase 2.5c — append an anchor phrase to an existing dataReceipt when one
 * is editorially meaningful for the workspace's metric history. Pure
 * concatenation; the input dataReceipt should NOT already end in a period
 * (this helper adds one with the anchor sentence appended).
 *
 * Templates call this when they have a snapshot-worthy metric on hand:
 *
 *   ```ts
 *   let receipt = `Source: GSC last-28-day window. Verified across 7 daily samples since ${dateStr}.`;
 *   receipt = appendAnchor(receipt, ctx.workspaceId, 'total_clicks', currentClicks);
 *   ```
 *
 * When `findBestWeekSince` returns null (insufficient history, current
 * isn't a new best, etc.) the input is returned unchanged.
 *
 * Defined here rather than in briefing-anchors.ts to keep the templates'
 * import surface small — they already pull from _helpers.
 */
export function appendAnchor(
  receipt: string,
  workspaceId: string,
  metricName: SnapshotMetricName,
  current: number,
): string {
  if (!Number.isFinite(current)) return receipt;
  const anchor = findBestWeekSince(workspaceId, metricName, current);
  if (!anchor) return receipt;
  // Capitalize first letter of phrase for sentence-start position.
  const sentence = anchor.phrase.charAt(0).toUpperCase() + anchor.phrase.slice(1);
  return `${receipt} ${sentence}.`;
}
