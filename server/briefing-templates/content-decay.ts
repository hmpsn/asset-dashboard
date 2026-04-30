// server/briefing-templates/content-decay.ts
//
// Deterministic briefing-template module for `content_decay` insights.
// Maps a typed `ContentDecayData` payload (clicks delta vs baseline window) to
// a `BriefingStory`. Returns null when the insight is ineligible (drop < 15%)
// or missing required fields.
//
// Simplified mode (spec §9): peak tracking is deferred to Phase 3 — we only
// have current-window vs baseline-window clicks, not a historical peak.
// Narrative therefore sticks to what the data shows: clicks dropped, here's
// the magnitude, refresh is the move. No speculative cause attribution
// (seasonal vs algorithm vs intent shift) — we don't have the data to claim it.
//
// Voice rules (spec §5):
//   - Banned hedges: potentially, could, may, appears to, suggests, might, seems
//   - Every sentence cites a number from the typed payload
//   - Definite tone — "a refresh is the next step", NOT "may benefit from refresh"

import type { AnalyticsInsight } from '../../shared/types/analytics.js';
import type { BriefingStory } from '../../shared/types/briefing.js';
import { fmtNum } from './_helpers.js';

export function buildStoryFromInsight(
  insight: AnalyticsInsight<'content_decay'>,
  _context: { workspaceId: string; tier: 'free' | 'growth' | 'premium' },
): BriefingStory | null {
  const data = insight.data;

  // Required fields — degrade gracefully when missing.
  if (
    typeof data.baselineClicks !== 'number' ||
    typeof data.currentClicks !== 'number' ||
    typeof data.deltaPercent !== 'number'
  ) {
    return null;
  }

  // Eligibility: drop of 15% or more (deltaPercent < -15).
  if (data.deltaPercent >= -15) {
    return null;
  }

  // Page reference — ContentDecayData has no native pageUrl/pageTitle, so
  // fall back through the enrichment fields on the insight envelope.
  const pageRef = insight.pageTitle ?? insight.pageId ?? 'a page';
  const dropMagnitude = Math.abs(data.deltaPercent);
  // Round to keep the headline clean; deltaPercent can be a float.
  const dropMagnitudeRounded = Math.round(dropMagnitude);

  const baselineLabel = fmtNum(data.baselineClicks);
  const currentLabel = fmtNum(data.currentClicks);
  const baselinePeriod = data.baselinePeriod || 'baseline window';
  const currentPeriod = data.currentPeriod || 'current window';

  const headline =
    `Traffic to ${pageRef} dropped ${dropMagnitudeRounded}% this ${currentPeriod}.`;

  // Narrative: 2-3 sentences, every sentence cites a number, no hedges,
  // no speculative cause attribution, definite tone on the next move.
  const sentence1 =
    `${pageRef} pulled ${currentLabel} clicks during the ${currentPeriod}, ` +
    `down from ${baselineLabel} during the ${baselinePeriod}.`;

  const sentence2 =
    `That is a ${dropMagnitudeRounded}% decline against the ${baselinePeriod} baseline.`;

  const sentence3 = `A refresh is the next step.`;

  const narrative = [sentence1, sentence2, sentence3].join(' ');

  // Sign-prefixed delta string for the metric badge (drop is always negative).
  // Use the raw deltaPercent (not the rounded magnitude) so the badge stays
  // faithful to the underlying value, but trim it to one decimal for display.
  const deltaDisplay = Number.isInteger(data.deltaPercent)
    ? `${data.deltaPercent}%`
    : `${data.deltaPercent.toFixed(1)}%`;

  const dataReceipt =
    `Source: GSC clicks comparison. ` +
    `Baseline period: ${baselinePeriod}. ` +
    `Current: ${currentPeriod}. ` +
    `Threshold for inclusion: -15% drop.`;

  const drillIn: BriefingStory['drillIn'] = insight.pageId
    ? { page: 'health', queryParams: { page: insight.pageId } }
    : { page: 'health' };

  return {
    id: `story-${insight.id}`,
    category: 'risk',
    isHeadline: false,
    headline,
    narrative,
    metrics: [
      { value: deltaDisplay, label: 'clicks' },
      { value: `${baselineLabel} → ${currentLabel}`, label: 'monthly' },
    ],
    dataReceipt,
    drillIn,
    sourceRefs: [{ type: 'analytics_insight', id: insight.id }],
  };
}
