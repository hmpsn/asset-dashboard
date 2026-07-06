import type {
  TrackedKeyword,
  TrackedKeywordSource,
  TrackedKeywordStatus,
} from './rank-tracking.ts';
import type { KeywordStrategyExplanation } from './keyword-strategy-ux.ts';
import type { LocalSeoKeywordVisibilitySummary } from './local-seo.ts';
import type { OutcomeReadback } from './outcome-tracking.ts';

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

export const KEYWORD_LIFECYCLE_STAGES = {
  DISCOVERED: 'discovered',
  TARGETED: 'targeted',
  PUBLISHED: 'published',
  RANKING: 'ranking',
  WINNING: 'winning',
} as const;

export type KeywordLifecycleStage =
  typeof KEYWORD_LIFECYCLE_STAGES[keyof typeof KEYWORD_LIFECYCLE_STAGES];

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
  /**
   * Striking Distance: keywords at positions 11–20 (page 2 of search results).
   * These are the classic agency "easy wins" — one nudge away from page 1.
   * Derived from currentPosition; no new provider calls required.
   */
  STRIKING_DISTANCE: 'striking_distance',
} as const;

export type KeywordCommandCenterFilter =
  typeof KEYWORD_COMMAND_CENTER_FILTERS[keyof typeof KEYWORD_COMMAND_CENTER_FILTERS];

// R5 action catalog: every verb in KEYWORD_COMMAND_CENTER_ACTIONS has a metadata
// entry in the `keyword_command_center` context of shared/types/action-catalog.ts
// (ACTION_CATALOG.keyword_command_center), verified by
// tests/contract/action-catalog.test.ts. This const is the source of truth for
// values — the catalog imports it and never redefines it. See
// docs/rules/action-catalog.md.
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
  /**
   * Raw keyword intent string from any source (trackedKeyword.intent, pageMap.searchIntent, contentGap.intent).
   * Additive metrics metadata, like `cpc`: populated whenever a source carries intent. Feeds the value-first
   * opportunity score (value-first scoring is unconditional).
   */
  intent?: string;
  currentPosition?: number;
  clicks?: number;
  impressions?: number;
  ctr?: number;
  // SEO Decision Engine P6 (national-serp-tracking) — true-SERP detail, additive + optional.
  // Populated from serp_snapshots when the flag is on; undefined = no national snapshot yet.
  // These NEVER override `currentPosition` (GSC average) — `nationalPosition` is a distinct,
  // point-in-time live-SERP rank surfaced alongside it, so the value-score invariant with the
  // candidate/skinny replay path is preserved (currentPosition is the only position that scores).
  /** True point-in-time live advanced-SERP rank (1-based) for the client domain; undefined = not ranking / not tracked. */
  nationalPosition?: number;
  /** Client URL that ranks for this keyword on the live SERP (null/undefined = not ranking). */
  matchedUrl?: string;
  /** SERP feature labels present on the live SERP (e.g. 'ai_overview', 'featured_snippet'). */
  serpFeatures?: string[];
  /** True when the client domain appears in the AI Overview references. Tri-state: undefined = unknown. */
  aiOverviewCited?: boolean;
  /** True when an AI Overview block is present on the SERP at all. Tri-state: undefined = unknown. */
  aiOverviewPresent?: boolean;
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
  lifecycleStage?: KeywordLifecycleStage;
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
  /**
   * Plain-language reasons explaining the keyword's value score (admin-only, Task 2.2).
   * Built in finalizeDraftRow from computeKeywordValueComponents + keywordValueReasons.
   * Absent when the keyword has no value signal (signal gate fails).
   */
  valueReasons?: string[];
  /** 0-100, server-computed; display-only. */
  opportunityScore?: number;
  /**
   * Realized monthly dollar value of the keyword: clicks × cpc (Task 3.3).
   * Built in finalizeDraftRow via the single keywordDollarValue helper (one $
   * definition, identical to roi.ts trafficValue). Absent when metrics.cpc is unknown.
   */
  currentMonthly?: number;
  /**
   * Upside monthly dollar value if the keyword moved up (Task 3.3): impressions ×
   * CTR uplift × cpc, from the same keywordDollarValue helper. Absent when no cpc.
   */
  upsideMonthly?: number;
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
   * Count of keywords at positions 11–20 (page 2). The classic "striking distance"
   * easy-wins list — one nudge away from page 1, value-ranked in the segment view.
   */
  strikingDistance?: number;
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
  /**
   * Monthly organic traffic value from the ROI page-keyword read path.
   * Display-only; null when no page-keyword or legacy page-map source exists.
   */
  trafficValueMonthly?: number | null;
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

export interface KeywordCommandCenterInitialViewResponse {
  summary: KeywordCommandCenterSummaryResponse;
  rows: KeywordCommandCenterRowsResponse;
}

export interface KeywordCommandCenterDetailResponse {
  row: KeywordCommandCenterRow;
  generatedAt?: string | null;
  /**
   * W5.1: read-back outcome verdict for this keyword's tracked action — the latest
   * conclusive measurement (baseline→current position + verdict). Populated by
   * joining the keyword's (pagePath, keyword) tracked action recorded by
   * recordKeywordTrackingAction back to its scored outcome. Absent when no scored
   * action exists yet. Positions are honest (lower=better); trust `direction`.
   */
  outcome?: OutcomeReadback;
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
