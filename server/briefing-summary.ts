// server/briefing-summary.ts
//
// Phase 2.5b — deterministic issue-summary generator.
//
// Produces the single-line "investor briefing" prose that sits below the
// dateline ("A win at the top, two risks to watch, seven opportunities to
// consider."). Pure projection from typed story categories + recommendation
// count. No AI. No hedge words. Composable from the wire response at serve
// time so every reader sees a summary consistent with the stories they see.

import type { BriefingCategory, BriefingStory } from '../shared/types/briefing.js';

/**
 * Lead phrase keyed by the headline story's category. The phrase frames the
 * issue's centre of gravity in 4-6 words, no hedge words. When a category is
 * unmapped, falls back to a neutral opener.
 */
const LEAD_PHRASES: Record<BriefingCategory, string> = {
  win: 'A win at the top',
  risk: 'A risk to address first',
  opportunity: 'An opportunity to lead with',
  competitive: 'A competitor move at the top',
  period_change: 'A shift in the numbers',
};

const NEUTRAL_LEAD = 'A look at this week';

/**
 * Generate the one-line issue summary from the briefing's story composition.
 *
 * @param stories - the published briefing's stories. Exactly one is the hero
 *   (`isHeadline === true`); the rest are watch-list candidates.
 * @param recommendationCount - number of "Recommended for You" gaps that will
 *   render below the data spread. Drives the trailing "N opportunities to
 *   consider" clause when ≥1.
 * @returns A single sentence ending in a period. Always returns at least the
 *   lead phrase — never the empty string.
 */
export function generateIssueSummary(
  stories: BriefingStory[],
  recommendationCount: number,
): string {
  const hero = stories.find((s) => s.isHeadline);
  const heroCategory = hero?.category;
  // `?? NEUTRAL_LEAD` guards a future BriefingCategory addition that hasn't
  // been wired into LEAD_PHRASES yet — without it the lookup would return
  // `undefined` and render "undefined, …" in the summary.
  const leadPhrase = (heroCategory && LEAD_PHRASES[heroCategory]) ?? NEUTRAL_LEAD;

  // Watch-list (non-headline) breakdown — risks vs everything-else. We treat
  // "risk" + "competitive" as risks; "win" + "opportunity" + "period_change"
  // count as items the reader might explore but not as risks-to-watch.
  const secondary = stories.filter((s) => !s.isHeadline);
  const riskCount = secondary.filter(
    (s) => s.category === 'risk' || s.category === 'competitive',
  ).length;

  const clauses: string[] = [leadPhrase];

  if (riskCount > 0) {
    clauses.push(`${riskCount} ${riskCount === 1 ? 'risk' : 'risks'} to watch`);
  }

  if (recommendationCount > 0) {
    clauses.push(
      `${recommendationCount} ${recommendationCount === 1 ? 'opportunity' : 'opportunities'} to consider`,
    );
  }

  return `${clauses.join(', ')}.`;
}
