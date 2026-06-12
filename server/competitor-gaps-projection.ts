// ── Competitor keyword gaps — client-safe projection ───────────────────────
//
// Single enforcement point that turns raw `KeywordGapItem` rows (which carry
// provider volume/difficulty numbers) into the client-safe `ClientCompetitorGap`
// shape. NO raw volume, NO raw difficulty, NO money/EMV ever crosses this
// boundary — only banded/labeled value + you-vs-them narrative. Mirrors the
// recommendations emv-leak strip pattern (server/recommendations.ts).

import type { KeywordGapItem } from '../shared/types/workspace.js';
import type {
  ClientCompetitorGap,
  CompetitorGapOpportunityBand,
} from '../shared/types/competitor-gaps.js';

/**
 * Band a gap's opportunity strength from raw volume + difficulty.
 * High demand + reachable difficulty → high; the inverse → low.
 * The raw numbers are consumed here and discarded — they never leave.
 */
function bandOpportunity(volume: number, difficulty: number): CompetitorGapOpportunityBand {
  // Reachable + meaningful demand → strong opportunity.
  if (volume >= 500 && difficulty <= 40) return 'high';
  // Either decent demand OR a reachable difficulty keeps it mid-tier.
  if (volume >= 150 && difficulty <= 70) return 'medium';
  return 'low';
}

/** Narrative demand label — replaces the raw monthly-volume number. */
function demandLabelFor(volume: number): string {
  if (volume >= 2000) return 'Very high search demand';
  if (volume >= 500) return 'High search demand';
  if (volume >= 100) return 'Moderate search demand';
  return 'Niche search demand';
}

/** One-line you-vs-them benchmark narrative. */
function benchmarkFor(domain: string, position: number): string {
  const rounded = Math.max(1, Math.round(position));
  if (rounded <= 3) {
    return `${domain} ranks in the top 3 for this — you're not on page one yet.`;
  }
  if (rounded <= 10) {
    return `${domain} ranks on page one (around #${rounded}) for this — you're not yet.`;
  }
  return `${domain} ranks for this (around #${rounded}) and you don't yet.`;
}

/** Project a single raw gap into the client-safe shape. */
export function projectCompetitorGap(gap: KeywordGapItem): ClientCompetitorGap {
  return {
    keyword: gap.keyword,
    competitorDomain: gap.competitorDomain,
    competitorPosition: Math.max(1, Math.round(gap.competitorPosition)),
    opportunityBand: bandOpportunity(gap.volume, gap.difficulty),
    demandLabel: demandLabelFor(gap.volume),
    benchmark: benchmarkFor(gap.competitorDomain, gap.competitorPosition),
  };
}

const BAND_RANK: Record<CompetitorGapOpportunityBand, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

/**
 * Project + opportunity-rank a list of raw gaps for the client surface.
 * Sorted high → low opportunity, then by competitor strength (best position
 * first) so the most compelling "they own this, you don't" rows lead.
 */
export function projectCompetitorGaps(gaps: KeywordGapItem[]): ClientCompetitorGap[] {
  return gaps
    .map(projectCompetitorGap)
    .sort((a, b) => {
      const bandDelta = BAND_RANK[a.opportunityBand] - BAND_RANK[b.opportunityBand];
      if (bandDelta !== 0) return bandDelta;
      if (a.competitorPosition !== b.competitorPosition) {
        return a.competitorPosition - b.competitorPosition;
      }
      return a.keyword.localeCompare(b.keyword);
    });
}
