import type { AuditSnapshot } from '../../reports.js';
import type { ComputeOptions } from '../../scoring/opportunity-value.js';
import type { Recommendation, RecType } from '../../../shared/types/recommendations.js';
import type { assessAuthorityFromBacklinks } from '../../authority-context.js';
import type { RecSourceCategory, TrafficMap } from './rules.js';

export type RecommendationAssignedTo = 'team' | 'client';

export interface RecommendationProducerScoringContext {
  workspaceId: string;
  now: string;
  assignedTo: RecommendationAssignedTo;
  effortDaysFor: (type: RecType, source: string) => number | null;
  authorityStrength: number | null;
  timingBoosts: Map<string, number>;
  opportunityOptions: ComputeOptions;
}

export interface AuditRecommendationProducerContext extends RecommendationProducerScoringContext {
  audit: AuditSnapshot;
  traffic: TrafficMap;
  conversionMap: Map<string, number>;
}

export interface FailureAwareRecommendationProducerContext extends RecommendationProducerScoringContext {
  failedCategories: Set<RecSourceCategory>;
}

export interface CtrOpportunityProducerContext extends FailureAwareRecommendationProducerContext {
  ctrCurve: Record<number, number> | null;
}

type BacklinkProfileForAuthority = Parameters<typeof assessAuthorityFromBacklinks>[1];

export interface StrategyRecommendationProducerContext extends CtrOpportunityProducerContext {
  traffic: TrafficMap;
  declinedKeywords: Set<string>;
  inFlightContentKeywords: Set<string>;
  domainStrength: number;
  backlinkProfile: BacklinkProfileForAuthority;
}

export type RecommendationList = Recommendation[];
