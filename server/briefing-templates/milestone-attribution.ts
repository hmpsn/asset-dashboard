// server/briefing-templates/milestone-attribution.ts
//
// Deterministic projection from a `milestone_attribution` analytics insight to a
// `BriefingStory`. Phase 2.5c — see
// docs/superpowers/specs/2026-04-29-client-insights-redesign-design.md §5
// for the voice contract this file enforces.
//
// VOICE CONTRACT (enforced by pr-check rule "Banned hedge words in briefing
// templates" scoped to server/briefing-templates/):
// - No hedge words: potentially / could / may / appears to / suggests /
//   might / seems.
// - Every sentence in the narrative cites a number from the typed payload.
// - Definite tense ("is now driving 53 clicks/mo"), never speculation.
//
// Story purpose: OUTCOME-PROOF play. When a delivered brief's tracked page
// crosses a traffic threshold (first clicks / 50 clicks / 100 clicks), surface
// it as an attributable win so the client sees the brief's concrete ROI.

import type { AnalyticsInsight, MilestoneAttributionData } from '../../shared/types/analytics.js';
import type { BriefingStory } from '../../shared/types/briefing.js';
import type { TemplateContext } from './index.js';
import { fmtShortDateUTC } from './_helpers.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Human-readable threshold phrase used inline in narrative sentences. */
function thresholdPhrase(threshold: MilestoneAttributionData['thresholdCrossed']): string {
  switch (threshold) {
    case 'first_clicks':   return 'first clicks landed on';
    case 'fifty_clicks':   return 'passed 50 clicks/mo on';
    case 'hundred_clicks': return 'passed 100 clicks/mo on';
  }
}

/** Short label used in the dataReceipt threshold citation. */
function thresholdLabel(threshold: MilestoneAttributionData['thresholdCrossed']): string {
  switch (threshold) {
    case 'first_clicks':   return 'First-click threshold';
    case 'fifty_clicks':   return '50-click threshold';
    case 'hundred_clicks': return '100-click threshold';
  }
}

/** Headline (5-12 words) anchored to threshold and brief topic. */
function buildHeadline(
  briefTitle: string,
  threshold: MilestoneAttributionData['thresholdCrossed'],
): string {
  switch (threshold) {
    case 'first_clicks':
      return `Your "${briefTitle}" brief is now driving clicks.`;
    case 'fifty_clicks':
      return `Your "${briefTitle}" brief crossed 50 clicks/mo.`;
    case 'hundred_clicks':
      return `Your "${briefTitle}" brief crossed 100 clicks/mo.`;
  }
}

/** 2-3 sentence narrative. Every sentence cites a number. No hedges. */
function buildNarrative(
  data: MilestoneAttributionData,
  threshold: MilestoneAttributionData['thresholdCrossed'],
): string {
  const phrase = thresholdPhrase(threshold);
  const roundedValue = Math.round(data.trafficValue);
  const formattedValue = roundedValue.toLocaleString();

  const opening =
    `Your brief on "${data.briefTitle}" ${phrase} ${data.pageUrl}.`;

  const detail =
    `The page we delivered ${data.daysSinceDelivery} days ago is now driving ` +
    `${data.currentClicks} clicks/mo, equivalent to ~$${formattedValue}/mo in organic value ` +
    `at your weighted CPC.`;

  return `${opening} ${detail}`;
}

export function buildStoryFromInsight(
  insight: AnalyticsInsight<'milestone_attribution'>,
  _context: TemplateContext,
): BriefingStory | null {
  const data = insight.data as MilestoneAttributionData;

  // Defensive guard: threshold logic should never fire on zero clicks.
  if (typeof data.currentClicks !== 'number' || data.currentClicks <= 0) {
    return null;
  }

  // Required string fields must be present and non-empty.
  if (!data.briefId || !data.pageUrl) {
    return null;
  }

  const briefTitle = data.briefTitle && data.briefTitle.trim().length > 0
    ? data.briefTitle.trim()
    : 'this brief';

  const threshold = data.thresholdCrossed;
  const headline = buildHeadline(briefTitle, threshold);
  const narrative = buildNarrative({ ...data, briefTitle }, threshold);

  // Derive brief delivery date from computedAt minus daysSinceDelivery.
  const computedAtMs = Date.parse(insight.computedAt);
  const deliveryMs = Number.isFinite(computedAtMs)
    ? computedAtMs - data.daysSinceDelivery * DAY_MS
    : NaN;
  const deliveryDate = Number.isFinite(deliveryMs)
    ? fmtShortDateUTC(new Date(deliveryMs))
    : null;

  const deliveryClause = deliveryDate
    ? `Brief delivered ${deliveryDate}.`
    : `Brief delivered ${data.daysSinceDelivery} days ago.`;

  const dataReceipt =
    `${deliveryClause} ${thresholdLabel(threshold)} crossed in last measurement window.`;

  const roundedValue = Math.round(data.trafficValue);

  return {
    id: `milestone-${data.briefId}`,
    category: 'win',
    isHeadline: false,
    leadEligible: true,
    headline,
    narrative,
    metrics: [
      { value: `${data.currentClicks}`, label: 'clicks/mo' },
      { value: `$${roundedValue.toLocaleString()}`, label: 'value/mo' },
    ],
    drillIn: {
      page: 'performance',
      queryParams: { page: data.pageUrl },
    },
    sourceRefs: [{ type: 'analytics_insight', id: insight.id }],
    dataReceipt,
  };
}
