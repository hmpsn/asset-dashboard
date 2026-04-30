// server/briefing-templates/freshness-alert.ts
//
// Deterministic briefing template for `freshness_alert` insights.
// Maps a typed FreshnessAlertData payload to a BriefingStory using only
// data sourced from the insight — no AI, no hedge words.
//
// Voice rules (spec §5): definitive, past/present tense only, every
// sentence cites a number from the typed payload. Banned hedge words
// are enforced by the pr-check rule defined for this directory.
//
// Severity bands:
//   < 90 days  → return null (not stale enough to surface)
//   90–180 days → category 'opportunity' (Watch List candidate)
//   > 180 days → category 'risk'         (Watch List candidate)

import type { AnalyticsInsight, FreshnessAlertData } from '../../shared/types/analytics.js';
import type { BriefingStory } from '../../shared/types/briefing.js';

const FRESHNESS_WARN_DAYS = 90;
const FRESHNESS_CRITICAL_DAYS = 180;

/** Format an ISO timestamp as "Mon D, YYYY" in UTC. Returns null if invalid. */
function formatLastAnalyzedDate(iso: string): string | null {
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return null;
  const d = new Date(ts);
  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  return `${months[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

export function buildStoryFromInsight(
  insight: AnalyticsInsight,
  _context: { workspaceId: string; tier: 'free' | 'growth' | 'premium' },
): BriefingStory | null {
  const data = insight.data as FreshnessAlertData;

  // Required fields — degrade gracefully on missing data.
  if (!data.pagePath) return null;
  if (!data.lastAnalyzedAt) return null;
  if (typeof data.daysSinceLastAnalysis !== 'number' || !Number.isFinite(data.daysSinceLastAnalysis)) {
    return null;
  }

  const days = Math.max(0, Math.floor(data.daysSinceLastAnalysis));

  // Sub-threshold: not stale enough to story.
  if (days < FRESHNESS_WARN_DAYS) return null;

  const lastTouched = formatLastAnalyzedDate(data.lastAnalyzedAt);
  if (!lastTouched) return null;

  const isCritical = days > FRESHNESS_CRITICAL_DAYS;
  const category: BriefingStory['category'] = isCritical ? 'risk' : 'opportunity';

  // Headlines — anchored in the typed payload.
  const headline = isCritical
    ? `${data.pagePath} hasn't been refreshed in ${Math.floor(days / 30)} months.`
    : `${data.pagePath} is ${days} days stale — time for a refresh.`;

  // Narrative — every sentence cites a number from the payload.
  const impressions = typeof data.impressions === 'number' ? data.impressions : null;
  const clicks = typeof data.clicks === 'number' ? data.clicks : null;

  const sentences: string[] = [];
  sentences.push(
    `${data.pagePath} was last analyzed on ${lastTouched}, ${days} days ago.`,
  );

  if (impressions !== null && impressions > 0 && clicks !== null && clicks > 0) {
    sentences.push(
      `Search demand is still live: the page logged ${impressions.toLocaleString('en-US')} impressions and ${clicks.toLocaleString('en-US')} clicks in the last 28 days.`,
    );
  } else if (impressions !== null && impressions > 0) {
    sentences.push(
      `Search demand is still live: the page logged ${impressions.toLocaleString('en-US')} impressions in the last 28 days.`,
    );
  } else if (clicks !== null && clicks > 0) {
    sentences.push(
      `The page still earns ${clicks.toLocaleString('en-US')} clicks across the last 28 days.`,
    );
  }

  sentences.push(
    isCritical
      ? `That puts it past the ${FRESHNESS_CRITICAL_DAYS}-day critical threshold — refresh the content to defend the rankings already earned.`
      : `It crosses the ${FRESHNESS_WARN_DAYS}-day warning line — schedule a refresh before rankings drift.`,
  );

  const narrative = sentences.join(' ');

  // Metric badges — 2 max, both anchored in typed data.
  const metrics: BriefingStory['metrics'] = [
    { value: `${days}d`, label: 'stale' },
  ];
  if (impressions !== null && impressions > 0) {
    metrics.push({
      value: `${impressions.toLocaleString('en-US')} impr`,
      label: 'still searched',
    });
  } else {
    metrics.push({ value: lastTouched, label: 'last touched' });
  }

  const dataReceipt =
    'Source: page_keywords lastAnalyzedAt timestamp. Threshold: 90d (warn), 180d (critical).';

  return {
    id: `story-${insight.id}`,
    category,
    isHeadline: false, // Watch List candidate — never lead the briefing.
    headline,
    narrative,
    metrics,
    dataReceipt,
    drillIn: { page: 'health', queryParams: { page: data.pagePath } },
    sourceRefs: [{ type: 'analytics_insight', id: insight.id }],
  };
}
