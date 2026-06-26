/**
 * Analytics Intelligence — compatibility facade.
 *
 * Domain-owned implementation lives under server/domains/analytics-intelligence/.
 * Keep these re-exports stable for existing callers while the god-module
 * decomposition continues.
 */
export {
  deduplicatePages,
  deduplicateQueryPages,
  normalizePageUrlWithOrigin,
} from './domains/analytics-intelligence/normalization.js';
export {
  capWithDiversity,
} from './domains/analytics-intelligence/feed.js';
export {
  computeCannibalizationInsights,
  computeCompetitorGapInsights,
  computeConversionAttributionInsights,
  computeCtrOpportunities,
  computeFreshnessAlerts,
  computeKeywordClusterInsights,
  computePageHealthScores,
  computeRankingMovers,
  computeRankingOpportunities,
  computeSerpFeatureOpportunities,
  computeSerpOpportunities,
  expectedCtrForPosition,
  isKeywordEmerging,
  isStale,
  wordJaccard,
} from './domains/analytics-intelligence/computations.js';
export { getOrComputeInsights } from './domains/analytics-intelligence/orchestrator.js';
export { refreshContentDecayInsights } from './domains/analytics-intelligence/content-decay-refresh.js';
export { pickWeaker, validateInsightBatch } from './domains/analytics-intelligence/validation.js';
