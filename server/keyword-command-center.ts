import db from './db/index.js';
import { addActivity } from './activity-log.js';
import { broadcastToWorkspace } from './broadcast.js';
import { createStmtCache } from './db/stmt-cache.js';
import { listContentGaps } from './content-gaps.js';
import { listKeywordGaps } from './keyword-gaps.js';
import {
  buildLocalSeoKeywordCandidates,
  buildLocalSeoKeywordVisibilitySummaryByKey,
  buildLocalSeoKeywordVisibilityByKey,
  listLocalSeoMarkets,
  type LocalSeoKeywordCandidate,
} from './local-seo.js';
import { createLogger } from './logger.js';
import { listPageKeywords } from './page-keywords.js';
import {
  getLatestSnapshotRanks,
  getTrackedKeywords,
  updateTrackedKeywords,
  type AddTrackedKeywordOptions,
} from './rank-tracking.js';
import { getWorkspace } from './workspaces.js';
import { invalidateIntelligenceCache } from './workspace-intelligence.js';
import { buildKeywordStrategyUxPayload } from './keyword-strategy-ux.js';
import { WS_EVENTS } from './ws-events.js';
import { keywordComparisonKey } from '../shared/keyword-normalization.js';
import type { KeywordGapItem } from '../shared/types/workspace.js';
import {
  KEYWORD_COMMAND_CENTER_ACTIONS,
  KEYWORD_COMMAND_CENTER_FILTERS,
  KEYWORD_COMMAND_CENTER_LOCAL_LIFECYCLE,
  KEYWORD_COMMAND_CENTER_LOCAL_PRIORITY,
  KEYWORD_COMMAND_CENTER_STATUS,
  type KeywordCommandCenterActionRequest,
  type KeywordCommandCenterActionResult,
  type KeywordCommandCenterAssignment,
  type KeywordCommandCenterCounts,
  type KeywordCommandCenterDetailResponse,
  type KeywordCommandCenterFeedbackState,
  type KeywordCommandCenterFilter,
  type KeywordCommandCenterFilterMeta,
  type KeywordCommandCenterLocalSeoState,
  type KeywordCommandCenterMetrics,
  type KeywordCommandCenterNextAction,
  type KeywordCommandCenterRowsQuery,
  type KeywordCommandCenterRowsResponse,
  type KeywordCommandCenterResponse,
  type KeywordCommandCenterRow,
  type KeywordCommandCenterSort,
  type KeywordCommandCenterSourceLabel,
  type KeywordCommandCenterStatus,
  type KeywordCommandCenterSummaryResponse,
} from '../shared/types/keyword-command-center.js';
import { LOCAL_SEO_MARKET_STATUS, LOCAL_SEO_VISIBILITY_POSTURE, type LocalSeoKeywordVisibilitySummary } from '../shared/types/local-seo.js';
import {
  TRACKED_KEYWORD_SOURCE,
  TRACKED_KEYWORD_STATUS,
  type LatestRank,
  type TrackedKeyword,
} from '../shared/types/rank-tracking.js';
import type { KeywordStrategyExplanation } from '../shared/types/keyword-strategy-ux.js';

const RAW_EVIDENCE_ROW_LIMIT = 75;
const RANK_EVIDENCE_ROW_LIMIT = 50;
const LOCAL_CANDIDATE_ROW_LIMIT = 75;
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

const log = createLogger('keyword-command-center');

const stmts = createStmtCache(() => ({
  feedback: db.prepare<[workspaceId: string]>(
    'SELECT keyword, status, reason, source, updated_at FROM keyword_feedback WHERE workspace_id = ? ORDER BY updated_at DESC',
  ),
  upsertFeedback: db.prepare(`
    INSERT INTO keyword_feedback (workspace_id, keyword, status, reason, source, declined_by)
    VALUES (@workspace_id, @keyword, @status, @reason, @source, @declined_by)
    ON CONFLICT(workspace_id, keyword) DO UPDATE SET
      status = excluded.status,
      reason = excluded.reason,
      source = excluded.source,
      declined_by = excluded.declined_by,
      updated_at = datetime('now')
  `),
  deleteFeedback: db.prepare<[workspaceId: string, keyword: string]>(
    'DELETE FROM keyword_feedback WHERE workspace_id = ? AND keyword = ?',
  ),
}));

interface FeedbackRow {
  keyword: string;
  status: string;
  reason: string | null;
  source: string | null;
  updated_at: string | null;
}

interface DraftRow {
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
  rawEvidenceOnly?: boolean;
}

function addSource(row: DraftRow, source: KeywordCommandCenterSourceLabel): void {
  if (row.sourceLabels.some(existing => existing.kind === source.kind && existing.label === source.label && existing.detail === source.detail)) return;
  row.sourceLabels.push(source);
}

function mergeMetrics(row: DraftRow, metrics: KeywordCommandCenterMetrics): void {
  row.metrics = {
    ...row.metrics,
    ...Object.fromEntries(Object.entries(metrics).filter(([, value]) => value != null)),
  };
}

function readFeedbackRows(workspaceId: string): FeedbackRow[] {
  return stmts().feedback.all(workspaceId) as FeedbackRow[];
}

function readFeedback(workspaceId: string): Map<string, FeedbackRow> {
  const feedback = new Map<string, FeedbackRow>();
  for (const row of readFeedbackRows(workspaceId)) {
    const key = keywordComparisonKey(row.keyword);
    if (!key || feedback.has(key)) continue;
    feedback.set(key, row);
  }
  return feedback;
}

function feedbackState(row: FeedbackRow): KeywordCommandCenterFeedbackState | undefined {
  if (row.status !== 'approved' && row.status !== 'declined' && row.status !== 'requested') return undefined;
  return {
    status: row.status,
    reason: row.reason ?? undefined,
    source: row.source ?? undefined,
    updatedAt: row.updated_at ?? undefined,
  };
}

function ensureRow(rows: Map<string, DraftRow>, keyword: string): DraftRow | null {
  const normalizedKeyword = keywordComparisonKey(keyword);
  if (!normalizedKeyword) return null;
  const existing = rows.get(normalizedKeyword);
  if (existing) return existing;
  const row: DraftRow = {
    keyword: keyword.trim(),
    normalizedKeyword,
    sourceLabels: [],
    metrics: {},
  };
  rows.set(normalizedKeyword, row);
  return row;
}

function assignmentPriority(role: KeywordCommandCenterAssignment['role'] | undefined): number {
  if (role === 'page_keyword') return 4;
  if (role === 'content_gap') return 3;
  if (role === 'site_keyword') return 2;
  if (role === 'raw_evidence') return 1;
  return 0;
}

function setAssignment(row: DraftRow, assignment: KeywordCommandCenterAssignment): void {
  if (assignmentPriority(assignment.role) >= assignmentPriority(row.assignment?.role)) {
    row.assignment = assignment;
  }
}

function sourceFromExplanation(explanation: KeywordStrategyExplanation): KeywordCommandCenterSourceLabel {
  if (explanation.role === 'page_keyword') {
    return { kind: 'page_assignment', label: 'Page assignment', detail: explanation.pageTitle ?? explanation.pagePath };
  }
  if (explanation.role === 'content_gap') {
    return { kind: 'content_gap', label: 'Content opportunity', detail: explanation.nextAction.detail };
  }
  if (explanation.role === 'competitor_gap') {
    return { kind: 'raw_evidence', label: 'Raw provider evidence', detail: explanation.sourceEvidence[0] ?? 'Provider keyword gap' };
  }
  return { kind: 'strategy', label: 'Strategy keyword', detail: explanation.surfaceLabel };
}

function sourceFromKeywordGap(gap: KeywordGapItem): KeywordCommandCenterSourceLabel {
  return {
    kind: 'raw_evidence',
    label: 'Raw provider evidence',
    detail: `${gap.competitorDomain} ranks #${gap.competitorPosition}`,
  };
}

function isInactiveTracking(keyword: TrackedKeyword): boolean {
  return (keyword.status ?? TRACKED_KEYWORD_STATUS.ACTIVE) !== TRACKED_KEYWORD_STATUS.ACTIVE;
}

function protectedReason(keyword: TrackedKeyword | undefined): string | undefined {
  if (!keyword) return undefined;
  if (keyword.pinned) return 'Pinned keyword';
  if (keyword.source === TRACKED_KEYWORD_SOURCE.CLIENT_REQUESTED) return 'Client-requested keyword';
  if (keyword.source === TRACKED_KEYWORD_SOURCE.MANUAL) return 'Manual keyword';
  return undefined;
}

