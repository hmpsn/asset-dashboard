import db from './db/index.js';
import { addActivity } from './activity-log.js';
import { broadcastToWorkspace } from './broadcast.js';
import { createStmtCache } from './db/stmt-cache.js';
import { listContentGaps } from './content-gaps.js';
import { listKeywordGaps } from './keyword-gaps.js';
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
import {
  KEYWORD_COMMAND_CENTER_ACTIONS,
  KEYWORD_COMMAND_CENTER_FILTERS,
  KEYWORD_COMMAND_CENTER_STATUS,
  type KeywordCommandCenterActionRequest,
  type KeywordCommandCenterActionResult,
  type KeywordCommandCenterCounts,
  type KeywordCommandCenterFeedbackState,
  type KeywordCommandCenterFilter,
  type KeywordCommandCenterFilterMeta,
  type KeywordCommandCenterMetrics,
  type KeywordCommandCenterNextAction,
  type KeywordCommandCenterResponse,
  type KeywordCommandCenterRow,
  type KeywordCommandCenterSourceLabel,
  type KeywordCommandCenterStatus,
} from '../shared/types/keyword-command-center.js';
import {
  TRACKED_KEYWORD_SOURCE,
  TRACKED_KEYWORD_STATUS,
  type LatestRank,
  type TrackedKeyword,
} from '../shared/types/rank-tracking.js';
import type { KeywordStrategyExplanation } from '../shared/types/keyword-strategy-ux.js';

const RAW_EVIDENCE_ROW_LIMIT = 75;
const RANK_EVIDENCE_ROW_LIMIT = 50;

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
  feedback?: KeywordCommandCenterFeedbackState;
  tracking?: TrackedKeyword;
  explanation?: KeywordStrategyExplanation;
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
  if (row.explanation?.rawEvidenceOnly || row.rawEvidenceOnly) return KEYWORD_COMMAND_CENTER_STATUS.RAW_EVIDENCE;
  if (row.explanation && row.explanation.role !== 'competitor_gap') return KEYWORD_COMMAND_CENTER_STATUS.IN_STRATEGY;
  if (row.tracking?.source === TRACKED_KEYWORD_SOURCE.STRATEGY_PRIMARY || row.tracking?.source === TRACKED_KEYWORD_SOURCE.STRATEGY_SITE_KEYWORD) {
    return KEYWORD_COMMAND_CENTER_STATUS.IN_STRATEGY;
  }
  if (row.tracking && (row.tracking.status ?? TRACKED_KEYWORD_STATUS.ACTIVE) === TRACKED_KEYWORD_STATUS.ACTIVE) {
    return KEYWORD_COMMAND_CENTER_STATUS.TRACKED;
  }
  if (row.rank) return KEYWORD_COMMAND_CENTER_STATUS.NEEDS_REVIEW;
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

