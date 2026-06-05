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
  LOCAL: 'local',
  LOCAL_CANDIDATES: 'local_candidates',
  VISIBLE_LOCALLY: 'visible_locally',
  POSSIBLE_MATCH: 'possible_match',
  NOT_VISIBLE: 'not_visible',
  NOT_CHECKED: 'not_checked',
  PROVIDER_DEGRADED: 'provider_degraded',
  REQUESTED: 'requested',
  DECLINED: 'declined',
  RETIRED: 'retired',
  LOST_VISIBILITY: 'lost_visibility',
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

export const KEYWORD_COMMAND_CENTER_LOCAL_LIFECYCLE = {
  SELECTED: 'selected',
  CANDIDATE: 'candidate',
  CHECKED: 'checked',
  RAW_EVIDENCE: 'raw_evidence',
  NOT_CHECKED: 'not_checked',
} as const;

export type KeywordCommandCenterLocalLifecycle =
  typeof KEYWORD_COMMAND_CENTER_LOCAL_LIFECYCLE[keyof typeof KEYWORD_COMMAND_CENTER_LOCAL_LIFECYCLE];

export const KEYWORD_COMMAND_CENTER_LOCAL_PRIORITY = {
  HIGH_OPPORTUNITY: 'high_opportunity',
  DEFEND: 'defend',
  INVESTIGATE: 'investigate',
  LOW_PRIORITY: 'low_priority',
  NEEDS_SETUP: 'needs_setup',
} as const;

export type KeywordCommandCenterLocalPriority =
  typeof KEYWORD_COMMAND_CENTER_LOCAL_PRIORITY[keyof typeof KEYWORD_COMMAND_CENTER_LOCAL_PRIORITY];

export type KeywordCommandCenterNextActionType =
  | KeywordCommandCenterActionType
  | 'generate_brief'
  | 'review_page'
  | 'view_rankings'
  | 'check_local_visibility';

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
    | 'rank_data'
    | 'local_candidate'
    | 'local_visibility';
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
  /**
   * Wave 3d-i ADDITIVE provenance pointer (admin-only). The content-addressed gap
   * key the keyword was approved from (content_gap / keyword_gap surface). Sourced
   * from the provenance-bearing read (listTrackedKeywordRows), NOT getTrackedKeywords
   * (which strips provenance). Undefined when the keyword has no gap provenance.
   */
  sourceGapKey?: string;
  /**
   * Wave 4 P0 ADDITIVE ownership flag (admin-only). True when reconcile owns this
   * keyword (`strategy_owned = 1`) — i.e. it is part of the active managed strategy
   * set. Sourced from the provenance-bearing read (mergeTrackedKeywordProvenance →
   * listTrackedKeywordRows), NOT getTrackedKeywords / the public endpoint (both STRIP
   * it via `delete out.strategyOwned`). THREE-STATE: `true` = explicitly owned,
   * `false` = explicitly not owned, `undefined` = ownership unknown (pre-reconcile).
   * A truthiness / `?? false` guard is a bug — coercing `undefined`→`false` would
   * mislabel every pre-reconcile row as "explicitly not owned".
   */
  strategyOwned?: boolean;
  /**
   * True when the row has any rank/clicks/impressions data, false when the keyword
   * is `active` (or paused) but no rank snapshot or GSC signal has materialized.
   *
   * `undefined` for `not_tracked` rows (signal is irrelevant when not tracking).
   *
   * Set in `finalizeDraftRow` based on `row.metrics.currentPosition` / `clicks` /
   * `impressions`. Used by the UI to show an "Awaiting data" sub-state distinct
   * from genuine active-with-signal tracking.
   */
  hasSignal?: boolean;
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


export interface KeywordCommandCenterLocalSeoState {
  lifecycle: KeywordCommandCenterLocalLifecycle;
  lifecycleLabel: string;
  priority: KeywordCommandCenterLocalPriority;
  priorityLabel: string;
  detail: string;
  checked: boolean;
  marketLabel?: string;
  sourceLabels: string[];
  localPackPresent?: boolean;
  businessMatchConfidence?: LocalSeoKeywordVisibilitySummary['businessMatchConfidence'];
  visibility?: LocalSeoKeywordVisibilitySummary;
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
  localSeoState?: KeywordCommandCenterLocalSeoState;
  nextActions: KeywordCommandCenterNextAction[];
  isProtected: boolean;
  protectionReason?: string;
  rawEvidenceOnly?: boolean;
  /** Number of GSC query variants aggregated onto this row. */
  variantCount?: number;
  /** Aggregated GSC query variants (populated when variantCount > 0). */
  variants?: Array<{
    query: string;
    position: number;
    clicks: number;
    impressions: number;
    ctr: number;
  }>;
  /** True if this keyword has lost GSC visibility for 14+ days (quality-gated). */
  isLostVisibility?: boolean;
}

