/**
 * Recommendation Engine public facade.
 *
 * Domain behavior lives under server/domains/recommendations/. Keep this file
 * as the compatibility boundary for legacy imports from routes, tests, and
 * cross-domain integrations.
 */

import type { RecommendationSet } from '../shared/types/recommendations.ts';

// ─── Types ────────────────────────────────────────────────────────

export type { RecPriority, RecType, RecStatus, RecActionType, Recommendation, RecommendationSet } from '../shared/types/recommendations.ts';

type RecommendationGenerationService = {
  generateRecommendations: (workspaceId: string) => Promise<RecommendationSet>;
};

export {
  INTENT_STOPWORDS,
  RecSource,
  applyLifecycleCarryOver,
  auditInsight,
  buildMergeKey,
  buildOvGainString,
  cannibalizationUrlSetKey,
  checkToRecType,
  computeRecommendationSummary,
  deriveOvTier,
  getRecSourceCategory,
  getRecoveryRate,
  getTrafficScore,
  inferPageType,
  inferSchemaTypes,
  isExemptFromAutoResolve,
  isIntentMismatch,
  isActiveRec,
  isCuratedForClient,
  isOperatorMintedRec,
  isRecIntentAligned,
  mapToProduct,
  migrateSourceKey,
  pageImportanceMultiplier,
  resolveEstimatedGain,
  sortRecommendations,
  toPageSlug,
  type RecSourceCategory,
  type RecoveryRate,
} from './domains/recommendations/rules.js';

export {
  resolveContentRecommendationsForPublishedPost,
  resolveRecommendationsForChange,
  resolveRecommendationsForPageIds,
} from './domains/recommendations/resolution-service.js';

export {
  recommendationOutcomeActionType,
} from './domains/recommendations/outcome-action-type.js';

export {
  dismissRecommendation,
  loadRecommendations,
  saveRecommendations,
  updateRecommendationStatus,
} from './domains/recommendations/status-service.js';

export async function generateRecommendations(workspaceId: string): Promise<RecommendationSet> {
  const generationServicePath = './domains/recommendations/generation-service.js';
  const { generateRecommendations: generate } =
    await import(generationServicePath) as RecommendationGenerationService; // dynamic-import-ok - keep the public facade from statically joining the recommendation generation cycle
  return generate(workspaceId);
}

export {
  adjustKdImpactScore,
  classifyKdGap,
  kdClassificationNote,
} from './authority-context.js';
