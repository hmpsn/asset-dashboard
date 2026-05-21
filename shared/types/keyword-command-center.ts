import type {
  TrackedKeyword,
  TrackedKeywordSource,
  TrackedKeywordStatus,
} from './rank-tracking.ts';
import type { KeywordStrategyExplanation } from './keyword-strategy-ux.ts';
import type { LocalSeoKeywordVisibilitySummary } from './local-seo.ts';

export const KEYWORD_COMMAND_CENTER_STATUS = {
  IN_STRATEGY: 'in_strategy',
  TRACKED: 'tracked',
  NEEDS_REVIEW: 'needs_review',
  RAW_EVIDENCE: 'raw_evidence',
  DECLINED: 'declined',
  RETIRED: 'retired',
} as const;

export type KeywordCommandCenterStatus =
  typeof KEYWORD_COMMAND_CENTER_STATUS[keyof typeof KEYWORD_COMMAND_CENTER_STATUS];

export const KEYWORD_COMMAND_CENTER_FILTERS = {
  ALL: 'all',
  IN_STRATEGY: 'in_strategy',
  TRACKED: 'tracked',
  NEEDS_REVIEW: 'needs_review',
  CONTENT: 'content',
  PAGE_ASSIGNED: 'page_assigned',
  RAW_EVIDENCE: 'raw_evidence',
  REQUESTED: 'requested',
  DECLINED: 'declined',
  RETIRED: 'retired',
} as const;

export type KeywordCommandCenterFilter =
  typeof KEYWORD_COMMAND_CENTER_FILTERS[keyof typeof KEYWORD_COMMAND_CENTER_FILTERS];

export const KEYWORD_COMMAND_CENTER_ACTIONS = {
  ADD_TO_STRATEGY: 'add_to_strategy',
  PROMOTE_EVIDENCE: 'promote_evidence',
  TRACK: 'track',
  PAUSE_TRACKING: 'pause_tracking',
  RETIRE: 'retire',
  DECLINE: 'decline',
  RESTORE: 'restore',
} as const;

export type KeywordCommandCenterActionType =
  typeof KEYWORD_COMMAND_CENTER_ACTIONS[keyof typeof KEYWORD_COMMAND_CENTER_ACTIONS];

export type KeywordCommandCenterNextActionType =
  | KeywordCommandCenterActionType
  | 'generate_brief'
  | 'review_page'
  | 'view_rankings';

export interface KeywordCommandCenterSourceLabel {
  kind:
    | 'strategy'
    | 'page_assignment'
    | 'content_gap'
    | 'raw_evidence'
    | 'tracking'
    | 'feedback'
    | 'client_request'
    | 'manual'
    | 'rank_data';
  label: string;
  detail?: string;
}

export interface KeywordCommandCenterMetrics {
  volume?: number;
  difficulty?: number;
  cpc?: number;
  currentPosition?: number;
  clicks?: number;
  impressions?: number;
  ctr?: number;
}

export interface KeywordCommandCenterAssignment {
  pagePath?: string;
  pageTitle?: string;
  role?: 'site_keyword' | 'page_keyword' | 'content_gap' | 'raw_evidence';
}

export interface KeywordCommandCenterFeedbackState {
  status?: 'approved' | 'declined' | 'requested';
  reason?: string;
  source?: string;
  updatedAt?: string;
}

export interface KeywordCommandCenterTrackingState {
  status: TrackedKeywordStatus | 'not_tracked';
  source?: TrackedKeywordSource;
  pinned?: boolean;
  addedAt?: string;
  pagePath?: string;
  pageTitle?: string;
  replacedBy?: string;
  deprecatedAt?: string;
}

export interface KeywordCommandCenterNextAction {
  type: KeywordCommandCenterNextActionType;
  label: string;
  detail: string;
  tone: 'teal' | 'blue' | 'amber' | 'red' | 'zinc';
  keyword: string;
  pagePath?: string;
  targetTab?: string;
  disabled?: boolean;
  disabledReason?: string;
}

export interface KeywordCommandCenterRow {
  keyword: string;
  normalizedKeyword: string;
  lifecycleStatus: KeywordCommandCenterStatus;
  statusLabel: string;
  sourceLabels: KeywordCommandCenterSourceLabel[];
  metrics: KeywordCommandCenterMetrics;
  assignment?: KeywordCommandCenterAssignment;
  feedback?: KeywordCommandCenterFeedbackState;
  tracking: KeywordCommandCenterTrackingState;
  explanation?: KeywordStrategyExplanation;
  localSeo?: LocalSeoKeywordVisibilitySummary;
  nextActions: KeywordCommandCenterNextAction[];
  isProtected: boolean;
  protectionReason?: string;
  rawEvidenceOnly?: boolean;
}

export interface KeywordCommandCenterCounts {
  total: number;
  inStrategy: number;
  tracked: number;
  needsReview: number;
  evidence: number;
  retired: number;
  declined: number;
}

export interface KeywordCommandCenterFilterMeta {
  id: KeywordCommandCenterFilter;
  label: string;
  count: number;
}

export interface KeywordCommandCenterResponse {
  rows: KeywordCommandCenterRow[];
  counts: KeywordCommandCenterCounts;
  filters: KeywordCommandCenterFilterMeta[];
  rawEvidenceTotal: number;
  rawEvidenceReturned: number;
  generatedAt?: string | null;
}

export interface KeywordCommandCenterActionRequest {
  action: KeywordCommandCenterActionType;
  keyword: string;
  pagePath?: string;
  reason?: string;
  force?: boolean;
}

export interface KeywordCommandCenterActionResult {
  ok: true;
  action: KeywordCommandCenterActionType;
  keyword: string;
  protectedKeyword?: boolean;
  message: string;
  trackedKeywords?: TrackedKeyword[];
}
