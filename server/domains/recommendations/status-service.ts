import type { RecStatus, Recommendation, RecommendationSet } from '../../../shared/types/recommendations.ts';
import { RECOMMENDATION_TRANSITIONS, validateTransition } from '../../state-machines.js';
import { computeRecommendationSummary } from './rules.js';
import {
  loadRecommendationSet,
  saveRecommendationSet,
  setRecommendationItemStatus,
} from './storage.js';

export function loadRecommendations(workspaceId: string): RecommendationSet | null {
  return loadRecommendationSet(workspaceId);
}

export function saveRecommendations(set: RecommendationSet): void {
  saveRecommendationSet(set);
}

export function updateRecommendationStatus(
  workspaceId: string,
  recId: string,
  status: RecStatus
): Recommendation | null {
  // Recompute the summary so topRecommendationId stays consistent after a
  // status flip — completing or dismissing a rec must not leave the pointer
  // referencing that now-inactive rec. computeRecommendationSummary already
  // excludes completed/dismissed recs when picking activeRecs[0].
  return setRecommendationItemStatus(
    workspaceId,
    recId,
    status,
    computeRecommendationSummary,
    (current, next) => validateTransition('recommendation', RECOMMENDATION_TRANSITIONS, current, next),
  );
}

export function dismissRecommendation(workspaceId: string, recId: string): boolean {
  return updateRecommendationStatus(workspaceId, recId, 'dismissed') !== null;
}