export interface KeywordCommandCenterCounts {
  total: number;
  inStrategy: number;
  tracked: number;
  needsReview: number;
  evidence: number;
  local: number;
  localCandidates: number;
  retired: number;
  declined: number;
  /**
   * Count of keywords across the universe that have no provider volume data
   * attached. Surfaced as a diagnostic in the panel header so admins can tell
   * whether a "—" volume value is normal or signals a provider-refresh need.
   * Always defined when summary is computed; may be 0.
   */
  missingVolume?: number;
  /**
   * Count of keywords that have lost GSC visibility (status = 'lost_visibility' in
   * discovered_queries). Only populated when the discovered_queries table has data.
   */
  lostVisibility?: number;
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

export type KeywordCommandCenterSort = 'priority' | 'keyword' | 'demand' | 'rank' | 'clicks' | 'difficulty' | 'opportunity';

export interface KeywordCommandCenterSummaryResponse {
  counts: KeywordCommandCenterCounts;
  filters: KeywordCommandCenterFilterMeta[];
  rawEvidenceTotal: number;
  rawEvidenceReturned: number;
  generatedAt?: string | null;
  summarizedAt: string;
  geoLabel?: string;
}

export interface KeywordCommandCenterRowsQuery {
  filter?: KeywordCommandCenterFilter;
  search?: string;
  sort?: KeywordCommandCenterSort;
  /** Sort direction. Absent → each sort's natural default (demand/clicks/difficulty desc, rank/keyword asc). */
  direction?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

export interface KeywordCommandCenterPageInfo {
  page: number;
  pageSize: number;
  totalRows: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export interface KeywordCommandCenterRowsResponse {
  rows: KeywordCommandCenterRow[];
  pageInfo: KeywordCommandCenterPageInfo;
  generatedAt?: string | null;
}

export interface KeywordCommandCenterDetailResponse {
  row: KeywordCommandCenterRow;
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

/**
 * Action types that are eligible for bulk application. Navigation-only and
 * per-row assist actions are deliberately excluded from the bulk lifecycle path.
 */
export const KEYWORD_COMMAND_CENTER_BULK_ACTIONS = [
  KEYWORD_COMMAND_CENTER_ACTIONS.ADD_TO_STRATEGY,
  KEYWORD_COMMAND_CENTER_ACTIONS.TRACK,
  KEYWORD_COMMAND_CENTER_ACTIONS.PAUSE_TRACKING,
  KEYWORD_COMMAND_CENTER_ACTIONS.RETIRE,
  KEYWORD_COMMAND_CENTER_ACTIONS.DECLINE,
] as const;

export type KeywordCommandCenterBulkActionType =
  typeof KEYWORD_COMMAND_CENTER_BULK_ACTIONS[number];

/** Wire format for POST /api/webflow/keyword-command-center/:workspaceId/actions/bulk */
export interface KeywordCommandCenterBulkActionRequest {
  action: KeywordCommandCenterBulkActionType;
  /** 1..50 unique keyword strings. */
  keywords: string[];
  /** Applied to all keywords in the batch. */
  reason?: string;
  /** Bypasses protected-keyword confirmation guards when true. */
  force?: boolean;
}

export interface KeywordCommandCenterBulkActionItem {
  keyword: string;
  /**
   * - applied: the action mutated the keyword.
   * - skipped_protected: a protected keyword that needs explicit confirmation.
   * - skipped_not_tracked: the action requires a tracked row and there was none.
   * - skipped_noop: the keyword is already in (or cannot leave) the target state —
   *   an idempotent self-transition (e.g. retire an already-retired keyword in a
   *   bulk selection). A benign no-op, NOT a failure; counts toward `skipped`.
   * - error: an unexpected failure.
   */
  status: 'applied' | 'skipped_protected' | 'skipped_not_tracked' | 'skipped_noop' | 'error';
  error?: string;
}

export interface KeywordCommandCenterBulkActionResult {
  action: KeywordCommandCenterBulkActionType;
  applied: number;
  skipped: number;
  failed: number;
  items: KeywordCommandCenterBulkActionItem[];
  message: string;
}
