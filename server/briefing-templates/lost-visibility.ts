// server/briefing-templates/lost-visibility.ts
//
// Deterministic projection from a `lost_visibility` analytics insight to a
// `BriefingStory`. G1 of the June 2026 core-features remediation.
//
// VOICE CONTRACT (enforced by pr-check rule "Banned hedge words in briefing
// templates" scoped to server/briefing-templates/):
// - No hedge words: potentially / could / may / appears to / suggests /
//   might / seems.
// - Every sentence in the narrative cites a number from the typed payload.
// - Definite tense, outcome-oriented framing.
//
// Story purpose: RISK-SIGNAL play. When 3+ queries have dropped off Google
// Search Console (status = LOST_VISIBILITY), surface a story so the admin
// can include a "we're watching this" narrative in the client briefing.
// Below threshold 3, the signal is too noisy to escalate to a briefing story.

import type { AnalyticsInsight, LostVisibilityData } from '../../shared/types/analytics.js';
import type { BriefingStory } from '../../shared/types/briefing.js';
import type { TemplateContext } from './index.js';
import { fmtNum } from './_helpers.js';

/** Minimum lost-query count before this template emits a story. */
const STORY_THRESHOLD = 3;

/** Max top-query phrases to embed in the narrative. */
const NARRATIVE_QUERY_LIMIT = 3;

/**
 * Project a `lost_visibility` insight to a `BriefingStory`.
 * Returns null when lostCount < STORY_THRESHOLD (not enough signal).
 */
export function buildStoryFromInsight(
  insight: AnalyticsInsight<'lost_visibility'>,
  _context: TemplateContext,
): BriefingStory | null {
  const data = insight.data as LostVisibilityData;

  // Guard: not enough signal to include in a briefing.
  if (typeof data.lostCount !== 'number' || data.lostCount < STORY_THRESHOLD) {
    return null;
  }

  const lostCount = data.lostCount;
  const topQueries = Array.isArray(data.topQueries) ? data.topQueries : [];

  // Build headline — direct, count-anchored.
  const headline = `${fmtNum(lostCount)} search quer${lostCount === 1 ? 'y' : 'ies'} stopped showing in Google results.`;

  // Build narrative — cite the count and the top affected terms.
  const sampleTerms = topQueries
    .slice(0, NARRATIVE_QUERY_LIMIT)
    .map(q => `"${q.query}"`)
    .join(', ');

  const querySentence = sampleTerms.length > 0
    ? ` Terms that dropped off include ${sampleTerms}.`
    : '';

  const narrative =
    `Google Search Console stopped returning impression data for ${fmtNum(lostCount)} ` +
    `quer${lostCount === 1 ? 'y' : 'ies'} that had established presence.` +
    querySentence +
    ` Addressing these terms now — through content refreshes or search intent alignment — ` +
    `recaptures impression share before competitors fill the gap.`;

  // Build data receipt with top impression totals.
  const impressionTotal = topQueries.reduce((sum, q) => sum + (q.totalImpressions ?? 0), 0);
  const dataReceipt = impressionTotal > 0
    ? `${fmtNum(impressionTotal)} impressions lost across top ${topQueries.length} affected quer${topQueries.length === 1 ? 'y' : 'ies'}.`
    : `${fmtNum(lostCount)} quer${lostCount === 1 ? 'y' : 'ies'} with lost visibility detected in GSC.`;

  return {
    id: `lost-visibility-${insight.workspaceId}-${data.detectedAt?.slice(0, 10) ?? 'today'}`,
    category: 'risk',
    isHeadline: lostCount >= 10,
    leadEligible: lostCount >= 5,
    headline,
    narrative,
    metrics: [
      { value: fmtNum(lostCount), label: 'lost queries' },
      ...(impressionTotal > 0 ? [{ value: fmtNum(impressionTotal), label: 'impressions lost' }] : []),
    ],
    drillIn: {
      page: 'performance',
      queryParams: {},
    },
    sourceRefs: [{ type: 'analytics_insight', id: insight.id }],
    dataReceipt,
  };
}
