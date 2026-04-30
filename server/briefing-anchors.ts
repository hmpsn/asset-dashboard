// server/briefing-anchors.ts
//
// Phase 2.5c — "best week since X" anchor phrase formatter.
//
// Wraps getBestValueSinceDate() with human-readable phrase generation for
// use in briefing-cron dataReceipt lines. This module is a pure formatting
// layer — no DB access, no logger, no side effects.
//
// Public API:
//   findBestWeekSince(workspaceId, metricName, current, windowDays?)
//     → BriefingAnchor | null

import { getBestValueSinceDate, type SnapshotMetricName } from './workspace-metrics-snapshots.js';

export interface BriefingAnchor {
  /** YYYY-MM-DD; the date the workspace was last as good as today. */
  sinceDate: string;
  /**
   * Human-readable phrase ready for a dataReceipt line, e.g.:
   *   "best week since Mar 17"
   *   "best impressions since Apr 1"
   *   "lowest avg position since Mar 24"
   *
   * No leading/trailing punctuation; the calling template adds it.
   * Always lowercase except for the formatted date (Mon DD).
   */
  phrase: string;
}

/**
 * Format a YYYY-MM-DD string as "Mon DD" in UTC, e.g. "Mar 17", "Apr 1".
 * No leading zero on day. Uses en-US locale for English month abbreviations.
 */
function formatSinceDate(dateKey: string): string {
  const d = new Date(`${dateKey}T00:00:00Z`);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/**
 * Map each SnapshotMetricName to its phrase prefix (the part before "since Mon DD").
 * Shapes are pre-vetted for the briefing pr-check "Banned hedge words" rule —
 * definite, crisp, no hedges.
 */
const PHRASE_PREFIX: Record<SnapshotMetricName, string> = {
  total_clicks:          'best week since',
  total_impressions:     'best impressions since',
  avg_position:          'lowest avg position since',
  audit_score:           'highest site health since',
  organic_traffic_value: 'highest traffic value since',
};

/**
 * Compute a "best since X" anchor for a workspace metric. Returns null when
 * no anchor is editorially meaningful (insufficient history, current isn't
 * a new high/low). Wraps `getBestValueSinceDate` with phrase formatting.
 *
 * @param workspaceId  the workspace
 * @param metricName   one of the SnapshotMetricName enum values
 * @param current      current value the briefing is reporting
 * @param windowDays   optional; defaults to the snapshot module's default (90d)
 */
export function findBestWeekSince(
  workspaceId: string,
  metricName: SnapshotMetricName,
  current: number,
  windowDays?: number,
): BriefingAnchor | null {
  const result = getBestValueSinceDate(workspaceId, metricName, current, windowDays);
  if (result === null) return null;

  const { sinceDate } = result;
  const formattedDate = formatSinceDate(sinceDate);
  const prefix = PHRASE_PREFIX[metricName];

  return {
    sinceDate,
    phrase: `${prefix} ${formattedDate}`,
  };
}
