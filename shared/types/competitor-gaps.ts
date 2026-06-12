// ── Competitor keyword gaps — client-safe projection ───────────────────────
//
// Contract boundary (shared by server projection + client surface) for the
// Premium "competitor benchmarking" surface (Client Revenue R2 §3 / §4a).
//
// The raw source is the `keyword_gaps` table (`KeywordGapItem` in
// shared/types/workspace.ts): keywords a named competitor ranks for that the
// workspace does not. That raw shape carries provider numbers (volume,
// difficulty) and is admin/evidence-only. The CLIENT projection below NEVER
// carries raw search volume, difficulty scores, or any money / EMV field — it
// exposes only BANDED, LABELED narrative value plus the you-vs-them position
// framing. The server projection (server/competitor-gaps-projection.ts) is the
// single enforcement point, mirroring the recommendations emv-leak strip
// pattern.

/** Banded opportunity strength — replaces raw volume×difficulty scoring. */
export type CompetitorGapOpportunityBand = 'high' | 'medium' | 'low';

/**
 * One client-safe competitor-gap row. "You vs them" per keyword:
 * a named competitor ranks for `keyword` at `competitorPosition`; the workspace
 * does not yet rank for it on page one.
 *
 * Deliberately ABSENT (admin/evidence-only, must never appear here):
 *   - raw `volume` (monthly search volume)
 *   - raw `difficulty` (KD score)
 *   - any EMV / $/week / monetary opportunity value
 */
export interface ClientCompetitorGap {
  /** The keyword a competitor ranks for and the workspace is missing. */
  keyword: string;
  /** The named competitor domain that ranks for this keyword (the Premium wedge). */
  competitorDomain: string;
  /** The competitor's approximate ranking position for this keyword. */
  competitorPosition: number;
  /** Banded opportunity strength — never a raw score. */
  opportunityBand: CompetitorGapOpportunityBand;
  /** Narrative demand label, e.g. "High search demand" — never a raw number. */
  demandLabel: string;
  /** One-line you-vs-them narrative for the row. */
  benchmark: string;
}

/** Response shape for GET /api/public/competitor-gaps/:workspaceId. */
export interface ClientCompetitorGapsResponse {
  gaps: ClientCompetitorGap[];
  /** Total gaps available (the denominator behind any "N opportunities" count). */
  total: number;
  pageInfo?: {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  };
}