function buildNextActions(row: DraftRow, status: KeywordCommandCenterStatus, isProtected: boolean, protection?: string): KeywordCommandCenterNextAction[] {
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
      disabled: isProtected,
      disabledReason: isProtected ? `${protection} is protected from one-click pause.` : undefined,
    });
  }

  if (row.explanation?.role === 'content_gap') {
    actions.push({
      type: 'generate_brief',
      label: 'Generate brief',
      detail: 'Open the content planning flow with this keyword as context. Nothing is published automatically.',
      tone: 'teal',
      keyword,
      targetTab: 'content-pipeline',
    });
  }
  if (row.explanation?.role === 'page_keyword' && row.explanation.pagePath) {
    actions.push({
      type: 'review_page',
      label: 'Review page',
      detail: 'Open Page Intelligence for the mapped page before making changes.',
      tone: 'teal',
      keyword,
      pagePath: row.explanation.pagePath,
      targetTab: 'page-intelligence',
    });
  }

  actions.push({
    type: KEYWORD_COMMAND_CENTER_ACTIONS.DECLINE,
    label: 'Decline',
    detail: 'Suppress this keyword from future strategy and recommendation consideration.',
    tone: 'red',
    keyword,
    disabled: isProtected,
    disabledReason: isProtected ? `${protection} is protected from one-click decline.` : undefined,
  });

  if (row.tracking) {
    actions.push({
      type: KEYWORD_COMMAND_CENTER_ACTIONS.RETIRE,
      label: 'Retire',
      detail: 'Remove from active strategy-owned tracking without deleting rank history.',
      tone: 'red',
      keyword,
      disabled: isProtected,
      disabledReason: isProtected ? `${protection} is protected from one-click retirement.` : undefined,
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

function filterCount(rows: KeywordCommandCenterRow[], filter: KeywordCommandCenterFilter): number {
  if (filter === KEYWORD_COMMAND_CENTER_FILTERS.ALL) return rows.length;
  if (filter === KEYWORD_COMMAND_CENTER_FILTERS.CONTENT) return rows.filter(row => row.assignment?.role === 'content_gap').length;
  if (filter === KEYWORD_COMMAND_CENTER_FILTERS.PAGE_ASSIGNED) return rows.filter(row => row.assignment?.role === 'page_keyword').length;
  if (filter === KEYWORD_COMMAND_CENTER_FILTERS.REQUESTED) return rows.filter(row => row.feedback?.status === 'requested').length;
  if (filter === KEYWORD_COMMAND_CENTER_FILTERS.TRACKED) {
    return rows.filter(row => row.tracking.status === TRACKED_KEYWORD_STATUS.ACTIVE).length;
  }
  return rows.filter(row => row.lifecycleStatus === filter).length;
}

function buildCounts(rows: KeywordCommandCenterRow[]): KeywordCommandCenterCounts {
  return {
    total: rows.length,
    inStrategy: rows.filter(row => row.lifecycleStatus === KEYWORD_COMMAND_CENTER_STATUS.IN_STRATEGY).length,
    tracked: rows.filter(row => row.tracking.status === TRACKED_KEYWORD_STATUS.ACTIVE).length,
    needsReview: rows.filter(row => row.lifecycleStatus === KEYWORD_COMMAND_CENTER_STATUS.NEEDS_REVIEW).length,
    evidence: rows.filter(row => row.lifecycleStatus === KEYWORD_COMMAND_CENTER_STATUS.RAW_EVIDENCE).length,
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
    { id: KEYWORD_COMMAND_CENTER_FILTERS.REQUESTED, label: 'Requested' },
    { id: KEYWORD_COMMAND_CENTER_FILTERS.DECLINED, label: 'Declined' },
    { id: KEYWORD_COMMAND_CENTER_FILTERS.RETIRED, label: 'Retired' },
  ];
  return filters.map(filter => ({ ...filter, count: filterCount(rows, filter.id) }));
}

export async function buildKeywordCommandCenter(workspaceId: string): Promise<KeywordCommandCenterResponse | null> {
  const workspace = getWorkspace(workspaceId);
  if (!workspace) return null;

  const strategy = workspace.keywordStrategy;
  const pageMap = listPageKeywords(workspace.id);
  const contentGaps = listContentGaps(workspace.id);
  const keywordGaps = listKeywordGaps(workspace.id);
  const trackedKeywords = getTrackedKeywords(workspace.id, { includeInactive: true });
  const latestRanks = getLatestSnapshotRanks(workspace.id);
  const feedback = readFeedback(workspace.id);
  const rows = new Map<string, DraftRow>();

  const strategyUx = await buildKeywordStrategyUxPayload({
    workspaceId: workspace.id,
    workspaceName: workspace.name,
    strategy: strategy ?? null,
    pageMap,
    contentGaps,
    keywordGaps,
    surface: 'admin',
    trackedKeywords,
  });

  for (const explanation of strategyUx.explanations) {
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

  const rawEvidenceRows = [...rows.values()].filter(row => row.rawEvidenceOnly && !row.tracking && !row.feedback);
  const allowedRawEvidence = new Set(
    rawEvidenceRows
      .sort((a, b) => (b.metrics.volume ?? 0) - (a.metrics.volume ?? 0))
      .slice(0, RAW_EVIDENCE_ROW_LIMIT)
      .map(row => row.normalizedKeyword),
  );

  const finalRows = [...rows.values()]
    .filter(row => !row.rawEvidenceOnly || row.tracking || row.feedback || allowedRawEvidence.has(row.normalizedKeyword))
    .map((row): KeywordCommandCenterRow => {
      const status = lifecycleStatus(row);
      const protection = protectedReason(row.tracking);
      const explanationRole = row.explanation?.role;
      const isProtected = Boolean(protection);
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
        } : undefined,
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
        nextActions: buildNextActions(row, status, isProtected, protection),
        isProtected,
        protectionReason: protection,
        rawEvidenceOnly: row.rawEvidenceOnly,
      };
    })
    .sort(sortRows);

  return {
    rows: finalRows,
    counts: buildCounts(finalRows),
    filters: buildFilters(finalRows),
    rawEvidenceTotal: rawEvidenceRows.length,
    rawEvidenceReturned: [...allowedRawEvidence].length,
    generatedAt: strategy?.generatedAt ?? null,
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
        query: normalized,
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
      query: normalized,
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

  const existing = findTracked(workspace.id, keyword);
  const protectedCheck = canModifyProtected(existing, request.force);
  const now = new Date().toISOString();
  let trackedKeywords: TrackedKeyword[] | undefined;
  let message = '';

  const run = db.transaction(() => {
    switch (request.action) {
      case KEYWORD_COMMAND_CENTER_ACTIONS.ADD_TO_STRATEGY:
        upsertFeedback(workspace.id, keyword, 'approved', request.reason ?? 'Added to strategy from Keyword Command Center');
        trackedKeywords = upsertTrackedKeywordByKey(workspace.id, keyword, {
          source: TRACKED_KEYWORD_SOURCE.STRATEGY_SITE_KEYWORD,
          status: TRACKED_KEYWORD_STATUS.ACTIVE,
          pagePath: request.pagePath,
        }, { preferSource: true });
        message = `"${keyword}" was added to the strategy operating loop.`;
        break;
      case KEYWORD_COMMAND_CENTER_ACTIONS.PROMOTE_EVIDENCE:
      case KEYWORD_COMMAND_CENTER_ACTIONS.TRACK:
        deleteFeedbackByKeywordKey(workspace.id, keyword);
        trackedKeywords = upsertTrackedKeywordByKey(workspace.id, keyword, {
          source: request.action === KEYWORD_COMMAND_CENTER_ACTIONS.PROMOTE_EVIDENCE
            ? TRACKED_KEYWORD_SOURCE.RECOMMENDATION
            : TRACKED_KEYWORD_SOURCE.MANUAL,
          status: TRACKED_KEYWORD_STATUS.ACTIVE,
          pagePath: request.pagePath,
        });
        message = `"${keyword}" is now active in keyword tracking.`;
        break;
      case KEYWORD_COMMAND_CENTER_ACTIONS.PAUSE_TRACKING:
        if (!protectedCheck.ok) throw new Error(protectedCheck.reason);
        trackedKeywords = retireTrackedKeyword(workspace.id, keyword, TRACKED_KEYWORD_STATUS.PAUSED);
        message = `"${keyword}" was paused from active tracking.`;
        break;
      case KEYWORD_COMMAND_CENTER_ACTIONS.RETIRE:
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
        trackedKeywords = upsertTrackedKeywordByKey(workspace.id, keyword, {
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
