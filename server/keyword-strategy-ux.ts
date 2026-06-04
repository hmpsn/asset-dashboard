import db from './db/index.js';
import { parseJsonSafe, parseJsonSafeArray } from './db/json-validation.js';
import { strategyHistoryStrategySchema, strategyHistoryPageMapSchema, type StrategyHistoryStrategy } from './schemas/workspace-schemas.js';
import { createStmtCache } from './db/stmt-cache.js';
import { createLogger } from './logger.js';
import { getDeclinedKeywords, getRequestedKeywords } from './keyword-feedback.js';
import { buildStrategyKeywordEvaluationContext } from './keyword-strategy-context.js';
import { evaluateKeywordCandidate, normalizeKeyword } from './keyword-intelligence/rules.js';
import { getTrackedKeywords } from './rank-tracking.js';
import { compactStrings } from './utils/collections.js';
import { buildWorkspaceIntelligence } from './workspace-intelligence.js';
import {
  TRACKED_KEYWORD_SOURCE,
  TRACKED_KEYWORD_STATUS,
  type TrackedKeyword,
} from '../shared/types/rank-tracking.js';
import type {
  ContentGap,
  KeywordGapItem,
  KeywordStrategy,
  PageKeywordMap,
} from '../shared/types/workspace.js';
import type {
  KeywordStrategyDiff,
  KeywordStrategyExplanation,
  KeywordStrategyExplanationRole,
  KeywordStrategyNextAction,
  KeywordStrategyRefreshSummary,
  KeywordStrategyUxPayload,
  KeywordStrategyUxSurface,
} from '../shared/types/keyword-strategy-ux.js';

const log = createLogger('keyword-strategy-ux');

const RAW_EVIDENCE_NOTE = 'Raw provider evidence is useful context, but it is filtered separately before a keyword becomes a selected strategy action.';

// Typed empty fallback for parseJsonSafe so a missing/malformed strategy_history
// blob degrades to {} while keeping the schema's optional fields visible to TS.
const EMPTY_STRATEGY_HISTORY: StrategyHistoryStrategy = {};

const stmts = createStmtCache(() => ({
  feedback: db.prepare<[workspaceId: string]>(
    'SELECT keyword, status FROM keyword_feedback WHERE workspace_id = ?',
  ),
  latestHistory: db.prepare<[workspaceId: string]>(
    'SELECT strategy_json, page_map_json, generated_at FROM strategy_history WHERE workspace_id = ? ORDER BY generated_at DESC LIMIT 1',
  ),
}));

interface FeedbackRow {
  keyword: string;
  status: 'approved' | 'declined' | 'requested' | string;
}

interface StrategyHistoryRow {
  strategy_json: string;
  page_map_json: string;
  generated_at: string;
}

interface BuildKeywordStrategyUxOptions {
  workspaceId: string;
  workspaceName?: string;
  strategy?: KeywordStrategy | null;
  pageMap: PageKeywordMap[];
  contentGaps: ContentGap[];
  keywordGaps: KeywordGapItem[];
  surface?: KeywordStrategyUxSurface;
  summary?: KeywordStrategyRefreshSummary;
  includeWorkspaceIntelligence?: boolean;
  trackedKeywords?: TrackedKeyword[];
}

interface BuildSummaryOptions {
  previousGeneratedAt?: string;
  currentGeneratedAt?: string;
  previousSiteKeywords?: string[];
  currentSiteKeywords?: string[];
  previousContentGapKeywords?: string[];
  currentContentGapKeywords?: string[];
  previousPageMap?: Array<{ pagePath: string; primaryKeyword: string }>;
  currentPageMap?: Array<{ pagePath: string; primaryKeyword: string }>;
  trackedKeywords?: TrackedKeyword[];
  skipped?: number;
}

