/**
 * Single source of truth for the GSC metric window used across the keyword
 * surfaces. Clicks/impressions are a SUM over this rolling window; position is
 * the window AVERAGE. Both the daily snapshot scheduler and the manual
 * "Capture snapshot" route MUST use these constants so the two paths never
 * disagree (a manual capture on a different window silently swings the
 * displayed clicks/impressions). Surfaced to the user as a "last N days" label.
 */
export const GSC_METRIC_WINDOW_DAYS = 28;

/** GSC finalizes data ~3 days late; the window ends at today − this many days. */
export const GSC_DATA_LAG_DAYS = 3;
