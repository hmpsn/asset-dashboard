export type {
  AuditRecommendationProducerContext,
  CtrOpportunityProducerContext,
  FailureAwareRecommendationProducerContext,
  RecommendationAssignedTo,
  RecommendationProducerScoringContext,
  StrategyRecommendationProducerContext,
} from './producer-contexts.js';
export type { LocalVisibilityRecommendationProducerContext } from './local-visibility-producers.js';

export { appendAuditRecommendations } from './audit-producers.js';
export { appendStrategyRecommendations } from './strategy-producers.js';
export { appendLocalVisibilityRecommendations } from './local-visibility-producers.js';
export {
  appendContentDecayRecommendations,
  appendCtrOpportunityRecommendations,
  appendDiagnosticRecommendations,
  appendFreshnessRecommendations,
} from './maintenance-producers.js';
