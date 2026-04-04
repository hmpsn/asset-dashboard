// shared/types/keywords.ts

/**
 * Canonical source values for keyword metrics.
 * Use these constants — never raw string literals.
 *
 * pr-check enforces: no bare 'bulk_lookup' or 'ai_estimate' strings outside this file.
 */
export const METRICS_SOURCE = {
  /** Exact keyword match from SEMRush bulk lookup. */
  EXACT: 'exact',
  /** Partial/fuzzy match from SEMRush. */
  PARTIAL_MATCH: 'partial_match',
  /** SEMRush bulk domain organic data lookup. */
  BULK_LOOKUP: 'bulk_lookup',
  /** AI-estimated metrics (no SEMRush data available). */
  AI_ESTIMATE: 'ai_estimate',
} as const;

export type MetricsSource = typeof METRICS_SOURCE[keyof typeof METRICS_SOURCE];
