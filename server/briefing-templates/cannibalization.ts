// server/briefing-templates/cannibalization.ts
//
// Deterministic briefing template for `cannibalization` insights.
// Maps a typed `CannibalizationData` payload onto a `BriefingStory` for
// rendering on the Watch List section of the client briefing.
//
// Spec: docs/superpowers/specs/2026-04-29-client-insights-redesign-design.md §5
// Plan task: T2.5a.7
//
// Severity is computed locally (the spec marks this type as "light derive"):
//   - pages.length >= 3                                    → 'high'
//   - pages.length === 2 AND |Δposition| <= 5              → 'medium'
//   - else                                                 → 'low'  (return null)
//
// Voice rules (STRICT, enforced by pr-check):
//   - No hedge words (potentially, could, may, appears to, suggests, might, seems).
//   - Every sentence cites a number from the typed payload.

import type {
  AnalyticsInsight,
  CannibalizationData,
} from '../../shared/types/analytics.js';
import type { BriefingStory } from '../../shared/types/briefing.js';
import type { TemplateContext } from './index.js';

/* TemplateContext renamed/imported as TemplateContext from ./index.js */

type Severity = 'high' | 'medium' | 'low';

/** Maximum number of competing pages to enumerate inline in narrative prose. */
const MAX_PAGES_LISTED = 3;

/** Position spread (in ranks) below which a 2-page overlap is considered material. */
const MEDIUM_POSITION_SPREAD = 5;

function computeSeverity(pageCount: number, positions: number[]): Severity {
  if (pageCount >= 3) return 'high';
  if (pageCount === 2) {
    const spread = Math.abs(positions[0] - positions[1]);
    if (spread <= MEDIUM_POSITION_SPREAD) return 'medium';
  }
  return 'low';
}

export function buildStoryFromInsight(
  insight: AnalyticsInsight,
  _context: TemplateContext,
): BriefingStory | null {
  const data = insight.data as CannibalizationData;

  // Required field validation — degrade gracefully if any are missing/inconsistent.
  if (!data || typeof data.query !== 'string' || data.query.length === 0) {
    return null;
  }
  if (!Array.isArray(data.pages) || !Array.isArray(data.positions)) {
    return null;
  }
  if (data.pages.length < 2) return null;
  if (data.pages.length !== data.positions.length) return null;
  if (typeof data.totalImpressions !== 'number' || data.totalImpressions < 0) {
    return null;
  }
  if (!data.positions.every((p) => typeof p === 'number' && Number.isFinite(p))) {
    return null;
  }

  const severity = computeSeverity(data.pages.length, data.positions);
  if (severity === 'low') return null; // not material enough for the Watch List

  const pageCount = data.pages.length;
  const impressions = Math.round(data.totalImpressions);
  const impressionsFmt = impressions.toLocaleString('en-US');
  const listedPages = data.pages.slice(0, MAX_PAGES_LISTED);
  const listedPositions = data.positions.slice(0, MAX_PAGES_LISTED);

  let headline: string;
  let narrative: string;

  if (severity === 'high') {
    headline = `${pageCount} pages competing for "${data.query}" — splitting impressions.`;

    // Pair each listed page with its position so the prose stays grounded
    // (e.g. "/a (#3), /b (#7), /c (#12)").
    const pageLine = listedPages
      .map((url, i) => `${url} (#${listedPositions[i]})`)
      .join(', ');
    const overflow = pageCount - listedPages.length;
    const sentence1 =
      overflow > 0
        ? `${pageCount} pages target "${data.query}" — top ${listedPages.length} ranking at ${pageLine}, plus ${overflow} more.`
        : `${pageCount} pages target "${data.query}", ranking at ${pageLine}.`;
    const sentence2 = `Total impressions across the cluster reached ${impressionsFmt}/mo, split across ${pageCount} competing URLs.`;
    narrative = `${sentence1} ${sentence2}`;
  } else {
    // severity === 'medium' — exactly 2 pages, positions within MEDIUM_POSITION_SPREAD ranks
    headline = `"${data.query}" has overlap on ${data.pages[0]} and ${data.pages[1]}.`;

    const sentence1 = `${data.pages[0]} and ${data.pages[1]} both target "${data.query}", ranking at #${data.positions[0]} and #${data.positions[1]}.`;
    const sentence2 = `The cluster pulled ${impressionsFmt} impressions/mo, divided across 2 URLs.`;
    narrative = `${sentence1} ${sentence2}`;
  }

  const dataReceipt =
    `Source: GSC query-page mapping. Total impressions across competing pages: ` +
    `${impressionsFmt}/mo. Severity computed from page count + position spread.`;

  return {
    id: `story-${insight.id}`,
    category: 'risk',
    isHeadline: false, // Watch List entry — never the hero
    leadEligible: false,
    headline,
    narrative,
    metrics: [
      { value: `${pageCount} pages`, label: 'competing' },
      { value: impressionsFmt, label: 'impressions' },
    ],
    dataReceipt,
    drillIn: { page: 'strategy', queryParams: { keyword: data.query } },
    sourceRefs: [{ type: 'analytics_insight', id: insight.id }],
  };
}
