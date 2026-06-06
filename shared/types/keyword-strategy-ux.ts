import type {
  TrackedKeywordAuthorityPosture,
  TrackedKeywordSource,
  TrackedKeywordStatus,
} from './rank-tracking.js';

export type KeywordStrategyUxSurface = 'admin' | 'client';

export type KeywordStrategyExplanationRole =
  | 'site_keyword'
  | 'page_keyword'
  | 'content_gap'
  | 'competitor_gap';

export type KeywordStrategyNextActionType =
  | 'generate_brief'
  | 'optimize_page'
  | 'track_keyword'
  | 'watch'
  | 'review_evidence';

export interface KeywordStrategyNextAction {
  type: KeywordStrategyNextActionType;
  label: string;
  detail: string;
  keyword?: string;
  pagePath?: string;
  targetTab?: string;
}

export interface KeywordStrategyTrackingState {
  status: TrackedKeywordStatus | 'not_tracked';
  source?: TrackedKeywordSource;
  pagePath?: string;
  pageTitle?: string;
  replacedBy?: string;
  deprecatedAt?: string;
  baselinePosition?: number;
  baselineClicks?: number;
  baselineImpressions?: number;
}

export interface KeywordStrategyExplanation {
  keyword: string;
  normalizedKeyword: string;
  role: KeywordStrategyExplanationRole;
  surfaceLabel: string;
  sourceEvidence: string[];
  reasons: string[];
  fitSignals: string[];
  feedbackStatus?: 'approved' | 'declined' | 'requested';
  authorityPosture?: TrackedKeywordAuthorityPosture;
  tracking?: KeywordStrategyTrackingState;
  pagePath?: string;
  pageTitle?: string;
  opportunityScore?: number;
  rawEvidenceOnly?: boolean;
  nextAction: KeywordStrategyNextAction;
  /**
   * Plain-language reasons explaining the keyword's value score (Task 2.3).
   * Populated server-side in buildKeywordStrategyUxPayload when the
   * keyword-value-scoring flag is ON. Absent when the flag is OFF or the
   * keyword has no value signal (signal gate fails).
   * Safe for all tiers (no $ amounts).
   */
  valueReasons?: string[];
}

export interface KeywordStrategyRefreshSummary {
  previousGeneratedAt?: string;
  currentGeneratedAt?: string;
  added: number;
  retained: number;
  reassigned: number;
  deprecated: number;
  replaced: number;
  preserved: number;
  skipped: number;
  newContentGaps: number;
  resolvedContentGaps: number;
}

export interface KeywordStrategyUxPayload {
  refreshSummary?: KeywordStrategyRefreshSummary;
  explanations: KeywordStrategyExplanation[];
  rawEvidenceNote?: string;
}

export interface KeywordStrategyKeywordChange {
  pagePath: string;
  oldKeyword: string;
  newKeyword: string;
}

export interface KeywordStrategyDiff {
  previousGeneratedAt: string;
  currentGeneratedAt: string;
  newKeywords: string[];
  lostKeywords: string[];
  newGaps: string[];
  resolvedGaps: string[];
  keywordChanges: KeywordStrategyKeywordChange[];
  prevSiteKeywordCount: number;
  currSiteKeywordCount: number;
  summary?: KeywordStrategyRefreshSummary;
  explanations?: KeywordStrategyExplanation[];
  rawEvidenceNote?: string;
}
