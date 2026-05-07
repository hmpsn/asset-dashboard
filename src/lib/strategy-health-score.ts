/**
 * Pure helper for computing the StrategyTab "strategy health" score and the
 * surrounding derived counts. Extracted from
 * src/components/client/StrategyTab.tsx so the calculation can be unit-tested
 * in isolation, especially the divide-by-zero / empty-data edge cases.
 *
 * Health score formula (max 100):
 *   - content gaps: min(40, gaps × 4)        — capped at 10 gaps
 *   - quick wins:   min(30, quickWins × 6)   — capped at 5 quick wins
 *   - coverage:     round(pagesRanking / max(1, totalPages) × 30)
 */
import type { ClientKeywordStrategy } from '../components/client/types';

export interface StrategyHealthBreakdown {
  contentGapsFound: number;
  quickWinsAvailable: number;
  keywordGapCount: number;
  /** contentGapsFound + keywordGapCount — surfaces in copy as "new topics". */
  newContentTopicCount: number;
  pagesRanking: number;
  totalPages: number;
  /** Pages with no current ranking but non-zero impressions (growth opps). */
  pagesWithGrowthOpps: number;
  contentScore: number;
  quickWinScore: number;
  coverageScore: number;
  /** Sum of contentScore + quickWinScore + coverageScore (0..100). */
  healthScore: number;
}

export function calculateStrategyHealth(
  strategyData: ClientKeywordStrategy,
): StrategyHealthBreakdown {
  const contentGapsFound = strategyData.contentGaps?.length || 0;
  const quickWinsAvailable = strategyData.quickWins?.length || 0;
  const keywordGapCount = strategyData.keywordGaps?.length || 0;
  const newContentTopicCount = contentGapsFound + keywordGapCount;
  const pageMap = strategyData.pageMap ?? [];
  const pagesRanking = pageMap.filter(p => p.currentPosition).length;
  const totalPages = pageMap.length;
  const pagesWithGrowthOpps = pageMap.filter(
    p => !p.currentPosition && (p.impressions || 0) > 0,
  ).length;

  // Each component is capped so the resulting health score stays in 0..100.
  const contentScore = Math.min(40, contentGapsFound * 4);
  const quickWinScore = Math.min(30, quickWinsAvailable * 6);
  // `Math.max(1, totalPages)` keeps the division safe when there are no pages.
  const coverageScore = Math.round((pagesRanking / Math.max(1, totalPages)) * 30);
  const healthScore = contentScore + quickWinScore + coverageScore;

  return {
    contentGapsFound,
    quickWinsAvailable,
    keywordGapCount,
    newContentTopicCount,
    pagesRanking,
    totalPages,
    pagesWithGrowthOpps,
    contentScore,
    quickWinScore,
    coverageScore,
    healthScore,
  };
}