function uniq(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function feedbackMap(workspaceId: string): Map<string, KeywordStrategyExplanation['feedbackStatus']> {
  const rows = stmts().feedback.all(workspaceId) as FeedbackRow[];
  const map = new Map<string, KeywordStrategyExplanation['feedbackStatus']>();
  for (const row of rows) {
    const normalized = normalizeKeyword(row.keyword);
    if (!normalized) continue;
    if (row.status === 'approved' || row.status === 'declined' || row.status === 'requested') {
      map.set(normalized, row.status);
    }
  }
  return map;
}

function trackingMap(trackedKeywords: TrackedKeyword[]): Map<string, TrackedKeyword> {
  return new Map(trackedKeywords.map(keyword => [normalizeKeyword(keyword.query), keyword]));
}

function isPreserved(keyword: TrackedKeyword): boolean {
  return Boolean(keyword.pinned)
    || keyword.source === TRACKED_KEYWORD_SOURCE.MANUAL
    || keyword.source === TRACKED_KEYWORD_SOURCE.CLIENT_REQUESTED
    || keyword.source === TRACKED_KEYWORD_SOURCE.CONTENT_GAP
    || keyword.source === TRACKED_KEYWORD_SOURCE.RECOMMENDATION;
}

function timestamp(value?: string): number | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function wasRetiredInRefresh(keyword: TrackedKeyword, options: BuildSummaryOptions): boolean {
  if (!keyword.deprecatedAt) return false;
  if (options.currentGeneratedAt && keyword.deprecatedAt === options.currentGeneratedAt) return true;

  const retiredAt = timestamp(keyword.deprecatedAt);
  const previousGeneratedAt = timestamp(options.previousGeneratedAt);
  const currentGeneratedAt = timestamp(options.currentGeneratedAt);
  if (retiredAt == null) return false;

  if (previousGeneratedAt != null) {
    return retiredAt > previousGeneratedAt && (currentGeneratedAt == null || retiredAt <= currentGeneratedAt);
  }

  // Without a previous generation boundary, only exact current-refresh matches
  // should count. Older inactive strategy keywords remain historical context,
  // not fresh "what changed" movement.
  return false;
}

function rolePriority(role: KeywordStrategyExplanationRole): number {
  switch (role) {
    case 'page_keyword': return 4;
    case 'content_gap': return 3;
    case 'site_keyword': return 2;
    case 'competitor_gap': return 1;
  }
}

function nextActionFor(role: KeywordStrategyExplanationRole, keyword: string, page?: PageKeywordMap, tracked?: TrackedKeyword): KeywordStrategyNextAction {
  if (role === 'content_gap') {
    return {
      type: 'generate_brief',
      label: 'Request content',
      detail: 'Open the content planning flow so this can become a reviewed request before anything is published.',
      keyword,
      targetTab: 'content-plan',
    };
  }
  if (role === 'page_keyword' && page?.pagePath) {
    return {
      type: 'optimize_page',
      label: 'Review page',
      detail: 'Open the mapped page and review the optimization opportunities before making changes.',
      keyword,
      pagePath: page.pagePath,
      targetTab: 'health',
    };
  }
  if (role === 'competitor_gap') {
    return {
      type: 'review_evidence',
      label: 'Review evidence',
      detail: 'Use this as source evidence only; selected strategy actions are filtered separately.',
      keyword,
    };
  }
  if (!tracked || (tracked.status ?? TRACKED_KEYWORD_STATUS.ACTIVE) !== TRACKED_KEYWORD_STATUS.ACTIVE) {
    return {
      type: 'track_keyword',
      label: 'Track keyword',
      detail: 'Add this to rank tracking if it should be watched going forward.',
      keyword,
      targetTab: 'ranks',
    };
  }
  return {
    type: 'watch',
    label: 'Keep watching',
    detail: 'Keep this keyword in the strategy loop and review it as new rankings arrive.',
    keyword,
    targetTab: 'ranks',
  };
}

function surfaceLabel(role: KeywordStrategyExplanationRole, surface: KeywordStrategyUxSurface): string {
  if (role === 'content_gap') return surface === 'client' ? 'Content to consider' : 'Content opportunity';
  if (role === 'page_keyword') return surface === 'client' ? 'Page we are watching' : 'Page opportunity';
  if (role === 'site_keyword') return surface === 'client' ? 'Strategy keyword' : 'Strategy input';
  return surface === 'client' ? 'Market evidence' : 'Raw provider evidence';
}

function buildExplanation(input: {
  keyword: string;
  role: KeywordStrategyExplanationRole;
  surface: KeywordStrategyUxSurface;
  sourceEvidence: string[];
  page?: PageKeywordMap;
  contentGap?: ContentGap;
  keywordGap?: KeywordGapItem;
  tracked?: TrackedKeyword;
  feedbackStatus?: KeywordStrategyExplanation['feedbackStatus'];
  businessReasons: string[];
  fitSignals: string[];
  rawEvidenceOnly?: boolean;
}): KeywordStrategyExplanation {
  const normalizedKeyword = normalizeKeyword(input.keyword);
  const opportunityScore = input.contentGap?.opportunityScore;
  const fallbackReason = input.rawEvidenceOnly
    ? 'This term came from market or competitor data and needs review before it becomes a selected action.'
    : input.page
      ? `Mapped to ${input.page.pageTitle || input.page.pagePath} so page-level work can stay focused.`
      : input.contentGap
        ? 'Identified as a content opportunity with enough context to review safely.'
        : 'Included in the strategy set that guides tracking and recommendations.';

  const reasons = uniq([...input.businessReasons, fallbackReason]).slice(0, 4);
  return {
    keyword: input.keyword,
    normalizedKeyword,
    role: input.role,
    surfaceLabel: surfaceLabel(input.role, input.surface),
    sourceEvidence: uniq(input.sourceEvidence).slice(0, 5),
    reasons,
    fitSignals: uniq(input.fitSignals).slice(0, 5),
    feedbackStatus: input.feedbackStatus,
    authorityPosture: input.tracked?.authorityPosture,
    tracking: input.tracked ? {
      status: input.tracked.status ?? TRACKED_KEYWORD_STATUS.ACTIVE,
      source: input.tracked.source,
      pagePath: input.tracked.pagePath,
      pageTitle: input.tracked.pageTitle,
      replacedBy: input.tracked.replacedBy,
      deprecatedAt: input.tracked.deprecatedAt,
      baselinePosition: input.tracked.baselinePosition,
      baselineClicks: input.tracked.baselineClicks,
      baselineImpressions: input.tracked.baselineImpressions,
    } : { status: 'not_tracked' },
    pagePath: input.page?.pagePath,
    pageTitle: input.page?.pageTitle,
    opportunityScore,
    rawEvidenceOnly: input.rawEvidenceOnly,
    nextAction: nextActionFor(input.role, input.keyword, input.page, input.tracked),
  };
}

export function buildKeywordStrategyRefreshSummary(options: BuildSummaryOptions): KeywordStrategyRefreshSummary {
  const previousSite = new Set((options.previousSiteKeywords ?? []).map(normalizeKeyword).filter(Boolean));
  const currentSite = new Set((options.currentSiteKeywords ?? []).map(normalizeKeyword).filter(Boolean));
  const previousGaps = new Set((options.previousContentGapKeywords ?? []).map(normalizeKeyword).filter(Boolean));
  const currentGaps = new Set((options.currentContentGapKeywords ?? []).map(normalizeKeyword).filter(Boolean));
  const previousPages = new Map((options.previousPageMap ?? []).map(page => [page.pagePath, normalizeKeyword(page.primaryKeyword)]));
  const currentPages = new Map((options.currentPageMap ?? []).map(page => [page.pagePath, normalizeKeyword(page.primaryKeyword)]));

  let retainedPages = 0;
  let reassigned = 0;
  for (const [path, keyword] of currentPages) {
    const previousKeyword = previousPages.get(path);
    if (!previousKeyword) continue;
    if (previousKeyword === keyword) retainedPages += 1;
    else reassigned += 1;
  }

  const retainedSite = [...currentSite].filter(keyword => previousSite.has(keyword)).length;
  const tracked = options.trackedKeywords ?? [];
  // Wave 3d-ii: a tracked keyword reaches DEPRECATED/REPLACED status ONLY via
  // reconcile's auto-deprecation (the sole writer of those statuses), so keying on
  // status is equivalent to the old strategy-ownership gate — and works on the
  // stripped getTrackedKeywords shape (strategyOwned is table-only, not present here).
  const retiredInWindow = (keyword: TrackedKeyword, status: string) => keyword.status === status
    && wasRetiredInRefresh(keyword, options);
  return {
    previousGeneratedAt: options.previousGeneratedAt,
    currentGeneratedAt: options.currentGeneratedAt,
    added: [...currentSite].filter(keyword => !previousSite.has(keyword)).length,
    retained: retainedSite + retainedPages,
    reassigned,
    deprecated: tracked.filter(keyword => retiredInWindow(keyword, TRACKED_KEYWORD_STATUS.DEPRECATED)).length,
    replaced: tracked.filter(keyword => retiredInWindow(keyword, TRACKED_KEYWORD_STATUS.REPLACED)).length,
    preserved: tracked.filter(keyword => (keyword.status ?? TRACKED_KEYWORD_STATUS.ACTIVE) === TRACKED_KEYWORD_STATUS.ACTIVE && isPreserved(keyword)).length,
    skipped: options.skipped ?? 0,
    newContentGaps: [...currentGaps].filter(keyword => !previousGaps.has(keyword)).length,
    resolvedContentGaps: [...previousGaps].filter(keyword => !currentGaps.has(keyword)).length,
  };
}

export function buildLatestKeywordStrategyRefreshSummary(options: {
  workspaceId: string;
  strategy?: KeywordStrategy | null;
  pageMap: PageKeywordMap[];
  contentGaps: ContentGap[];
  trackedKeywords?: TrackedKeyword[];
}): KeywordStrategyRefreshSummary | undefined {
  if (!options.strategy) return undefined;
  const prev = stmts().latestHistory.get(options.workspaceId) as StrategyHistoryRow | undefined;
  // parseJsonSafe returns the fallback for null/empty raw, so passing
  // prev?.strategy_json (possibly undefined) degrades to {} without a guard. The
  // typed empty fallback keeps the result's optional fields visible to TS.
  const prevStrategy = parseJsonSafe(
    prev?.strategy_json,
    strategyHistoryStrategySchema,
    EMPTY_STRATEGY_HISTORY,
    { workspaceId: options.workspaceId, field: 'strategy_json', table: 'strategy_history' },
  );
  const prevPageMap = parseJsonSafeArray(prev?.page_map_json, strategyHistoryPageMapSchema, {
    workspaceId: options.workspaceId, field: 'page_map_json', table: 'strategy_history',
  });
  return buildKeywordStrategyRefreshSummary({
    previousGeneratedAt: prev?.generated_at,
    currentGeneratedAt: options.strategy.generatedAt,
    previousSiteKeywords: prevStrategy.siteKeywords ?? [],
    currentSiteKeywords: options.strategy.siteKeywords ?? [],
    previousContentGapKeywords: prevStrategy.contentGaps?.flatMap(gap => (gap.targetKeyword ? [gap.targetKeyword] : [])) ?? [],
    currentContentGapKeywords: options.contentGaps.map(gap => gap.targetKeyword),
    previousPageMap: prevPageMap,
    currentPageMap: options.pageMap,
    trackedKeywords: options.trackedKeywords ?? getTrackedKeywords(options.workspaceId, { includeInactive: true }),
  });
}

export async function buildKeywordStrategyUxPayload(options: BuildKeywordStrategyUxOptions): Promise<KeywordStrategyUxPayload> {
  const surface = options.surface ?? 'admin';
  const trackedKeywords = options.trackedKeywords ?? getTrackedKeywords(options.workspaceId, { includeInactive: true });
  const trackedByKeyword = trackingMap(trackedKeywords);
  const feedbackByKeyword = feedbackMap(options.workspaceId);
  const explanations = new Map<string, KeywordStrategyExplanation>();
  let evaluationContext = buildStrategyKeywordEvaluationContext({
    workspaceId: options.workspaceId,
    workspaceName: options.workspaceName,
    businessContext: options.strategy?.businessContext,
    declinedKeywords: getDeclinedKeywords(options.workspaceId),
    requestedKeywords: getRequestedKeywords(options.workspaceId),
    strictBusinessFit: false,
  });

  if (options.includeWorkspaceIntelligence !== false) {
    try {
      const intelligence = await buildWorkspaceIntelligence(options.workspaceId, { slices: ['seoContext', 'clientSignals'] });
      evaluationContext = buildStrategyKeywordEvaluationContext({
        workspaceId: options.workspaceId,
        workspaceName: options.workspaceName,
        businessContext: options.strategy?.businessContext,
        seoContext: intelligence.seoContext,
        clientSignals: intelligence.clientSignals,
        declinedKeywords: [...new Set([...(intelligence.clientSignals?.keywordFeedback.rejected ?? []), ...getDeclinedKeywords(options.workspaceId)])],
        requestedKeywords: getRequestedKeywords(options.workspaceId),
        approvedKeywords: intelligence.clientSignals?.keywordFeedback.approved ?? [],
        strictBusinessFit: false,
      });
    } catch (err) {
      log.warn({ err, workspaceId: options.workspaceId }, 'Falling back to minimal keyword strategy UX context');
    }
  }

  const add = (explanation: KeywordStrategyExplanation) => {
    const existing = explanations.get(explanation.normalizedKeyword);
    if (!existing || rolePriority(explanation.role) > rolePriority(existing.role)) {
      explanations.set(explanation.normalizedKeyword, explanation);
    }
  };

  const evaluated = (keyword: string, source: string, volume?: number, difficulty?: number) => evaluateKeywordCandidate({
    keyword,
    source,
    volume: volume ?? 0,
    difficulty: difficulty ?? 0,
    cpc: 0,
  }, evaluationContext);

  const siteMetricByKeyword = new Map((options.strategy?.siteKeywordMetrics ?? []).map(metric => [normalizeKeyword(metric.keyword), metric]));
  for (const keyword of options.strategy?.siteKeywords ?? []) {
    const normalized = normalizeKeyword(keyword);
    if (!normalized) continue;
    const metric = siteMetricByKeyword.get(normalized);
    const result = evaluated(keyword, 'pattern', metric?.volume, metric?.difficulty);
    const tracked = trackedByKeyword.get(normalized);
    add(buildExplanation({
      keyword,
      role: 'site_keyword',
      surface,
      sourceEvidence: compactStrings([
        'Selected strategy keyword',
        metric?.volume != null ? `${metric.volume.toLocaleString()} monthly searches` : null,
        metric?.difficulty != null ? `Difficulty ${metric.difficulty}` : null,
        tracked ? 'Rank tracking connected' : null,
      ]),
      tracked,
      feedbackStatus: feedbackByKeyword.get(normalized),
      businessReasons: result.reasons.map(reason => reason.message),
      fitSignals: result.fitSignals,
    }));
  }

  for (const page of options.pageMap) {
    const keyword = page.primaryKeyword;
    const normalized = normalizeKeyword(keyword);
    if (!normalized) continue;
    const result = evaluated(keyword, page.currentPosition || page.impressions ? 'gsc' : 'pattern', page.volume, page.difficulty);
    const tracked = trackedByKeyword.get(normalized);
    add(buildExplanation({
      keyword,
      role: 'page_keyword',
      surface,
      page,
      sourceEvidence: compactStrings([
        `Mapped to ${page.pageTitle || page.pagePath}`,
        page.currentPosition != null ? `Current rank around #${Math.round(page.currentPosition)}` : null,
        page.impressions != null ? `${page.impressions.toLocaleString()} impressions` : null,
        page.volume != null ? `${page.volume.toLocaleString()} monthly searches` : null,
        page.difficulty != null ? `Difficulty ${page.difficulty}` : null,
      ]),
      tracked,
      feedbackStatus: feedbackByKeyword.get(normalized),
      businessReasons: result.reasons.map(reason => reason.message),
      fitSignals: result.fitSignals,
    }));
  }

  for (const gap of options.contentGaps) {
    const keyword = gap.targetKeyword;
    const normalized = normalizeKeyword(keyword);
    if (!normalized) continue;
    const result = evaluated(keyword, gap.impressions ? 'gsc' : 'pattern', gap.volume, gap.difficulty);
    const tracked = trackedByKeyword.get(normalized);
    add(buildExplanation({
      keyword,
      role: 'content_gap',
      surface,
      contentGap: gap,
      sourceEvidence: compactStrings([
        `${gap.priority} priority content gap`,
        gap.competitorProof,
        gap.impressions != null ? `${gap.impressions.toLocaleString()} impressions` : null,
        gap.volume != null ? `${gap.volume.toLocaleString()} monthly searches` : null,
        gap.difficulty != null ? `Difficulty ${gap.difficulty}` : null,
      ]),
      tracked,
      feedbackStatus: feedbackByKeyword.get(normalized),
      businessReasons: result.reasons.map(reason => reason.message),
      fitSignals: result.fitSignals,
    }));
  }

  if (surface === 'admin') {
    for (const gap of options.keywordGaps.slice(0, 25)) {
      const normalized = normalizeKeyword(gap.keyword);
      if (!normalized) continue;
      const result = evaluated(gap.keyword, 'provider', gap.volume, gap.difficulty);
      add(buildExplanation({
        keyword: gap.keyword,
        role: 'competitor_gap',
        surface,
        keywordGap: gap,
        sourceEvidence: compactStrings([
          'Raw competitor/provider evidence',
          `${gap.competitorDomain} ranks #${gap.competitorPosition}`,
          gap.volume != null ? `${gap.volume.toLocaleString()} monthly searches` : null,
          gap.difficulty != null ? `Difficulty ${gap.difficulty}` : null,
        ]),
        tracked: trackedByKeyword.get(normalized),
        feedbackStatus: feedbackByKeyword.get(normalized),
        businessReasons: result.reasons.map(reason => reason.message),
        fitSignals: result.fitSignals,
        rawEvidenceOnly: true,
      }));
    }
  }

  return {
    refreshSummary: options.summary,
    explanations: [...explanations.values()],
    rawEvidenceNote: surface === 'admin' ? RAW_EVIDENCE_NOTE : undefined,
  };
}

export function attachKeywordStrategyUxToDiff(
  diff: Omit<KeywordStrategyDiff, 'summary' | 'explanations' | 'rawEvidenceNote'>,
  ux: KeywordStrategyUxPayload,
): KeywordStrategyDiff {
  return {
    ...diff,
    summary: ux.refreshSummary,
    explanations: ux.explanations.slice(0, 30),
    rawEvidenceNote: ux.rawEvidenceNote,
  };
}
