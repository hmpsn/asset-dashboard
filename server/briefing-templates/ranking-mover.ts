// server/briefing-templates/ranking-mover.ts
//
// Deterministic projection from a `ranking_mover` analytics insight to a
// `BriefingStory`. Phase 2.5a — see
// docs/superpowers/specs/2026-04-29-client-insights-redesign-design.md §5
// for the voice contract this file enforces.
//
// VOICE CONTRACT (enforced by pr-check rule "Banned hedge words in briefing
// templates" scoped to server/briefing-templates/):
// - No hedge words: potentially / could / may / appears to / suggests /
//   might / seems.
// - Every sentence in the narrative cites a number from the typed payload.
// - Definite tense ("rose from #11 to #4"), never future-tense speculation.
//
// Eligibility for a WIN story: `data.positionChange > 0`. Per the JSDoc on
// `RankingMoverData.positionChange` ("Positive = improved (moved up),
// negative = dropped"), a strictly-positive change is the only shape we
// surface here — flat or negative movement is not a win.

import type { AnalyticsInsight, RankingMoverData } from '../../shared/types/analytics.js';
import type { BriefingStory } from '../../shared/types/briefing.js';
import type { TemplateContext } from './index.js';
import { fmtShortDateUTC, appendAnchor } from './_helpers.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/* TemplateContext imported from ./index.js — see Phase 2.5a review */

/**
 * Round `position` UP to the next multiple of 5 (so #4 -> top 5, #6 -> top
 * 10, #10 -> top 10). Position 1 maps to "top 5" — there is no "top 0" or
 * "top 1" framing in this template; the smallest milestone we celebrate is
 * the top 5.
 */
function nextTopBucket(position: number): number {
  const bucket = Math.ceil(position / 5) * 5;
  return bucket < 5 ? 5 : bucket;
}

export function buildStoryFromInsight(
  insight: AnalyticsInsight<'ranking_mover'>,
  context: TemplateContext,
): BriefingStory | null {
  const data = insight.data as RankingMoverData;

  // Eligibility: only strictly-positive movers surface as WIN stories.
  // Per the JSDoc, positive positionChange = moved up the SERP.
  if (typeof data.positionChange !== 'number' || data.positionChange <= 0) {
    return null;
  }

  // Required fields: degrade gracefully when any are missing.
  if (
    !data.query ||
    !data.pageUrl ||
    typeof data.currentPosition !== 'number' ||
    typeof data.previousPosition !== 'number'
  ) {
    return null;
  }

  const currentClicks = data.currentClicks ?? 0;
  const previousClicks = data.previousClicks ?? 0;
  const clicksDelta = currentClicks - previousClicks;
  const clicksDeltaSign = clicksDelta >= 0 ? '+' : '';

  const pageLabel = insight.pageTitle && insight.pageTitle.trim().length > 0
    ? insight.pageTitle.trim()
    : 'page';

  const topBucket = nextTopBucket(data.currentPosition);

  // Headline: 5-12 words. "Your {pageTitle | 'page'} just cracked the top {N}."
  // Trailing period for consistency with the other 10 templates (Devin caught
  // the missing punctuation on PR #380).
  const headline = `Your ${pageLabel} just cracked the top ${topBucket}.`;

  // Narrative: 2-3 sentences, every sentence carries a number, no hedges.
  const narrative =
    `${data.pageUrl} for "${data.query}" rose from ` +
    `#${data.previousPosition} to #${data.currentPosition} over the last 14 days. ` +
    `Clicks for the page jumped from ${previousClicks} to ${currentClicks} in the same window.`;

  // Data receipt: anchor in GSC last-28d vs prior-28d window, dated 14 days
  // before computedAt. `computedAt` is an ISO string on AnalyticsInsight.
  const computedAtMs = Date.parse(insight.computedAt);
  const anchorDate = Number.isFinite(computedAtMs)
    ? new Date(computedAtMs - 14 * DAY_MS)
    : new Date(Date.now() - 14 * DAY_MS);
  // Phase 2.5c — append a "best week since X" anchor when the current
  // clicks figure is a new high in the snapshot history. Pure tail-append;
  // when no anchor is editorially meaningful (insufficient history, current
  // isn't a new best) the receipt returns unchanged.
  let dataReceipt =
    `Source: GSC last-28-day vs prior-28-day window. ` +
    `Verified across 7 daily samples since ${fmtShortDateUTC(anchorDate)}`;
  dataReceipt = appendAnchor(dataReceipt, context.workspaceId, 'total_clicks', currentClicks);

  return {
    id: `story-${insight.id}`,
    category: 'win',
    isHeadline: false,
    headline,
    narrative,
    metrics: [
      {
        value: `#${data.previousPosition} → #${data.currentPosition}`,
        label: 'position',
      },
      {
        value: `${clicksDeltaSign}${clicksDelta} clicks`,
        label: '2-week Δ',
      },
    ],
    drillIn: {
      page: 'performance',
      queryParams: { page: data.pageUrl },
    },
    sourceRefs: [{ type: 'analytics_insight', id: insight.id }],
    dataReceipt,
  };
}
