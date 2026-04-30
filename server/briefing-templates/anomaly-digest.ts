// Briefing template — anomaly_digest (positive direction only).
//
// Maps an `AnalyticsInsight<'anomaly_digest'>` payload to a deterministic
// `BriefingStory`. Drops only — `currentValue < expectedValue` for clicks /
// impressions, `currentValue > expectedValue` for position — are intentionally
// excluded here; they are surfaced through `content_decay` and `audit_finding`
// templates instead. See spec §5 (Story Type Catalog) for the contract.
//
// Voice rules (enforced by scripts/pr-check.ts "Banned hedge words in briefing
// templates"): every sentence cites a number from the typed payload, no hedges,
// past or present tense only.

import type {
  AnalyticsInsight,
  AnomalyDigestData,
} from '../../shared/types/analytics.js';
import type { BriefingStory } from '../../shared/types/briefing.js';

interface TemplateContext {
  workspaceId: string;
  tier: 'free' | 'growth' | 'premium';
}

/**
 * Metrics where "positive direction" means the current value rose above the
 * baseline (clicks up, impressions up).
 */
const HIGHER_IS_BETTER = new Set(['clicks', 'impressions']);

/**
 * Metrics where "positive direction" means the current value fell below the
 * baseline (position #11 → #4 is a numerical drop but a ranking improvement).
 */
const LOWER_IS_BETTER = new Set(['position']);

/** Round an absolute deviation to a clean integer (e.g. 47.3 → 47). */
function formatDeviation(deviationPercent: number): string {
  const abs = Math.abs(deviationPercent);
  // Round to integer for clean display; sub-1% surges aren't lead-eligible
  // anyway so we don't need fractional precision.
  return `${Math.round(abs)}`;
}

/**
 * Format a numeric value for narrative prose. Large numbers get thousand
 * separators ("12,400"); positions stay as integers ("4"); small numbers stay
 * as-is.
 */
function formatValue(value: number, metric: string): string {
  if (metric === 'position') return `${Math.round(value)}`;
  if (Math.abs(value) >= 1000) {
    return Math.round(value).toLocaleString('en-US');
  }
  // Trim trailing zeros from floats but preserve integers as integers.
  if (Number.isInteger(value)) return `${value}`;
  return `${Math.round(value * 10) / 10}`;
}

/** Human-readable label for a metric used inside narrative prose. */
function metricLabel(metric: string): string {
  switch (metric) {
    case 'clicks':
      return 'search clicks';
    case 'impressions':
      return 'search impressions';
    case 'position':
      return 'average ranking position';
    default:
      return metric;
  }
}

/**
 * Determine whether the anomaly represents a positive movement for the
 * tracked metric. Position is inverted (lower = better); other metrics use
 * the standard "current above expected" rule.
 */
function isPositiveDirection(data: AnomalyDigestData): boolean {
  if (LOWER_IS_BETTER.has(data.metric)) {
    return data.currentValue < data.expectedValue;
  }
  if (HIGHER_IS_BETTER.has(data.metric)) {
    return data.currentValue > data.expectedValue;
  }
  // Unknown metrics: fall back to the spec's blanket rule — positive means
  // current value rose above expected.
  return data.currentValue > data.expectedValue;
}

export function buildStoryFromInsight(
  insight: AnalyticsInsight,
  _context: TemplateContext,
): BriefingStory | null {
  const data = insight.data as AnomalyDigestData;

  // Required fields — degrade gracefully when any are missing.
  if (
    typeof data?.metric !== 'string' ||
    data.metric.length === 0 ||
    typeof data.currentValue !== 'number' ||
    typeof data.expectedValue !== 'number' ||
    typeof data.deviationPercent !== 'number' ||
    typeof data.durationDays !== 'number'
  ) {
    return null;
  }

  // Eligibility — only positive-direction anomalies become wins. Drops are
  // covered by content_decay / audit_finding templates.
  if (!isPositiveDirection(data)) return null;

  const deviationStr = formatDeviation(data.deviationPercent);
  const currentStr = formatValue(data.currentValue, data.metric);
  const expectedStr = formatValue(data.expectedValue, data.metric);
  const pageOrSite = data.affectedPage ?? 'site-wide';
  const pageOrSiteNarrative = data.affectedPage ?? 'site-wide';

  // Headline — metric-aware, 5-12 words, anchored in a number.
  let headline: string;
  if (data.metric === 'position') {
    // Lower position is better; describe the magnitude as ranks gained.
    const rankGain = Math.round(data.expectedValue - data.currentValue);
    headline = `Average ranking jumped ${rankGain} spots on ${pageOrSite}.`;
  } else if (data.metric === 'impressions') {
    headline = `Search impressions just jumped +${deviationStr}% on ${pageOrSite}.`;
  } else if (data.metric === 'clicks') {
    headline = `Search clicks just spiked +${deviationStr}% on ${pageOrSite}.`;
  } else {
    // Generic positive-surge headline for unknown metrics.
    headline = `${metricLabel(data.metric)} surged +${deviationStr}% on ${pageOrSite}.`;
  }

  // Narrative — 2-3 sentences, every sentence cites a number.
  let narrative: string;
  if (data.metric === 'position') {
    narrative =
      `${metricLabel(data.metric)} on ${pageOrSiteNarrative} moved from ` +
      `#${expectedStr} to #${currentStr} over the last ${data.durationDays} days. ` +
      `That is a ${deviationStr}% improvement against the prior baseline of ` +
      `#${expectedStr}.`;
  } else {
    narrative =
      `${metricLabel(data.metric)} on ${pageOrSiteNarrative} climbed from ` +
      `${expectedStr} to ${currentStr} over the last ${data.durationDays} days. ` +
      `That is a +${deviationStr}% lift against the prior baseline of ` +
      `${expectedStr}.`;
  }

  // Metric badges — exactly two: deviation magnitude + duration.
  const deviationBadgeValue =
    data.metric === 'position'
      ? `#${expectedStr} → #${currentStr}`
      : `+${deviationStr}%`;
  const deviationBadgeLabel =
    data.metric === 'position' ? 'position' : data.metric;

  const metrics = [
    { value: deviationBadgeValue, label: deviationBadgeLabel },
    { value: `${data.durationDays}d`, label: 'sustained' },
  ];

  // Receipt — names the source, baseline, current value, first-detected date.
  const dataReceipt =
    `Source: anomaly detection cron. Baseline: ${expectedStr}. ` +
    `Current: ${currentStr}. First detected: ${data.firstDetected}.`;

  // Drill-in — page Performance, scoped to affectedPage when available.
  const drillIn = data.affectedPage
    ? {
        page: 'performance' as const,
        queryParams: { page: data.affectedPage },
      }
    : { page: 'performance' as const };

  return {
    id: `story-${insight.id}`,
    category: 'win',
    isHeadline: false,
    headline,
    narrative,
    metrics,
    drillIn,
    sourceRefs: [{ type: 'analytics_insight', id: insight.id }],
    dataReceipt,
  };
}
