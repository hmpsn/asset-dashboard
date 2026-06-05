/**
 * Single source of truth for the GSC metric window used across the keyword
 * surfaces — shared between server and client.
 *
 * Clicks/impressions are a SUM over this rolling window; position is the window
 * AVERAGE. Both the daily snapshot scheduler AND the manual "Capture snapshot"
 * route MUST use these constants so the two paths never disagree (a manual
 * capture on a different window silently swings the displayed clicks/impressions
 * by up to ~4×, because both UPSERT into rank_snapshots under the same date key).
 *
 * Surfaced to the user as a "last N days" label in the Keyword Hub, so the
 * constant lives in `shared/` (the server module cannot be imported by the
 * client). The server module `server/keyword-intelligence/keyword-window.ts`
 * re-exports these for back-compat.
 */
export const GSC_METRIC_WINDOW_DAYS = 28;

/** GSC finalizes data ~3 days late; the window ends at today − this many days. */
export const GSC_DATA_LAG_DAYS = 3;