function lifecycleStatus(row: DraftRow): KeywordCommandCenterStatus {
  if (row.feedback?.status === 'declined') return KEYWORD_COMMAND_CENTER_STATUS.DECLINED;
  if (row.tracking && isInactiveTracking(row.tracking)) return KEYWORD_COMMAND_CENTER_STATUS.RETIRED;
  if (row.feedback?.status === 'approved') return KEYWORD_COMMAND_CENTER_STATUS.IN_STRATEGY;
  if (row.feedback?.status === 'requested') return KEYWORD_COMMAND_CENTER_STATUS.NEEDS_REVIEW;
  if (row.explanation && row.explanation.role !== 'competitor_gap') return KEYWORD_COMMAND_CENTER_STATUS.IN_STRATEGY;
  if (row.assignment && row.assignment.role !== 'raw_evidence') return KEYWORD_COMMAND_CENTER_STATUS.IN_STRATEGY;
  if (row.tracking?.source === TRACKED_KEYWORD_SOURCE.STRATEGY_PRIMARY || row.tracking?.source === TRACKED_KEYWORD_SOURCE.STRATEGY_SITE_KEYWORD) {
    return KEYWORD_COMMAND_CENTER_STATUS.IN_STRATEGY;
  }
  if (row.tracking && (row.tracking.status ?? TRACKED_KEYWORD_STATUS.ACTIVE) === TRACKED_KEYWORD_STATUS.ACTIVE) {
    return KEYWORD_COMMAND_CENTER_STATUS.TRACKED;
  }
  if (row.explanation?.rawEvidenceOnly || row.rawEvidenceOnly) return KEYWORD_COMMAND_CENTER_STATUS.RAW_EVIDENCE;
  if (row.rank) return KEYWORD_COMMAND_CENTER_STATUS.NEEDS_REVIEW;
  if (row.localCandidate) return KEYWORD_COMMAND_CENTER_STATUS.NEEDS_REVIEW;
  return KEYWORD_COMMAND_CENTER_STATUS.RAW_EVIDENCE;
}

function statusLabel(status: KeywordCommandCenterStatus): string {
  switch (status) {
    case KEYWORD_COMMAND_CENTER_STATUS.IN_STRATEGY: return 'In Strategy';
    case KEYWORD_COMMAND_CENTER_STATUS.TRACKED: return 'Tracked';
    case KEYWORD_COMMAND_CENTER_STATUS.NEEDS_REVIEW: return 'Needs Review';
    case KEYWORD_COMMAND_CENTER_STATUS.RAW_EVIDENCE: return 'Raw Evidence';
    case KEYWORD_COMMAND_CENTER_STATUS.DECLINED: return 'Declined';
    case KEYWORD_COMMAND_CENTER_STATUS.RETIRED: return 'Retired';
  }
}

function localPriority(
  visibility: LocalSeoKeywordVisibilitySummary | undefined,
  activeMarketCount: number,
): Pick<KeywordCommandCenterLocalSeoState, 'priority' | 'priorityLabel'> {
  if (activeMarketCount === 0) {
    return { priority: KEYWORD_COMMAND_CENTER_LOCAL_PRIORITY.NEEDS_SETUP, priorityLabel: 'Needs setup' };
  }
  if (!visibility) {
    return { priority: KEYWORD_COMMAND_CENTER_LOCAL_PRIORITY.INVESTIGATE, priorityLabel: 'Ready to check' };
  }
  if (visibility.posture === LOCAL_SEO_VISIBILITY_POSTURE.VISIBLE) {
    return { priority: KEYWORD_COMMAND_CENTER_LOCAL_PRIORITY.DEFEND, priorityLabel: 'Defend' };
  }
  if (visibility.posture === LOCAL_SEO_VISIBILITY_POSTURE.POSSIBLE_MATCH || visibility.posture === LOCAL_SEO_VISIBILITY_POSTURE.PROVIDER_DEGRADED) {
    return { priority: KEYWORD_COMMAND_CENTER_LOCAL_PRIORITY.INVESTIGATE, priorityLabel: 'Investigate' };
  }
  if (visibility.posture === LOCAL_SEO_VISIBILITY_POSTURE.LOCAL_PACK_PRESENT) {
    return { priority: KEYWORD_COMMAND_CENTER_LOCAL_PRIORITY.HIGH_OPPORTUNITY, priorityLabel: 'High opportunity' };
  }
  if (visibility.posture === LOCAL_SEO_VISIBILITY_POSTURE.NOT_VISIBLE && visibility.localPackPresent) {
    return { priority: KEYWORD_COMMAND_CENTER_LOCAL_PRIORITY.HIGH_OPPORTUNITY, priorityLabel: 'High opportunity' };
  }
  return { priority: KEYWORD_COMMAND_CENTER_LOCAL_PRIORITY.LOW_PRIORITY, priorityLabel: 'Low priority' };
}

function buildLocalSeoState(
  row: DraftRow,
  status: KeywordCommandCenterStatus,
  visibility: LocalSeoKeywordVisibilitySummary | undefined,
  activeMarketCount: number,
): KeywordCommandCenterLocalSeoState | undefined {
  if (!row.localCandidate && !visibility) return undefined;
  const selected = status === KEYWORD_COMMAND_CENTER_STATUS.IN_STRATEGY
    || status === KEYWORD_COMMAND_CENTER_STATUS.TRACKED
    || row.localCandidate?.selected === true;
  const checked = Boolean(visibility);
  const lifecycle = selected
    ? KEYWORD_COMMAND_CENTER_LOCAL_LIFECYCLE.SELECTED
    : checked
      ? KEYWORD_COMMAND_CENTER_LOCAL_LIFECYCLE.CHECKED
      : row.rawEvidenceOnly
        ? KEYWORD_COMMAND_CENTER_LOCAL_LIFECYCLE.RAW_EVIDENCE
        : row.localCandidate
          ? KEYWORD_COMMAND_CENTER_LOCAL_LIFECYCLE.CANDIDATE
          : KEYWORD_COMMAND_CENTER_LOCAL_LIFECYCLE.NOT_CHECKED;
  const { priority, priorityLabel } = localPriority(visibility, activeMarketCount);
  const lifecycleLabel = lifecycle === KEYWORD_COMMAND_CENTER_LOCAL_LIFECYCLE.SELECTED
    ? checked ? 'Selected · checked' : 'Selected · not checked'
    : lifecycle === KEYWORD_COMMAND_CENTER_LOCAL_LIFECYCLE.CHECKED
      ? 'Checked locally'
      : lifecycle === KEYWORD_COMMAND_CENTER_LOCAL_LIFECYCLE.RAW_EVIDENCE
        ? 'Raw local evidence'
        : lifecycle === KEYWORD_COMMAND_CENTER_LOCAL_LIFECYCLE.CANDIDATE
          ? 'Local candidate'
          : 'Not checked';
  const detail = activeMarketCount === 0
    ? 'Configure a local market before checking this keyword.'
    : visibility?.detail
      ?? row.localCandidate?.detail
      ?? 'Candidate is ready for local-pack visibility checking.';
  return {
    lifecycle,
    lifecycleLabel,
    priority,
    priorityLabel,
    detail,
    checked,
    marketLabel: visibility?.marketLabel,
    sourceLabels: row.localCandidate ? [row.localCandidate.sourceLabel] : ['Stored local visibility'],
    localPackPresent: visibility?.localPackPresent,
    businessMatchConfidence: visibility?.businessMatchConfidence,
    visibility,
  };
}

