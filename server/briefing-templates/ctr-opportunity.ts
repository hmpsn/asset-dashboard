// server/briefing-templates/ctr-opportunity.ts
//
// Deterministic projection from a `ctr_opportunity` analytics insight to a
// `BriefingStory`. Phase 2.5a — see
// docs/superpowers/specs/2026-04-29-client-insights-redesign-design.md §5
// for the voice contract this file enforces.
//
// VOICE CONTRACT (enforced by pr-check rule "Banned hedge words in briefing
// templates" scoped to server/briefing-templates/):
// - No hedge words: potentially / could / may / appears to / suggests /
//   might / seems.
// - Every sentence in the narrative cites a number from the typed payload.
// - Definite tense ("earns 6.3% CTR"), never future-tense speculation
//   ("could capture more clicks").
//
// Eligibility for an OPPORTUNITY (Watch List) story:
//   - actualCtr < expectedCtr  (page underperforms its SERP-position benchmark)
//   - impressions >= 100       (volume threshold — filters low-signal noise)
//   - estimatedClickGap > 0    (recoverable upside is non-trivial)
//
// IMPORTANT: `actualCtr` and `expectedCtr` are ALREADY percentages on the
// stored payload (e.g. 6.3 for 6.3% — see JSDoc on `CtrOpportunityData`).
// This module never multiplies or divides by 100.
//
// Spec assigns this story type as Watch List (NOT lead-eligible), so
// `isHeadline` is unconditionally `false`.

import type { AnalyticsInsight, CtrOpportunityData } from '../../shared/types/analytics.js';
import type { BriefingStory } from '../../shared/types/briefing.js';

const MIN_IMPRESSIONS = 100;

export interface TemplateContext {
  workspaceId: string;
  tier: 'free' | 'growth' | 'premium';
}

/**
 * Format a CTR percentage for display. The stored value is already a
 * percentage (e.g. 6.3), so no scaling. We render whole-number values
 * without trailing `.0` (`6` not `6.0`) and otherwise keep one decimal
 * place (`6.3`). Negative values are clamped to `0` — a CTR cannot be
 * negative, so a negative number indicates upstream corruption and we
 * show the safer floor.
 */
function formatCtr(value: number): string {
  if (!Number.isFinite(value)) return '0';
  const safe = value < 0 ? 0 : value;
  if (Number.isInteger(safe)) return String(safe);
  return safe.toFixed(1);
}

export function buildStoryFromInsight(
  insight: AnalyticsInsight<'ctr_opportunity'>,
  _context: TemplateContext,
): BriefingStory | null {
  const data = insight.data as CtrOpportunityData;

  // Required fields: degrade gracefully when any are missing.
  if (
    !data.query ||
    !data.pageUrl ||
    typeof data.position !== 'number' ||
    typeof data.actualCtr !== 'number' ||
    typeof data.expectedCtr !== 'number' ||
    typeof data.impressions !== 'number'
  ) {
    return null;
  }

  // Eligibility gates.
  if (data.actualCtr >= data.expectedCtr) return null;
  if (data.impressions < MIN_IMPRESSIONS) return null;
  if (typeof data.estimatedClickGap !== 'number' || data.estimatedClickGap <= 0) {
    return null;
  }

  const actualCtrLabel = formatCtr(data.actualCtr);
  const expectedCtrLabel = formatCtr(data.expectedCtr);
  const clickGap = Math.round(data.estimatedClickGap);

  // Headline — anchored in two numbers (actual CTR + benchmark CTR).
  const headline =
    `"${data.query}" gets ${actualCtrLabel}% CTR — typical at #${data.position} is ${expectedCtrLabel}%.`;

  // Narrative: 3 sentences, every sentence carries a number, no hedges.
  // Sentence 1: page + query + rank + impressions + actual vs expected CTR.
  // Sentence 2: click upside ("clicks left on the table" is allowed; the
  //             banned phrasing is "could capture more clicks").
  // Sentence 3: title-tag / meta-description optimization tied to the gap.
  const narrative =
    `${data.pageUrl} ranks #${data.position} for "${data.query}" with ` +
    `${data.impressions} impressions over the last 28 days, but earns only ` +
    `${actualCtrLabel}% CTR versus the ${expectedCtrLabel}% benchmark for that position. ` +
    `That gap leaves ${clickGap} clicks on the table — clicks the page already ` +
    `qualifies for at its current rank. ` +
    `Aligning the title tag and meta description to searcher intent closes the ` +
    `${expectedCtrLabel}% – ${actualCtrLabel}% gap.`;

  const dataReceipt =
    `Source: GSC last-28-day. ` +
    `Impressions baseline: ${data.impressions}. ` +
    `Position ${data.position} CTR benchmark from internal SERP curve.`;

  return {
    id: `story-${insight.id}`,
    category: 'opportunity',
    isHeadline: false,
    headline,
    narrative,
    metrics: [
      {
        value: `${actualCtrLabel}% / ${expectedCtrLabel}%`,
        label: 'CTR vs benchmark',
      },
      {
        value: `+${clickGap}`,
        label: 'click upside',
      },
    ],
    drillIn: {
      page: 'performance',
      queryParams: { page: data.pageUrl, query: data.query },
    },
    sourceRefs: [{ type: 'analytics_insight', id: insight.id }],
    dataReceipt,
  };
}
