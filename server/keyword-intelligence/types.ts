import type { KeywordCandidate } from '../../shared/types/content.js';
import type { SeoContextSlice } from '../../shared/types/intelligence.js';
import type { PageKeywordMap } from '../../shared/types/workspace.js';
import type { KeywordSourceEvidence } from '../../shared/types/keywords.js';

export type KeywordIntelligenceSource = KeywordCandidate['source'] | KeywordSourceEvidence['sourceKind'] | string;

export type KeywordDecisionReasonType =
  | 'client_requested'
  | 'client_approved'
  | 'client_declined'
  | 'business_fit'
  | 'business_mismatch'
  | 'content_gap'
  | 'recent_client_interest'
  | 'gsc_proven'
  | 'seed_keyword'
  | 'duplicate'
  | 'page_map_conflict'
  | 'cannibalization_conflict'
  | 'broad_or_adjacent'
  | 'weak_topical_overlap'
  | 'low_provider_demand'
  | 'authority_mismatch'
  | 'outcome_learning'
  | 'source_evidence'
  | 'noise_pattern';

export interface KeywordDecisionReason {
  type: KeywordDecisionReasonType;
  message: string;
  weight: number;
}

export interface KeywordBusinessContext {
  businessTerms?: string[];
  businessPhrases?: string[];
  businessPriorities?: string[];
  contentGapTopics?: string[];
  recentChatTopics?: string[];
}

export interface KeywordEvaluationContext extends KeywordBusinessContext {
  workspaceId?: string;
  seedKeyword?: string;
  pageMap?: PageKeywordMap[];
  declinedKeywords?: string[];
  requestedKeywords?: string[];
  approvedKeywords?: string[];
  rejectionReasons?: string[];
  backlinkProfile?: SeoContextSlice['backlinkProfile'];
  strictBusinessFit?: boolean;
}

export interface KeywordEvaluationResult {
  keyword: string;
  normalizedKeyword: string;
  scoreDelta: number;
  suppressed: boolean;
  reasons: KeywordDecisionReason[];
  fitSignals: string[];
}