function buildNextActions(
  row: DraftRow,
  status: KeywordCommandCenterStatus,
  isProtected: boolean,
  protection?: string,
  localSeoState?: KeywordCommandCenterLocalSeoState,
): KeywordCommandCenterNextAction[] {
  const keyword = row.keyword;
  const actions: KeywordCommandCenterNextAction[] = [];
  if (status === KEYWORD_COMMAND_CENTER_STATUS.DECLINED || status === KEYWORD_COMMAND_CENTER_STATUS.RETIRED) {
    actions.push({
      type: KEYWORD_COMMAND_CENTER_ACTIONS.RESTORE,
      label: 'Restore',
      detail: 'Reactivate this keyword in the operating loop without deleting history.',
      tone: 'teal',
      keyword,
    });
    return actions;
  }

  if (localSeoState) {
    actions.push({
      type: 'check_local_visibility',
      label: localSeoState.checked ? 'Refresh local' : 'Check locally',
      detail: 'Run a local-pack visibility refresh for this keyword through the background job system.',
      tone: 'teal',
      keyword,
      disabled: localSeoState.priority === KEYWORD_COMMAND_CENTER_LOCAL_PRIORITY.NEEDS_SETUP,
      disabledReason: localSeoState.priority === KEYWORD_COMMAND_CENTER_LOCAL_PRIORITY.NEEDS_SETUP
        ? 'Configure a local market before checking local visibility.'
        : undefined,
    });
  }

  if (row.feedback?.status === 'requested' || status === KEYWORD_COMMAND_CENTER_STATUS.NEEDS_REVIEW) {
    actions.push({
      type: KEYWORD_COMMAND_CENTER_ACTIONS.ADD_TO_STRATEGY,
      label: 'Add to strategy',
      detail: 'Approve this keyword into the strategy operating loop without publishing anything.',
      tone: 'teal',
      keyword,
    });
  }

  if (!row.tracking || (row.tracking.status ?? TRACKED_KEYWORD_STATUS.ACTIVE) !== TRACKED_KEYWORD_STATUS.ACTIVE) {
    actions.push({
      type: row.rawEvidenceOnly || row.explanation?.rawEvidenceOnly
        ? KEYWORD_COMMAND_CENTER_ACTIONS.PROMOTE_EVIDENCE
        : KEYWORD_COMMAND_CENTER_ACTIONS.TRACK,
      label: row.rawEvidenceOnly || row.explanation?.rawEvidenceOnly ? 'Promote evidence' : 'Track keyword',
      detail: 'Add this keyword to active rank tracking so it can be measured intentionally.',
      tone: 'teal',
      keyword,
    });
  } else {
    actions.push({
      type: 'view_rankings',
      label: 'View rankings',
      detail: 'Open Rank Tracker as the measurement surface for this keyword.',
      tone: 'blue',
      keyword,
      targetTab: 'seo-ranks',
    });
    actions.push({
      type: KEYWORD_COMMAND_CENTER_ACTIONS.PAUSE_TRACKING,
      label: 'Pause tracking',
      detail: 'Hide this keyword from active tracking while preserving rank history.',
      tone: 'amber',
      keyword,
      disabledReason: isProtected ? `${protection} requires confirmation before pausing.` : undefined,
    });
  }

  if (row.explanation?.role === 'content_gap' || row.assignment?.role === 'content_gap') {
    actions.push({
      type: 'generate_brief',
      label: 'Generate brief',
      detail: 'Open the content planning flow with this keyword as context. Nothing is published automatically.',
      tone: 'teal',
      keyword,
      targetTab: 'content-pipeline',
    });
  }
  const pagePath = row.explanation?.role === 'page_keyword' ? row.explanation.pagePath : row.assignment?.role === 'page_keyword' ? row.assignment.pagePath : undefined;
  if (pagePath) {
    actions.push({
      type: 'review_page',
      label: 'Review page',
      detail: 'Open Page Intelligence for the mapped page before making changes.',
      tone: 'teal',
      keyword,
      pagePath,
      targetTab: 'page-intelligence',
    });
  }

  actions.push({
    type: KEYWORD_COMMAND_CENTER_ACTIONS.DECLINE,
    label: 'Decline',
    detail: 'Suppress this keyword from future strategy and recommendation consideration.',
    tone: 'red',
    keyword,
    disabledReason: isProtected ? `${protection} requires confirmation before decline.` : undefined,
  });

  if (row.tracking) {
    actions.push({
      type: KEYWORD_COMMAND_CENTER_ACTIONS.RETIRE,
      label: 'Retire',
      detail: 'Remove from active strategy-owned tracking without deleting rank history.',
      tone: 'red',
      keyword,
      disabledReason: isProtected ? `${protection} requires confirmation before retirement.` : undefined,
    });
  }
  return actions;
}

function sortRows(a: KeywordCommandCenterRow, b: KeywordCommandCenterRow): number {
  const statusOrder: Record<KeywordCommandCenterStatus, number> = {
    [KEYWORD_COMMAND_CENTER_STATUS.IN_STRATEGY]: 0,
    [KEYWORD_COMMAND_CENTER_STATUS.TRACKED]: 1,
    [KEYWORD_COMMAND_CENTER_STATUS.NEEDS_REVIEW]: 2,
    [KEYWORD_COMMAND_CENTER_STATUS.RAW_EVIDENCE]: 3,
    [KEYWORD_COMMAND_CENTER_STATUS.DECLINED]: 4,
    [KEYWORD_COMMAND_CENTER_STATUS.RETIRED]: 5,
  };
  const byStatus = statusOrder[a.lifecycleStatus] - statusOrder[b.lifecycleStatus];
  if (byStatus !== 0) return byStatus;
  const aVolume = a.metrics.volume ?? a.metrics.impressions ?? 0;
  const bVolume = b.metrics.volume ?? b.metrics.impressions ?? 0;
  if (aVolume !== bVolume) return bVolume - aVolume;
  return a.keyword.localeCompare(b.keyword);
}

function sortRowsForQuery(sort: KeywordCommandCenterSort | undefined): (a: KeywordCommandCenterRow, b: KeywordCommandCenterRow) => number {
  if (sort === 'keyword') return (a, b) => a.keyword.localeCompare(b.keyword);
  if (sort === 'demand') {
    return (a, b) => {
      const aDemand = a.metrics.volume ?? a.metrics.impressions ?? 0;
      const bDemand = b.metrics.volume ?? b.metrics.impressions ?? 0;
      if (aDemand !== bDemand) return bDemand - aDemand;
      return sortRows(a, b);
    };
  }
  if (sort === 'rank') {
    return (a, b) => {
      const aRank = a.metrics.currentPosition ?? Number.POSITIVE_INFINITY;
      const bRank = b.metrics.currentPosition ?? Number.POSITIVE_INFINITY;
      if (aRank !== bRank) return aRank - bRank;
      return sortRows(a, b);
    };
  }
  return sortRows;
}

function matchesFilter(row: KeywordCommandCenterRow, filter: KeywordCommandCenterFilter): boolean {
  if (filter === KEYWORD_COMMAND_CENTER_FILTERS.ALL) return true;
  if (filter === KEYWORD_COMMAND_CENTER_FILTERS.CONTENT) return row.assignment?.role === 'content_gap';
  if (filter === KEYWORD_COMMAND_CENTER_FILTERS.PAGE_ASSIGNED) return row.assignment?.role === 'page_keyword';
  if (filter === KEYWORD_COMMAND_CENTER_FILTERS.LOCAL) return Boolean(row.localSeoState);
  if (filter === KEYWORD_COMMAND_CENTER_FILTERS.LOCAL_CANDIDATES) {
    return row.localSeoState?.lifecycle === KEYWORD_COMMAND_CENTER_LOCAL_LIFECYCLE.CANDIDATE;
  }
  if (filter === KEYWORD_COMMAND_CENTER_FILTERS.VISIBLE_LOCALLY) return row.localSeo?.posture === LOCAL_SEO_VISIBILITY_POSTURE.VISIBLE;
  if (filter === KEYWORD_COMMAND_CENTER_FILTERS.POSSIBLE_MATCH) return row.localSeo?.posture === LOCAL_SEO_VISIBILITY_POSTURE.POSSIBLE_MATCH;
  if (filter === KEYWORD_COMMAND_CENTER_FILTERS.NOT_VISIBLE) {
    return row.localSeo?.posture === LOCAL_SEO_VISIBILITY_POSTURE.NOT_VISIBLE
      || row.localSeo?.posture === LOCAL_SEO_VISIBILITY_POSTURE.LOCAL_PACK_PRESENT;
  }
  if (filter === KEYWORD_COMMAND_CENTER_FILTERS.NOT_CHECKED) return Boolean(row.localSeoState && !row.localSeoState.checked);
  if (filter === KEYWORD_COMMAND_CENTER_FILTERS.PROVIDER_DEGRADED) return row.localSeo?.posture === LOCAL_SEO_VISIBILITY_POSTURE.PROVIDER_DEGRADED;
  if (filter === KEYWORD_COMMAND_CENTER_FILTERS.REQUESTED) return row.feedback?.status === 'requested';
  if (filter === KEYWORD_COMMAND_CENTER_FILTERS.TRACKED) return row.tracking.status === TRACKED_KEYWORD_STATUS.ACTIVE;
  return row.lifecycleStatus === filter;
}

