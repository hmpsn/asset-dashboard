// server/briefing-client-projection.ts
// Pure function that builds the enriched client-facing briefing payload.
// Extracted from public-portal.ts so both the public endpoint and the
// admin preview endpoint return identical data.

import { getLatestPublishedBriefing, countPublishedBriefingsThrough } from './briefing-store.js';
import { generateIssueSummary } from './briefing-summary.js';
import { computeOpportunityScore } from './keyword-strategy-generation.js';
import { listContentGaps } from './content-gaps.js';
import { compareBriefingContentGapDisplayOrder } from '../shared/keyword-opportunity-projection.js';
import type { BriefingClientView, BriefingRecommendation } from '../shared/types/briefing.js';

export interface BuildBriefingClientViewOptions {
  /** Max recommendations to return (default 5) */
  limit?: number;
}

/**
 * Builds the enriched client-facing briefing view for a workspace.
 * Returns `null` when no published briefing exists.
 *
 * This is a pure read — no mutations, no auth checks, no tier gating.
 * Callers are responsible for auth/tier validation.
 */
export function buildBriefingClientView(
  workspaceId: string,
  opts?: BuildBriefingClientViewOptions,
): BriefingClientView | null {
  const limit = opts?.limit ?? 5;

  const latest = getLatestPublishedBriefing(workspaceId);
  if (!latest) return null;

  // Phase 2.5b — issueNumber is the count of published briefings <= this one's
  // publishedAt. Always >=1 once published; falls back to 1 defensively when
  // publishedAt is unexpectedly null (shouldn't happen for status='published').
  const issueNumber = latest.publishedAt
    ? countPublishedBriefingsThrough(workspaceId, latest.publishedAt)
    : 1;

  // Phase 2.5b — recommendations sourced live from current contentGaps.
  // Score-fallback: when a gap is missing `opportunityScore` we compute it
  // here using the same formula as keyword-strategy.ts so ranking is stable
  // across stored vs newly-collected gaps. Top N by score are returned.
  //
  // Defense-in-depth: explicit field projection rather than spread. ContentGap
  // is workspace-scoped strategy data with no admin-only fields TODAY, but a
  // future field added there must NOT silently leak through `...gap`. Any
  // change to the public projection now requires touching this list.
  const gaps = listContentGaps(workspaceId);
  type GapMapped = BriefingRecommendation & { volume?: number; impressions?: number; opportunityScore?: number };
  const recommendations: BriefingRecommendation[] = gaps
    .map((gap): GapMapped => ({
      topic: gap.topic,
      targetKeyword: gap.targetKeyword,
      intent: gap.intent,
      priority: gap.priority,
      rationale: gap.rationale,
      suggestedPageType: gap.suggestedPageType,
      volume: gap.volume,
      difficulty: gap.difficulty,
      trendDirection: gap.trendDirection,
      serpFeatures: gap.serpFeatures,
      impressions: gap.impressions,
      competitorProof: gap.competitorProof,
      questionKeywords: gap.questionKeywords,
      serpTargeting: gap.serpTargeting,
      opportunityScore: gap.opportunityScore ?? computeOpportunityScore(gap),
    }))
    .sort(compareBriefingContentGapDisplayOrder)
    .slice(0, limit);

  // The summary's "N opportunities to consider" reflects the FULL gap pool,
  // not the post-cap render set. If 23 gaps exist, the summary still says
  // "23 opportunities to consider" even though the briefing only renders 5.
  const issueSummary = generateIssueSummary(latest.stories, gaps.length);

  // Phase 2.5e — surface the AI-generated weekly opener when present.
  // The rest of `sourceMetadata` (model, generationMs, ai timing, original
  // hero headline) stays admin-only — only the opener string crosses the
  // public boundary.
  const weeklyOpener = latest.sourceMetadata?.aiPolish?.weeklyOpener;

  // OV-based opportunity rendering is now canonical for client briefing recommendations.
  const ovGainActive = true;

  return {
    weekOf: latest.weekOf,
    publishedAt: latest.publishedAt,
    stories: latest.stories,
    issueSummary,
    issueNumber,
    recommendations,
    weeklyOpener: weeklyOpener || undefined,
    ovGainActive,
  };
}
