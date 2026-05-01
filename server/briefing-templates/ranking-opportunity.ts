// server/briefing-templates/ranking-opportunity.ts
//
// Deterministic briefing-template module for `ranking_opportunity` insights.
// Maps a typed `QuickWinData` payload (positions 11-20, page-2 candidates) to
// a `BriefingStory`. Returns null when the insight is ineligible (out of the
// 11-20 band) or missing required fields.
//
// Voice rules (spec §5):
//   - Banned hedges: potentially, could, may, appears to, suggests, might, seems
//   - Every sentence cites a number from the typed payload
//   - No vague comparators or generic phrases

import type { AnalyticsInsight } from '../../shared/types/analytics.js';
import type { BriefingStory } from '../../shared/types/briefing.js';
import { fmtNum } from './_helpers.js';


export function buildStoryFromInsight(
  insight: AnalyticsInsight<'ranking_opportunity'>,
  _context: { workspaceId: string; tier: 'free' | 'growth' | 'premium' },
): BriefingStory | null {
  const data = insight.data;

  // Required fields — degrade gracefully when missing.
  if (!data.query || !data.pageUrl || typeof data.currentPosition !== 'number') {
    return null;
  }

  // Eligibility band: page-2 candidates close to page 1 (positions 11-20).
  if (data.currentPosition <= 10 || data.currentPosition > 20) {
    return null;
  }

  const impressions = typeof data.impressions === 'number' ? data.impressions : 0;
  const trafficGain = typeof data.estimatedTrafficGain === 'number' ? data.estimatedTrafficGain : 0;

  const headline =
    data.currentPosition === 11
      ? `"${data.query}" is one position away from page 1.`
      : `"${data.query}" sits at #${data.currentPosition} — page 1 within reach.`;

  const impressionsLabel = fmtNum(impressions);

  // Narrative: 2-3 sentences, every sentence cites a number, no hedges.
  const positionsToPageOne = data.currentPosition - 10;
  const sentence1 =
    `${data.pageUrl} ranks #${data.currentPosition} for "${data.query}" ` +
    `with ${impressionsLabel} impressions over the last 28 days.`;

  const sentence2 =
    `Real demand exists at #${data.currentPosition}, and the page is ` +
    `${positionsToPageOne} ${positionsToPageOne === 1 ? 'position' : 'positions'} from page 1.`;

  const sentence3 =
    trafficGain > 0
      ? `Promoting it to page 1 delivers an estimated +${fmtNum(trafficGain)} clicks per month.`
      : '';

  const narrative = [sentence1, sentence2, sentence3].filter(Boolean).join(' ');

  const dataReceipt =
    `Source: GSC last-28-day position ${data.currentPosition} avg. ` +
    `Impressions baseline: ${impressionsLabel}/mo.`;

  return {
    id: `story-${insight.id}`,
    category: 'opportunity',
    isHeadline: false,
    headline,
    narrative,
    metrics: [
      { value: `${impressionsLabel} impressions`, label: 'impressions' },
      { value: `#${data.currentPosition} → #10`, label: 'to page 1' },
    ],
    dataReceipt,
    drillIn: {
      page: 'performance',
      queryParams: { page: data.pageUrl, query: data.query },
    },
    sourceRefs: [{ type: 'analytics_insight', id: insight.id }],
  };
}
