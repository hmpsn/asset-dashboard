/**
 * Compatibility barrel for recommendation route mutation helpers.
 *
 * Domain behavior lives under server/domains/recommendations/.
 */
export {
  applyBulkRecommendationAction,
  mintCompetitorRecommendation,
  mintManualRecommendation,
  type BulkRecommendationAction,
  type CompetitorRecommendationInput,
  type ManualRecommendationInput,
} from './domains/recommendations/route-mutations.js';
