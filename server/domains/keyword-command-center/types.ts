import type { LocalSeoKeywordCandidate } from '../local-seo/types.js';
import type { ScoringContext } from '../../scoring/keyword-value-score.js';
import type { ContentGap, KeywordGapItem, KeywordStrategy, PageKeywordMap } from '../../../shared/types/workspace.js';
import type {
  KeywordCommandCenterAssignment,
  KeywordCommandCenterFeedbackState,
  KeywordCommandCenterMetrics,
  KeywordCommandCenterSourceLabel,
} from '../../../shared/types/keyword-command-center.js';
import type { LocalSeoKeywordVisibilitySummary } from '../../../shared/types/local-seo.js';
import type { LatestRank, TrackedKeyword } from '../../../shared/types/rank-tracking.js';
import type { KeywordStrategyExplanation } from '../../../shared/types/keyword-strategy-ux.js';
import type { KeywordFeedbackInternalRow } from '../../keyword-feedback.js';

export type FeedbackRow = KeywordFeedbackInternalRow;

export interface DraftRow {
  keyword: string;
  normalizedKeyword: string;
  sourceLabels: KeywordCommandCenterSourceLabel[];
  metrics: KeywordCommandCenterMetrics;
  assignment?: KeywordCommandCenterAssignment;
  feedback?: KeywordCommandCenterFeedbackState;
  tracking?: TrackedKeyword;
  explanation?: KeywordStrategyExplanation;
  localCandidate?: LocalSeoKeywordCandidate;
  rank?: LatestRank;
  variants?: LatestRank[];
  rawEvidenceOnly?: boolean;
}

export interface LostVisibilityQuery {
  query: string;
  lastPosition: number | null;
  lastSeen: string;
  totalImpressions: number;
}

export interface CommandCenterSourceBundle {
  workspaceId: string;
  workspaceName?: string;
  strategy?: KeywordStrategy | null;
  pageMap: PageKeywordMap[];
  contentGaps: ContentGap[];
  keywordGaps: KeywordGapItem[];
  trackedKeywords: TrackedKeyword[];
  latestRanks: LatestRank[];
  feedback: Map<string, FeedbackRow>;
  localCandidates?: LocalSeoKeywordCandidate[];
  lostVisibilityRows?: LostVisibilityQuery[];
  includeStrategyUx?: boolean;
  includeWorkspaceIntelligence?: boolean;
}

export interface ValueScoringConfig {
  on: boolean;
  ctx?: ScoringContext;
}

export interface RowFinalizeContext {
  workspaceId: string;
  localVisibilityByKeyword: Map<string, LocalSeoKeywordVisibilitySummary>;
  activeLocalMarketCount: number;
  lostVisibilityKeys?: Set<string>;
  /** Phase 1: when present + on, finalize computes the row valueScore once per key. */
  valueScoring?: ValueScoringConfig;
  publishedPagePaths?: Set<string>;
}

export interface FinalizedRows {
  rows: import('../../../shared/types/keyword-command-center.js').KeywordCommandCenterRow[];
  rawEvidenceTotal: number;
  rawEvidenceReturned: number;
}
