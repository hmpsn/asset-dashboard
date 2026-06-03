// server/briefing-client-projection.ts
// Pure function that builds the enriched client-facing briefing payload.
// Extracted from public-portal.ts so both the public endpoint and the
// admin preview endpoint return identical data.

import { getLatestPublishedBriefing, countPublishedBriefingsThrough } from './briefing-store.js';
import { generateIssueSummary } from './briefing-summary.js';
import { computeOpportunityScore } from './keyword-strategy-generation.js';
import { listContentGaps } from './content-gaps.js';
import { isFeatureEnabled } from './feature-flags.js';
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
    .sort((a, b) => {
      // Three-bucket sort (matches keyword-strategy.ts content gap ordering):
      //   2 = Positive volume OR GSC-proven impressions — confirmed demand
      //   1 = Unenriched (null/undefined) — not yet checked, potential
      //   0 = Zero volume with no impressions — confirmed no demand
      const getBundle = (g: typeof a) => {
        if (g.volume == null) return { bucket: 1, vol: 0 };
        if (g.volume > 0) return { bucket: 2, vol: g.volume };
        if ((g.impressions ?? 0) > 0) return { bucket: 2, vol: g.impressions! };
        return { bucket: 0, vol: 0 };
      };
      const ab = getBundle(a), bb = getBundle(b);
      return bb.bucket - ab.bucket || bb.vol - ab.vol || (b.opportunityScore ?? 0) - (a.opportunityScore ?? 0);
    })
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

  // SEO Gen-Quality P4 (Contract 3) — resolve the per-workspace umbrella state once,
  // server-side, and thread it to the client `RecommendedForYou` component. The client
  // has no per-workspace flag mechanism, so this boolean is the single point of truth
  // for whether the OV-EMV-derived opportunity badge replaces the pre-P4 "/100" badge +
  // "est. clicks at rank #3" estimate. Flag-OFF (default, all prod today) → false → the
  // client renders the pre-P4 surface byte-identically.
  const ovGainActive = isFeatureEnabled('seo-generation-quality', workspaceId);

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