function matchesSearch(row: KeywordCommandCenterRow, search: string | undefined): boolean {
  const query = keywordComparisonKey(search ?? '');
  if (!query) return true;
  return row.normalizedKeyword.includes(query)
    || row.assignment?.pagePath?.toLowerCase().includes(query) === true
    || row.assignment?.pageTitle?.toLowerCase().includes(query) === true;
}

function stripLocalSeoVisibility<T extends LocalSeoKeywordVisibilitySummary | undefined>(visibility: T): T {
  if (!visibility) return visibility;
  return {
    ...visibility,
    topCompetitors: undefined,
    markets: visibility.markets.map(market => ({ ...market, topCompetitors: undefined })),
  } as T;
}

function stripRowForList(row: KeywordCommandCenterRow): KeywordCommandCenterRow {
  const localSeo = stripLocalSeoVisibility(row.localSeo);
  return {
    ...row,
    explanation: undefined,
    localSeo,
    localSeoState: row.localSeoState ? {
      ...row.localSeoState,
      visibility: stripLocalSeoVisibility(row.localSeoState.visibility),
    } : undefined,
  };
}

function paginateRows(rows: KeywordCommandCenterRow[], query: KeywordCommandCenterRowsQuery): KeywordCommandCenterRowsResponse['pageInfo'] & { rows: KeywordCommandCenterRow[] } {
  const pageSize = Math.min(Math.max(Number(query.pageSize) || DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
  const totalRows = rows.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const page = Math.min(Math.max(Number(query.page) || 1, 1), totalPages);
  const start = (page - 1) * pageSize;
  return {
    rows: rows.slice(start, start + pageSize),
    page,
    pageSize,
    totalRows,
    totalPages,
    hasNextPage: page < totalPages,
    hasPreviousPage: page > 1,
  };
}

function filterCount(rows: KeywordCommandCenterRow[], filter: KeywordCommandCenterFilter): number {
  if (filter === KEYWORD_COMMAND_CENTER_FILTERS.ALL) return rows.length;
  if (filter === KEYWORD_COMMAND_CENTER_FILTERS.CONTENT) return rows.filter(row => row.assignment?.role === 'content_gap').length;
  if (filter === KEYWORD_COMMAND_CENTER_FILTERS.PAGE_ASSIGNED) return rows.filter(row => row.assignment?.role === 'page_keyword').length;
  if (filter === KEYWORD_COMMAND_CENTER_FILTERS.LOCAL) return rows.filter(row => row.localSeoState).length;
  if (filter === KEYWORD_COMMAND_CENTER_FILTERS.LOCAL_CANDIDATES) {
    return rows.filter(row => row.localSeoState?.lifecycle === KEYWORD_COMMAND_CENTER_LOCAL_LIFECYCLE.CANDIDATE).length;
  }
  if (filter === KEYWORD_COMMAND_CENTER_FILTERS.VISIBLE_LOCALLY) {
    return rows.filter(row => row.localSeo?.posture === LOCAL_SEO_VISIBILITY_POSTURE.VISIBLE).length;
  }
  if (filter === KEYWORD_COMMAND_CENTER_FILTERS.POSSIBLE_MATCH) {
    return rows.filter(row => row.localSeo?.posture === LOCAL_SEO_VISIBILITY_POSTURE.POSSIBLE_MATCH).length;
  }
  if (filter === KEYWORD_COMMAND_CENTER_FILTERS.NOT_VISIBLE) {
    return rows.filter(row =>
      row.localSeo?.posture === LOCAL_SEO_VISIBILITY_POSTURE.NOT_VISIBLE
      || row.localSeo?.posture === LOCAL_SEO_VISIBILITY_POSTURE.LOCAL_PACK_PRESENT,
    ).length;
  }
  if (filter === KEYWORD_COMMAND_CENTER_FILTERS.NOT_CHECKED) return rows.filter(row => row.localSeoState && !row.localSeoState.checked).length;
  if (filter === KEYWORD_COMMAND_CENTER_FILTERS.PROVIDER_DEGRADED) {
    return rows.filter(row => row.localSeo?.posture === LOCAL_SEO_VISIBILITY_POSTURE.PROVIDER_DEGRADED).length;
  }
  if (filter === KEYWORD_COMMAND_CENTER_FILTERS.REQUESTED) return rows.filter(row => row.feedback?.status === 'requested').length;
  if (filter === KEYWORD_COMMAND_CENTER_FILTERS.TRACKED) {
    return rows.filter(row => row.tracking.status === TRACKED_KEYWORD_STATUS.ACTIVE).length;
  }
  return rows.filter(row => row.lifecycleStatus === filter).length;
}

export function filterNeedsLocalCandidates(filter: KeywordCommandCenterFilter | undefined): boolean {
  return filter === KEYWORD_COMMAND_CENTER_FILTERS.LOCAL
    || filter === KEYWORD_COMMAND_CENTER_FILTERS.LOCAL_CANDIDATES
    || filter === KEYWORD_COMMAND_CENTER_FILTERS.NOT_CHECKED;
}

function buildCounts(rows: KeywordCommandCenterRow[]): KeywordCommandCenterCounts {
  return {
    total: rows.length,
    inStrategy: rows.filter(row => row.lifecycleStatus === KEYWORD_COMMAND_CENTER_STATUS.IN_STRATEGY).length,
    tracked: rows.filter(row => row.tracking.status === TRACKED_KEYWORD_STATUS.ACTIVE).length,
    needsReview: rows.filter(row => row.lifecycleStatus === KEYWORD_COMMAND_CENTER_STATUS.NEEDS_REVIEW).length,
    evidence: rows.filter(row => row.lifecycleStatus === KEYWORD_COMMAND_CENTER_STATUS.RAW_EVIDENCE).length,
    local: rows.filter(row => row.localSeoState).length,
    localCandidates: rows.filter(row => row.localSeoState?.lifecycle === KEYWORD_COMMAND_CENTER_LOCAL_LIFECYCLE.CANDIDATE).length,
    retired: rows.filter(row => row.lifecycleStatus === KEYWORD_COMMAND_CENTER_STATUS.RETIRED).length,
    declined: rows.filter(row => row.lifecycleStatus === KEYWORD_COMMAND_CENTER_STATUS.DECLINED).length,
  };
}

function buildFilters(rows: KeywordCommandCenterRow[]): KeywordCommandCenterFilterMeta[] {
  const filters: Array<{ id: KeywordCommandCenterFilter; label: string }> = [
    { id: KEYWORD_COMMAND_CENTER_FILTERS.ALL, label: 'All' },
    { id: KEYWORD_COMMAND_CENTER_FILTERS.IN_STRATEGY, label: 'In Strategy' },
    { id: KEYWORD_COMMAND_CENTER_FILTERS.TRACKED, label: 'Tracked' },
    { id: KEYWORD_COMMAND_CENTER_FILTERS.NEEDS_REVIEW, label: 'Needs Review' },
    { id: KEYWORD_COMMAND_CENTER_FILTERS.CONTENT, label: 'Content' },
    { id: KEYWORD_COMMAND_CENTER_FILTERS.PAGE_ASSIGNED, label: 'Page Assigned' },
    { id: KEYWORD_COMMAND_CENTER_FILTERS.RAW_EVIDENCE, label: 'Raw Evidence' },
    { id: KEYWORD_COMMAND_CENTER_FILTERS.LOCAL, label: 'Local' },
    { id: KEYWORD_COMMAND_CENTER_FILTERS.LOCAL_CANDIDATES, label: 'Local Candidates' },
    { id: KEYWORD_COMMAND_CENTER_FILTERS.VISIBLE_LOCALLY, label: 'Visible Locally' },
    { id: KEYWORD_COMMAND_CENTER_FILTERS.POSSIBLE_MATCH, label: 'Possible Match' },
    { id: KEYWORD_COMMAND_CENTER_FILTERS.NOT_VISIBLE, label: 'Not Visible' },
    { id: KEYWORD_COMMAND_CENTER_FILTERS.NOT_CHECKED, label: 'Not Checked' },
    { id: KEYWORD_COMMAND_CENTER_FILTERS.PROVIDER_DEGRADED, label: 'Provider Degraded' },
    { id: KEYWORD_COMMAND_CENTER_FILTERS.REQUESTED, label: 'Requested' },
    { id: KEYWORD_COMMAND_CENTER_FILTERS.DECLINED, label: 'Declined' },
    { id: KEYWORD_COMMAND_CENTER_FILTERS.RETIRED, label: 'Retired' },
  ];
  return filters.map(filter => ({ ...filter, count: filterCount(rows, filter.id) }));
}

interface SkinnyFilterCounts {
  all: number;
  inStrategy: number;
  tracked: number;
  needsReview: number;
  content: number;
  pageAssigned: number;
  rawEvidence: number;
  local: number;
  localCandidates: number;
  visibleLocally: number;
  possibleMatch: number;
  notVisible: number;
  notChecked: number;
  providerDegraded: number;
  requested: number;
  declined: number;
  retired: number;
}

function buildFilterFacetsFromCounts(counts: SkinnyFilterCounts): KeywordCommandCenterFilterMeta[] {
  return [
    { id: KEYWORD_COMMAND_CENTER_FILTERS.ALL, label: 'All', count: counts.all },
    { id: KEYWORD_COMMAND_CENTER_FILTERS.IN_STRATEGY, label: 'In Strategy', count: counts.inStrategy },
    { id: KEYWORD_COMMAND_CENTER_FILTERS.TRACKED, label: 'Tracked', count: counts.tracked },
    { id: KEYWORD_COMMAND_CENTER_FILTERS.NEEDS_REVIEW, label: 'Needs Review', count: counts.needsReview },
    { id: KEYWORD_COMMAND_CENTER_FILTERS.CONTENT, label: 'Content', count: counts.content },
    { id: KEYWORD_COMMAND_CENTER_FILTERS.PAGE_ASSIGNED, label: 'Page Assigned', count: counts.pageAssigned },
    { id: KEYWORD_COMMAND_CENTER_FILTERS.RAW_EVIDENCE, label: 'Raw Evidence', count: counts.rawEvidence },
    { id: KEYWORD_COMMAND_CENTER_FILTERS.LOCAL, label: 'Local', count: counts.local },
    { id: KEYWORD_COMMAND_CENTER_FILTERS.LOCAL_CANDIDATES, label: 'Local Candidates', count: counts.localCandidates },
    { id: KEYWORD_COMMAND_CENTER_FILTERS.VISIBLE_LOCALLY, label: 'Visible Locally', count: counts.visibleLocally },
    { id: KEYWORD_COMMAND_CENTER_FILTERS.POSSIBLE_MATCH, label: 'Possible Match', count: counts.possibleMatch },
    { id: KEYWORD_COMMAND_CENTER_FILTERS.NOT_VISIBLE, label: 'Not Visible', count: counts.notVisible },
    { id: KEYWORD_COMMAND_CENTER_FILTERS.NOT_CHECKED, label: 'Not Checked', count: counts.notChecked },
    { id: KEYWORD_COMMAND_CENTER_FILTERS.PROVIDER_DEGRADED, label: 'Provider Degraded', count: counts.providerDegraded },
    { id: KEYWORD_COMMAND_CENTER_FILTERS.REQUESTED, label: 'Requested', count: counts.requested },
    { id: KEYWORD_COMMAND_CENTER_FILTERS.DECLINED, label: 'Declined', count: counts.declined },
    { id: KEYWORD_COMMAND_CENTER_FILTERS.RETIRED, label: 'Retired', count: counts.retired },
  ];
}

async function buildKeywordCommandCenterModel(
  workspaceId: string,
  options: {
    includeLocalSeo?: boolean;
    includeLocalSeoDetails?: boolean;
    includeLocalCandidates?: boolean;
    includeStrategyUx?: boolean;
    timingLabel?: string;
  } = {},
): Promise<KeywordCommandCenterResponse | null> {
  const startedAt = Date.now();
  const marks: Record<string, number> = {};
  const heap: Record<string, number> = {};
  const mark = (stage: string) => {
    marks[stage] = Date.now() - startedAt;
    heap[stage.replace(/Ms$/, 'HeapMb')] = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
  };
  const workspace = getWorkspace(workspaceId);
  if (!workspace) return null;

  const strategy = workspace.keywordStrategy;
  const pageMap = listPageKeywords(workspace.id);
  const contentGaps = listContentGaps(workspace.id);
  const keywordGaps = listKeywordGaps(workspace.id);
  const trackedKeywords = getTrackedKeywords(workspace.id, { includeInactive: true });
  const latestRanks = getLatestSnapshotRanks(workspace.id);
  const feedback = readFeedback(workspace.id);
  mark('sourceLoadingMs');
  const localVisibilityByKeyword = options.includeLocalSeo
    ? options.includeLocalSeoDetails
      ? buildLocalSeoKeywordVisibilityByKey(workspace.id)
      : buildLocalSeoKeywordVisibilitySummaryByKey(workspace.id)
    : new Map();
  const localCandidates = options.includeLocalSeo && options.includeLocalCandidates === true
    ? buildLocalSeoKeywordCandidates(workspace.id).slice(0, LOCAL_CANDIDATE_ROW_LIMIT)
    : [];
  const activeLocalMarketCount = options.includeLocalSeo
    ? listLocalSeoMarkets(workspace.id).filter(market => market.status === LOCAL_SEO_MARKET_STATUS.ACTIVE).length
    : 0;
  mark('localSeoMs');
  const rows = new Map<string, DraftRow>();

  for (const metric of strategy?.siteKeywordMetrics ?? []) {
    const row = ensureRow(rows, metric.keyword);
    if (!row) continue;
    setAssignment(row, { role: 'site_keyword' });
    addSource(row, { kind: 'strategy', label: 'Strategy keyword', detail: 'Site keyword' });
    mergeMetrics(row, { volume: metric.volume, difficulty: metric.difficulty });
  }

  for (const keyword of strategy?.siteKeywords ?? []) {
    const row = ensureRow(rows, keyword);
    if (!row) continue;
    setAssignment(row, { role: 'site_keyword' });
    addSource(row, { kind: 'strategy', label: 'Strategy keyword', detail: 'Site keyword' });
  }

  for (const page of pageMap) {
    const pageKeywords = [page.primaryKeyword, ...(page.secondaryKeywords ?? [])].filter(Boolean);
    for (const keyword of pageKeywords) {
      const row = ensureRow(rows, keyword);
      if (!row) continue;
      setAssignment(row, {
        pagePath: page.pagePath,
        pageTitle: page.pageTitle,
        role: 'page_keyword',
      });
      addSource(row, { kind: 'page_assignment', label: 'Page assignment', detail: page.pageTitle ?? page.pagePath });
      mergeMetrics(row, {
        volume: page.volume,
        difficulty: page.difficulty,
      });
    }
  }

  for (const gap of contentGaps) {
    const row = ensureRow(rows, gap.targetKeyword);
    if (!row) continue;
    setAssignment(row, {
      pageTitle: gap.topic,
      role: 'content_gap',
    });
    addSource(row, { kind: 'content_gap', label: 'Content opportunity', detail: gap.topic });
    mergeMetrics(row, {
      volume: gap.volume,
      difficulty: gap.difficulty,
    });
  }

  const strategyUx = options.includeStrategyUx === false
    ? null
    : await buildKeywordStrategyUxPayload({
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      strategy: strategy ?? null,
      pageMap,
      contentGaps,
      keywordGaps,
      surface: 'admin',
      trackedKeywords,
    });
  mark('strategyUxMs');

  for (const explanation of strategyUx?.explanations ?? []) {
    const row = ensureRow(rows, explanation.keyword);
    if (!row) continue;
    row.explanation = explanation;
    row.rawEvidenceOnly = Boolean(explanation.rawEvidenceOnly);
    addSource(row, sourceFromExplanation(explanation));
    mergeMetrics(row, {
      volume: explanation.role === 'content_gap' ? contentGaps.find(gap => keywordComparisonKey(gap.targetKeyword) === explanation.normalizedKeyword)?.volume : undefined,
      difficulty: explanation.role === 'content_gap' ? contentGaps.find(gap => keywordComparisonKey(gap.targetKeyword) === explanation.normalizedKeyword)?.difficulty : undefined,
    });
  }

  for (const gap of keywordGaps) {
    const row = ensureRow(rows, gap.keyword);
    if (!row) continue;
    row.rawEvidenceOnly = row.rawEvidenceOnly ?? !row.explanation;
    addSource(row, sourceFromKeywordGap(gap));
    mergeMetrics(row, {
      volume: gap.volume,
      difficulty: gap.difficulty,
    });
  }

  for (const keyword of trackedKeywords) {
    const row = ensureRow(rows, keyword.query);
    if (!row) continue;
    row.tracking = keyword;
    addSource(row, {
      kind: keyword.source === TRACKED_KEYWORD_SOURCE.MANUAL ? 'manual' : 'tracking',
      label: 'Rank tracking',
      detail: keyword.source?.replace(/_/g, ' '),
    });
    mergeMetrics(row, {
      volume: keyword.volume,
      difficulty: keyword.difficulty,
      cpc: keyword.cpc,
      currentPosition: keyword.baselinePosition,
      clicks: keyword.baselineClicks,
      impressions: keyword.baselineImpressions,
    });
  }

  for (const [normalized, row] of feedback) {
    const draft = ensureRow(rows, row.keyword);
    if (!draft) continue;
    draft.feedback = feedbackState(row);
    addSource(draft, {
      kind: row.status === 'requested' ? 'client_request' : 'feedback',
      label: row.status === 'requested' ? 'Requested keyword' : 'Keyword feedback',
      detail: row.status,
    });
    if (draft.normalizedKeyword !== normalized) rows.set(normalized, draft);
  }

  const rankedUntracked = latestRanks
    .filter(rank => !rows.has(keywordComparisonKey(rank.query)))
    .sort((a, b) => (b.impressions ?? 0) - (a.impressions ?? 0))
    .slice(0, RANK_EVIDENCE_ROW_LIMIT);
  for (const rank of rankedUntracked) {
    const row = ensureRow(rows, rank.query);
    if (!row) continue;
    row.rank = rank;
    addSource(row, { kind: 'rank_data', label: 'Search Console evidence', detail: 'Ranking query not currently selected' });
    mergeMetrics(row, {
      currentPosition: rank.position,
      clicks: rank.clicks,
      impressions: rank.impressions,
      ctr: rank.ctr,
    });
  }

  for (const rank of latestRanks) {
    const row = rows.get(keywordComparisonKey(rank.query));
    if (!row) continue;
    row.rank = rank;
    mergeMetrics(row, {
      currentPosition: rank.position,
      clicks: rank.clicks,
      impressions: rank.impressions,
      ctr: rank.ctr,
    });
  }

  for (const candidate of localCandidates) {
    const row = ensureRow(rows, candidate.keyword);
    if (!row) continue;
    row.localCandidate = candidate;
    addSource(row, {
      kind: 'local_candidate',
      label: candidate.sourceLabel,
      detail: candidate.detail,
    });
    mergeMetrics(row, {
      volume: candidate.volume,
      difficulty: candidate.difficulty,
    });
  }

  const rawEvidenceRows = [...rows.values()].filter(row => row.rawEvidenceOnly && !row.tracking && !row.feedback && !row.localCandidate);
  const allowedRawEvidence = new Set(
    rawEvidenceRows
      .sort((a, b) => (b.metrics.volume ?? 0) - (a.metrics.volume ?? 0))
      .slice(0, RAW_EVIDENCE_ROW_LIMIT)
      .map(row => row.normalizedKeyword),
  );

  const finalRows = [...rows.values()]
    .filter(row => !row.rawEvidenceOnly || row.tracking || row.feedback || row.localCandidate || allowedRawEvidence.has(row.normalizedKeyword))
    .map((row): KeywordCommandCenterRow => {
      const status = lifecycleStatus(row);
      const protection = protectedReason(row.tracking);
      const explanationRole = row.explanation?.role;
      const isProtected = Boolean(protection);
      const localSeo = localVisibilityByKeyword.get(row.normalizedKeyword);
      const localSeoState = buildLocalSeoState(row, status, localSeo, activeLocalMarketCount);
      return {
        keyword: row.keyword,
        normalizedKeyword: row.normalizedKeyword,
        lifecycleStatus: status,
        statusLabel: statusLabel(status),
        sourceLabels: row.sourceLabels,
        metrics: row.metrics,
        assignment: row.explanation ? {
          pagePath: row.explanation.pagePath,
          pageTitle: row.explanation.pageTitle,
          role: explanationRole === 'competitor_gap' ? 'raw_evidence' : explanationRole,
        } : row.assignment ?? (row.localCandidate?.pagePath || row.localCandidate?.pageTitle ? {
          pagePath: row.localCandidate.pagePath,
          pageTitle: row.localCandidate.pageTitle,
          role: row.localCandidate.source === 'content_gap' ? 'content_gap' : 'page_keyword',
        } : undefined),
        feedback: row.feedback,
        tracking: row.tracking ? {
          status: row.tracking.status ?? TRACKED_KEYWORD_STATUS.ACTIVE,
          source: row.tracking.source,
          pinned: row.tracking.pinned,
          addedAt: row.tracking.addedAt,
          pagePath: row.tracking.pagePath,
          pageTitle: row.tracking.pageTitle,
          replacedBy: row.tracking.replacedBy,
          deprecatedAt: row.tracking.deprecatedAt,
        } : { status: 'not_tracked' },
        explanation: row.explanation,
        localSeo,
        localSeoState,
        nextActions: buildNextActions(row, status, isProtected, protection, localSeoState),
        isProtected,
        protectionReason: protection,
        rawEvidenceOnly: row.rawEvidenceOnly,
      };
    })
    .sort(sortRows);
  mark('rowIndexMs');

  log.info({
    workspaceId,
    mode: options.timingLabel ?? 'full',
    rowCount: finalRows.length,
    rawEvidenceTotal: rawEvidenceRows.length,
    rawEvidenceReturned: allowedRawEvidence.size,
    ...marks,
    ...heap,
    totalMs: Date.now() - startedAt,
    finalHeapMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
  }, 'keyword command center read model built');

  return {
    rows: finalRows,
    counts: buildCounts(finalRows),
    filters: buildFilters(finalRows),
    rawEvidenceTotal: rawEvidenceRows.length,
    rawEvidenceReturned: [...allowedRawEvidence].length,
    generatedAt: strategy?.generatedAt ?? null,
  };
}

export async function buildKeywordCommandCenter(
  workspaceId: string,
  options: { includeLocalSeo?: boolean } = {},
): Promise<KeywordCommandCenterResponse | null> {
  return buildKeywordCommandCenterModel(workspaceId, {
    includeLocalSeo: options.includeLocalSeo,
    includeLocalSeoDetails: true,
    includeLocalCandidates: true,
    includeStrategyUx: true,
    timingLabel: 'legacy-full',
  });
}

export async function buildKeywordCommandCenterSummary(
  workspaceId: string,
  options: { includeLocalSeo?: boolean } = {},
): Promise<KeywordCommandCenterSummaryResponse | null> {
  const startedAt = Date.now();
  const workspace = getWorkspace(workspaceId);
  if (!workspace) return null;

  const allKeys = new Set<string>();
  const inStrategyKeys = new Set<string>();
  const pageAssignedKeys = new Set<string>();
  const contentKeys = new Set<string>();
  const rawEvidenceKeys = new Set<string>();
  const addKey = (target: Set<string>, keyword: string | undefined) => {
    const key = keywordComparisonKey(keyword ?? '');
    if (!key) return;
    target.add(key);
    allKeys.add(key);
  };

  for (const metric of workspace.keywordStrategy?.siteKeywordMetrics ?? []) addKey(inStrategyKeys, metric.keyword);
  for (const keyword of workspace.keywordStrategy?.siteKeywords ?? []) addKey(inStrategyKeys, keyword);

  for (const page of listPageKeywords(workspace.id)) {
    addKey(pageAssignedKeys, page.primaryKeyword);
    addKey(inStrategyKeys, page.primaryKeyword);
    for (const secondary of page.secondaryKeywords ?? []) {
      addKey(pageAssignedKeys, secondary);
      addKey(inStrategyKeys, secondary);
    }
  }

  const contentGaps = listContentGaps(workspace.id);
  for (const gap of contentGaps) {
    addKey(contentKeys, gap.targetKeyword);
    addKey(inStrategyKeys, gap.targetKeyword);
  }

  const keywordGaps = listKeywordGaps(workspace.id);
  for (const gap of keywordGaps) addKey(rawEvidenceKeys, gap.keyword);

  const trackedKeywords = getTrackedKeywords(workspace.id, { includeInactive: true });
  for (const tracked of trackedKeywords) addKey(allKeys, tracked.query);
  const trackedKeys = new Set(trackedKeywords.map(keyword => keywordComparisonKey(keyword.query)).filter(Boolean));

  const feedback = readFeedback(workspace.id);
  for (const row of feedback.values()) addKey(allKeys, row.keyword);
  const feedbackKeys = new Set([...feedback.keys()]);

  const latestRanks = getLatestSnapshotRanks(workspace.id);
  const rankEvidenceKeys = new Set<string>();
  for (const rank of latestRanks
    .filter(rank => !allKeys.has(keywordComparisonKey(rank.query)))
    .sort((a, b) => (b.impressions ?? 0) - (a.impressions ?? 0))
    .slice(0, RANK_EVIDENCE_ROW_LIMIT)) {
    addKey(rankEvidenceKeys, rank.query);
  }

  const activeTracked = trackedKeywords.filter(keyword => (keyword.status ?? TRACKED_KEYWORD_STATUS.ACTIVE) === TRACKED_KEYWORD_STATUS.ACTIVE);
  const inactiveTracked = trackedKeywords.filter(keyword => (keyword.status ?? TRACKED_KEYWORD_STATUS.ACTIVE) !== TRACKED_KEYWORD_STATUS.ACTIVE);
  const requested = [...feedback.values()].filter(row => row.status === 'requested');
  const declined = [...feedback.values()].filter(row => row.status === 'declined');
  const rawEvidenceOnlyKeys = new Set(
    [...rawEvidenceKeys].filter(key =>
      !inStrategyKeys.has(key)
      && !trackedKeys.has(key)
      && !feedbackKeys.has(key)
    ),
  );
  const localVisibility = options.includeLocalSeo ? buildLocalSeoKeywordVisibilitySummaryByKey(workspace.id) : new Map();
  for (const key of localVisibility.keys()) allKeys.add(key);
  const localVisibilityValues = [...localVisibility.values()];

  const counts: KeywordCommandCenterCounts = {
    total: allKeys.size,
    inStrategy: inStrategyKeys.size,
    tracked: activeTracked.length,
    needsReview: requested.length + rankEvidenceKeys.size,
    evidence: rawEvidenceOnlyKeys.size,
    local: localVisibility.size,
    localCandidates: 0,
    retired: inactiveTracked.length,
    declined: declined.length,
  };
  const filterCounts: SkinnyFilterCounts = {
    all: counts.total,
    inStrategy: counts.inStrategy,
    tracked: counts.tracked,
    needsReview: counts.needsReview,
    content: contentKeys.size,
    pageAssigned: pageAssignedKeys.size,
    rawEvidence: counts.evidence,
    local: counts.local,
    localCandidates: 0,
    visibleLocally: localVisibilityValues.filter(item => item.posture === LOCAL_SEO_VISIBILITY_POSTURE.VISIBLE).length,
    possibleMatch: localVisibilityValues.filter(item => item.posture === LOCAL_SEO_VISIBILITY_POSTURE.POSSIBLE_MATCH).length,
    notVisible: localVisibilityValues.filter(item =>
      item.posture === LOCAL_SEO_VISIBILITY_POSTURE.NOT_VISIBLE
      || item.posture === LOCAL_SEO_VISIBILITY_POSTURE.LOCAL_PACK_PRESENT,
    ).length,
    notChecked: 0,
    providerDegraded: localVisibilityValues.filter(item => item.posture === LOCAL_SEO_VISIBILITY_POSTURE.PROVIDER_DEGRADED).length,
    requested: requested.length,
    declined: declined.length,
    retired: inactiveTracked.length,
  };

  log.info({
    workspaceId,
    mode: 'summary-skinny',
    totalKeys: counts.total,
    trackedCount: trackedKeywords.length,
    contentGapCount: contentGaps.length,
    keywordGapCount: keywordGaps.length,
    localVisibilityCount: localVisibility.size,
    totalMs: Date.now() - startedAt,
    finalHeapMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
  }, 'keyword command center summary built');

  return {
    counts,
    filters: buildFilterFacetsFromCounts(filterCounts),
    rawEvidenceTotal: rawEvidenceOnlyKeys.size,
    rawEvidenceReturned: Math.min(counts.evidence, RAW_EVIDENCE_ROW_LIMIT),
    generatedAt: workspace.keywordStrategy?.generatedAt ?? null,
    summarizedAt: new Date().toISOString(),
  };
}

export async function buildKeywordCommandCenterRows(
  workspaceId: string,
  query: KeywordCommandCenterRowsQuery = {},
  options: { includeLocalSeo?: boolean } = {},
): Promise<KeywordCommandCenterRowsResponse | null> {
  const filter = query.filter ?? KEYWORD_COMMAND_CENTER_FILTERS.ALL;
  const payload = await buildKeywordCommandCenterModel(workspaceId, {
    includeLocalSeo: options.includeLocalSeo,
    includeLocalSeoDetails: false,
    includeLocalCandidates: filterNeedsLocalCandidates(filter),
    includeStrategyUx: false,
    timingLabel: 'rows',
  });
  if (!payload) return null;
  const filtered = payload.rows
    .filter(row => matchesFilter(row, filter))
    .filter(row => matchesSearch(row, query.search))
    .sort(sortRowsForQuery(query.sort));
  const page = paginateRows(filtered.map(stripRowForList), query);
  return {
    rows: page.rows,
    pageInfo: {
      page: page.page,
      pageSize: page.pageSize,
      totalRows: page.totalRows,
      totalPages: page.totalPages,
      hasNextPage: page.hasNextPage,
      hasPreviousPage: page.hasPreviousPage,
    },
    generatedAt: payload.generatedAt,
  };
}

export async function buildKeywordCommandCenterDetail(
  workspaceId: string,
  keyword: string,
  options: { includeLocalSeo?: boolean } = {},
): Promise<KeywordCommandCenterDetailResponse | null> {
  const normalized = keywordComparisonKey(keyword);
  if (!normalized) return null;
  const payload = await buildKeywordCommandCenterModel(workspaceId, {
    includeLocalSeo: options.includeLocalSeo,
    includeLocalSeoDetails: true,
    includeLocalCandidates: true,
    includeStrategyUx: true,
    timingLabel: 'detail',
  });
  if (!payload) return null;
  const row = payload.rows.find(item => item.normalizedKeyword === normalized);
  if (!row) return null;
  return {
    row,
    generatedAt: payload.generatedAt,
  };
}

function canModifyProtected(keyword: TrackedKeyword | undefined, force?: boolean): { ok: true } | { ok: false; reason: string } {
  const reason = protectedReason(keyword);
  if (!reason || force) return { ok: true };
  return { ok: false, reason: `${reason} requires explicit confirmation before this action.` };
}

function findTracked(workspaceId: string, keyword: string): TrackedKeyword | undefined {
  const normalized = keywordComparisonKey(keyword);
  return getTrackedKeywords(workspaceId, { includeInactive: true }).find(entry => keywordComparisonKey(entry.query) === normalized);
}

function deleteFeedbackByKeywordKey(workspaceId: string, keyword: string): number {
  const normalized = keywordComparisonKey(keyword);
  if (!normalized) return 0;
  let changes = 0;
  for (const row of readFeedbackRows(workspaceId)) {
    if (keywordComparisonKey(row.keyword) !== normalized) continue;
    changes += stmts().deleteFeedback.run(workspaceId, row.keyword).changes;
  }
  return changes;
}

function upsertFeedback(workspaceId: string, keyword: string, status: 'approved' | 'declined' | 'requested', reason?: string): void {
  const normalized = keywordComparisonKey(keyword);
  deleteFeedbackByKeywordKey(workspaceId, normalized);
  stmts().upsertFeedback.run({
    workspace_id: workspaceId,
    keyword: normalized,
    status,
    reason: reason ?? null,
    source: 'command_center',
    declined_by: status === 'declined' ? 'admin' : null,
  });
}

function trackedSourceForMerge(existing: TrackedKeyword, options: AddTrackedKeywordOptions, preferSource: boolean): TrackedKeyword['source'] {
  const existingSource = existing.source ?? TRACKED_KEYWORD_SOURCE.UNKNOWN;
  const existingStatus = existing.status ?? TRACKED_KEYWORD_STATUS.ACTIVE;
  const nextStatus = options.status ?? existingStatus;
  if (protectedReason(existing) && !preferSource) return existingSource;
  if (preferSource && options.source && !protectedReason(existing)) return options.source;
  if (existingStatus !== TRACKED_KEYWORD_STATUS.ACTIVE && nextStatus === TRACKED_KEYWORD_STATUS.ACTIVE) {
    return options.source ?? existingSource;
  }
  if (existingSource === TRACKED_KEYWORD_SOURCE.UNKNOWN) return options.source ?? existingSource;
  return existingSource;
}

function upsertTrackedKeywordByKey(
  workspaceId: string,
  keyword: string,
  options: AddTrackedKeywordOptions,
  opts: { preferSource?: boolean } = {},
): TrackedKeyword[] {
  const normalized = keywordComparisonKey(keyword);
  if (!normalized) return getTrackedKeywords(workspaceId, { includeInactive: true });

  return updateTrackedKeywords(workspaceId, keywords => {
    const equivalents = keywords.filter(entry => keywordComparisonKey(entry.query) === normalized);
    const existing = equivalents[0];
    const now = new Date().toISOString();
    const next = keywords.filter(entry => keywordComparisonKey(entry.query) !== normalized);

    if (existing) {
      const nextStatus = options.status ?? existing.status ?? TRACKED_KEYWORD_STATUS.ACTIVE;
      const definedOptions = Object.fromEntries(
        Object.entries(options).filter(([, value]) => value !== undefined),
      ) as AddTrackedKeywordOptions;
      next.push({
        ...existing,
        ...definedOptions,
        query: existing.query,
        pinned: equivalents.some(entry => entry.pinned) || Boolean(options.pinned),
        addedAt: existing.addedAt || now,
        status: nextStatus,
        source: trackedSourceForMerge(existing, options, Boolean(opts.preferSource)),
        replacedBy: nextStatus === TRACKED_KEYWORD_STATUS.ACTIVE ? undefined : definedOptions.replacedBy ?? existing.replacedBy,
        deprecatedAt: nextStatus === TRACKED_KEYWORD_STATUS.ACTIVE ? undefined : definedOptions.deprecatedAt ?? existing.deprecatedAt,
      });
      return next;
    }

    next.push({
      query: keyword.trim(),
      pinned: Boolean(options.pinned),
      addedAt: now,
      source: options.source ?? TRACKED_KEYWORD_SOURCE.MANUAL,
      status: options.status ?? TRACKED_KEYWORD_STATUS.ACTIVE,
      pagePath: options.pagePath,
      pageTitle: options.pageTitle,
      strategyGeneratedAt: options.strategyGeneratedAt,
      lastStrategySeenAt: options.lastStrategySeenAt,
      intent: options.intent,
      volume: options.volume,
      difficulty: options.difficulty,
      cpc: options.cpc,
      authorityPosture: options.authorityPosture,
      baselinePosition: options.baselinePosition,
      baselineClicks: options.baselineClicks,
      baselineImpressions: options.baselineImpressions,
      replacedBy: options.replacedBy,
      deprecatedAt: options.deprecatedAt,
    });
    return next;
  });
}

function retireTrackedKeyword(workspaceId: string, keyword: string, status: typeof TRACKED_KEYWORD_STATUS.PAUSED | typeof TRACKED_KEYWORD_STATUS.DEPRECATED): TrackedKeyword[] {
  const normalized = keywordComparisonKey(keyword);
  const now = new Date().toISOString();
  return updateTrackedKeywords(workspaceId, keywords => keywords.map(entry => {
    if (keywordComparisonKey(entry.query) !== normalized) return entry;
    return {
      ...entry,
      status,
      deprecatedAt: status === TRACKED_KEYWORD_STATUS.DEPRECATED ? now : entry.deprecatedAt,
    };
  }));
}

export function applyKeywordCommandCenterAction(
  workspaceId: string,
  request: KeywordCommandCenterActionRequest,
): KeywordCommandCenterActionResult {
  const workspace = getWorkspace(workspaceId);
  if (!workspace) throw new Error('Workspace not found');
  const keyword = keywordComparisonKey(request.keyword);
  if (!keyword) throw new Error('keyword required');
  const displayKeyword = request.keyword.trim();

  const existing = findTracked(workspace.id, keyword);
  const protectedCheck = canModifyProtected(existing, request.force);
  const now = new Date().toISOString();
  let trackedKeywords: TrackedKeyword[] | undefined;
  let message = '';

  const run = db.transaction(() => {
    switch (request.action) {
      case KEYWORD_COMMAND_CENTER_ACTIONS.ADD_TO_STRATEGY:
        upsertFeedback(workspace.id, keyword, 'approved', request.reason ?? 'Added to strategy from Keyword Command Center');
        trackedKeywords = upsertTrackedKeywordByKey(workspace.id, displayKeyword, {
          source: TRACKED_KEYWORD_SOURCE.STRATEGY_SITE_KEYWORD,
          status: TRACKED_KEYWORD_STATUS.ACTIVE,
          pagePath: request.pagePath,
        }, { preferSource: true });
        message = `"${keyword}" was added to the strategy operating loop.`;
        break;
      case KEYWORD_COMMAND_CENTER_ACTIONS.PROMOTE_EVIDENCE:
      case KEYWORD_COMMAND_CENTER_ACTIONS.TRACK:
        deleteFeedbackByKeywordKey(workspace.id, keyword);
        trackedKeywords = upsertTrackedKeywordByKey(workspace.id, displayKeyword, {
          source: request.action === KEYWORD_COMMAND_CENTER_ACTIONS.PROMOTE_EVIDENCE
            ? TRACKED_KEYWORD_SOURCE.RECOMMENDATION
            : TRACKED_KEYWORD_SOURCE.MANUAL,
          status: TRACKED_KEYWORD_STATUS.ACTIVE,
          pagePath: request.pagePath,
        });
        message = `"${keyword}" is now active in keyword tracking.`;
        break;
      case KEYWORD_COMMAND_CENTER_ACTIONS.PAUSE_TRACKING:
        if (!existing) throw new Error('Keyword is not tracked');
        if (!protectedCheck.ok) throw new Error(protectedCheck.reason);
        trackedKeywords = retireTrackedKeyword(workspace.id, keyword, TRACKED_KEYWORD_STATUS.PAUSED);
        message = `"${keyword}" was paused from active tracking.`;
        break;
      case KEYWORD_COMMAND_CENTER_ACTIONS.RETIRE:
        if (!existing) throw new Error('Keyword is not tracked');
        if (!protectedCheck.ok) throw new Error(protectedCheck.reason);
        trackedKeywords = retireTrackedKeyword(workspace.id, keyword, TRACKED_KEYWORD_STATUS.DEPRECATED);
        message = `"${keyword}" was retired from active strategy-owned tracking.`;
        break;
      case KEYWORD_COMMAND_CENTER_ACTIONS.DECLINE:
        if (!protectedCheck.ok) throw new Error(protectedCheck.reason);
        upsertFeedback(workspace.id, keyword, 'declined', request.reason ?? 'Declined from Keyword Command Center');
        if (existing && !protectedReason(existing)) {
          trackedKeywords = retireTrackedKeyword(workspace.id, keyword, TRACKED_KEYWORD_STATUS.DEPRECATED);
        }
        message = `"${keyword}" was declined for future strategy consideration.`;
        break;
      case KEYWORD_COMMAND_CENTER_ACTIONS.RESTORE:
        deleteFeedbackByKeywordKey(workspace.id, keyword);
        trackedKeywords = upsertTrackedKeywordByKey(workspace.id, displayKeyword, {
          source: existing?.source ?? TRACKED_KEYWORD_SOURCE.MANUAL,
          status: TRACKED_KEYWORD_STATUS.ACTIVE,
          deprecatedAt: undefined,
          replacedBy: undefined,
        });
        message = `"${keyword}" was restored to the active keyword loop.`;
        break;
    }
  });
  run();

  invalidateIntelligenceCache(workspace.id);
  const payload = { keyword, action: request.action, source: 'keyword_command_center', updatedAt: now };
  if (
    request.action === KEYWORD_COMMAND_CENTER_ACTIONS.ADD_TO_STRATEGY
    || request.action === KEYWORD_COMMAND_CENTER_ACTIONS.DECLINE
    || request.action === KEYWORD_COMMAND_CENTER_ACTIONS.RESTORE
  ) {
    broadcastToWorkspace(workspace.id, WS_EVENTS.STRATEGY_UPDATED, payload);
    broadcastToWorkspace(workspace.id, WS_EVENTS.INTELLIGENCE_SIGNALS_UPDATED, {
      workspaceId: workspace.id,
      reason: 'keyword_command_center',
      updatedAt: now,
    });
  }
  broadcastToWorkspace(workspace.id, WS_EVENTS.RANK_TRACKING_UPDATED, payload);
  addActivity(workspace.id, 'rank_tracking_updated', 'Keyword lifecycle updated', message, {
    keyword,
    action: request.action,
    source: 'keyword_command_center',
  });

  return {
    ok: true,
    action: request.action,
    keyword,
    protectedKeyword: Boolean(protectedReason(existing)),
    message,
    trackedKeywords,
  };
}
