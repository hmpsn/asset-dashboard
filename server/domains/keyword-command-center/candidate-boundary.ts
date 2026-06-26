import { computeKeywordValueScore } from '../../scoring/keyword-value-score.js';
import { isFeatureEnabled } from '../../feature-flags.js';
import { isStrategyPoolEligibleKeyword } from '../../keyword-intelligence/rules.js';
import { createLogger } from '../../logger.js';
import { isSuspiciousPlannerGroupedVolume } from '../../keyword-strategy-helpers.js';
import { findBestParent, isJunkKeywordString, keywordComparisonKey } from '../../../shared/keyword-normalization.js';
import {
  KEYWORD_COMMAND_CENTER_FILTERS,
  type KeywordCommandCenterFilter,
  type KeywordCommandCenterMetrics,
  type KeywordCommandCenterRowsQuery,
  type KeywordCommandCenterSort,
} from '../../../shared/types/keyword-command-center.js';
import type { LocalSeoKeywordVisibilitySummary } from '../../../shared/types/local-seo.js';
import {
  TRACKED_KEYWORD_STATUS,
  type LatestRank,
  type TrackedKeyword,
} from '../../../shared/types/rank-tracking.js';
import type { ContentGap, KeywordGapItem, KeywordStrategy, PageKeywordMap } from '../../../shared/types/workspace.js';
import {
  addPageKeys,
  addStrategyKeys,
  filterMapByKeys,
  filterStrategyForKeys,
  findVariantParentKey,
  parentableVariantKeys,
  restrictPageToKeys,
} from './bundle-filters.js';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from './row-query.js';
import { keywordSortComparator, type SortFieldAccessors } from './sort.js';
import type {
  CommandCenterSourceBundle,
  FeedbackRow,
  LostVisibilityQuery,
  ValueScoringConfig,
} from './types.js';

export const RAW_EVIDENCE_ROW_LIMIT = 75;
export const RANK_EVIDENCE_ROW_LIMIT = 50;
export const LOCAL_CANDIDATE_ROW_LIMIT = 75;
export const UNIVERSE_SAFETY_CEILING = 2000;
export const KEYWORD_UNIVERSE_FULL_FLAG = 'keyword-universe-full' as const;

const log = createLogger('keyword-command-center');

export interface RowCandidateKey {
  key: string;
  keyword: string;
  sourcePriority: number;
  demand: number;
  rank?: number;
  searchText?: string;
  /** GSC clicks (28-day) — populated for ranking candidates; enables the clicks sort + filter. */
  clicks?: number;
  /** Keyword difficulty (0–100) — populated where the source has it; enables the difficulty sort. */
  difficulty?: number;
  /** Cost-per-click resolved from trackedKeyword enrichment (Phase 1: precomputed for value scoring). */
  cpc?: number;
  /** Raw keyword intent string resolved from the bundle (Phase 1: precomputed for value scoring). */
  intent?: string;
  /** Precomputed value-first score (flag ON only); undefined when the signal gate returns no score. */
  valueScore?: number;
}

export interface CandidateRowMetricProjection {
  demand: number;
  clicks?: number;
  rank?: number;
  difficulty?: number;
  cpc?: number;
  intent?: string;
  valueScore?: number;
}

export interface CandidateRowMetricParity {
  candidate: Map<string, CandidateRowMetricProjection>;
  row: Map<string, CandidateRowMetricProjection>;
}

export function selectRankEvidence(
  filteredRanks: LatestRank[],
  workspaceId: string | undefined,
): { selected: LatestRank[]; total: number } {
  if (!isFeatureEnabled(KEYWORD_UNIVERSE_FULL_FLAG, workspaceId)) {
    const selected = [...filteredRanks]
      .sort((a, b) => (b.impressions ?? 0) - (a.impressions ?? 0))
      .slice(0, RANK_EVIDENCE_ROW_LIMIT);
    return { selected, total: Math.min(filteredRanks.length, RANK_EVIDENCE_ROW_LIMIT) };
  }
  const valued = filteredRanks
    .filter(rank => (rank.clicks ?? 0) > 0 || (rank.impressions ?? 0) > 0)
    .sort((a, b) => {
      const demandDelta = (b.impressions ?? 0) - (a.impressions ?? 0);
      if (demandDelta !== 0) return demandDelta;
      return (b.clicks ?? 0) - (a.clicks ?? 0);
    });
  const total = valued.length;
  const selected = valued.slice(0, UNIVERSE_SAFETY_CEILING);
  if (total > UNIVERSE_SAFETY_CEILING) {
    log.debug(
      { workspaceId, total, kept: UNIVERSE_SAFETY_CEILING, dropped: total - UNIVERSE_SAFETY_CEILING },
      'keyword-command-center universe safety ceiling truncated rank evidence (value-ordered)',
    );
  }
  return { selected, total };
}

export function mergeMetricsInto(
  keyword: string,
  target: KeywordCommandCenterMetrics,
  metrics: KeywordCommandCenterMetrics,
): KeywordCommandCenterMetrics {
  const filtered: KeywordCommandCenterMetrics = { ...metrics };
  if (isSuspiciousPlannerGroupedVolume(keyword, filtered.volume)) {
    filtered.volume = undefined;
    filtered.difficulty = undefined;
  }
  return {
    ...target,
    ...Object.fromEntries(Object.entries(filtered).filter(([, value]) => value != null)),
  };
}

function addCandidateKey(
  candidates: Map<string, RowCandidateKey>,
  keyword: string | undefined | null,
  sourcePriority: number,
  demand = 0,
  rank?: number,
  searchText?: string,
  clicks?: number,
  difficulty?: number,
): void {
  const key = keywordComparisonKey(keyword ?? '');
  if (!key) return;
  const displayKeyword = keyword?.trim() || key;
  const existing = candidates.get(key);
  const mergeSearchText = (a: string | undefined, b: string | undefined): string | undefined => {
    const merged = [...new Set([...(a?.split(' ') ?? []), ...(b?.split(' ') ?? [])].filter(Boolean))].join(' ');
    return merged || undefined;
  };
  if (
    !existing
    || sourcePriority < existing.sourcePriority
    || (sourcePriority === existing.sourcePriority && demand > existing.demand)
  ) {
    candidates.set(key, {
      key,
      keyword: displayKeyword,
      sourcePriority,
      demand,
      rank: rank ?? existing?.rank,
      searchText: mergeSearchText(existing?.searchText, searchText),
      clicks: clicks ?? existing?.clicks,
      difficulty: difficulty ?? existing?.difficulty,
    });
  } else {
    if (existing.rank === undefined && rank !== undefined) existing.rank = rank;
    if (existing.clicks === undefined && clicks !== undefined) existing.clicks = clicks;
    if (existing.difficulty === undefined && difficulty !== undefined) existing.difficulty = difficulty;
    if (searchText) existing.searchText = mergeSearchText(existing.searchText, searchText);
  }
}

const KCC_DISCOVERY_TIER2_CTX: Parameters<typeof isStrategyPoolEligibleKeyword>[1] = {};

export function isTier1JunkKeyword(keyword: string | null | undefined): boolean {
  return isJunkKeywordString(keyword).isJunk;
}

function isTier2SuppressedDiscovery(keyword: string, volume: number, difficulty: number): boolean {
  return isStrategyPoolEligibleKeyword(
    { keyword, volume, difficulty, sourceKind: 'keyword_gap' },
    KCC_DISCOVERY_TIER2_CTX,
  ).suppressed;
}

export function gateDiscoveryGaps<T extends { contentGaps: ContentGap[]; keywordGaps: KeywordGapItem[] }>(
  source: T,
): { contentGaps: ContentGap[]; keywordGaps: KeywordGapItem[] } {
  return {
    contentGaps: source.contentGaps.filter(gap =>
      !isTier1JunkKeyword(gap.targetKeyword)
      && !isTier2SuppressedDiscovery(gap.targetKeyword, gap.volume ?? 0, gap.difficulty ?? 0)),
    keywordGaps: source.keywordGaps.filter(gap =>
      !isTier1JunkKeyword(gap.keyword)
      && !isTier2SuppressedDiscovery(gap.keyword, gap.volume ?? 0, gap.difficulty ?? 0)),
  };
}

export function addCandidateKeysFromBundle(
  candidates: Map<string, RowCandidateKey>,
  bundle: CommandCenterSourceBundle,
  localVisibility: Map<string, LocalSeoKeywordVisibilitySummary>,
  valueScoring: ValueScoringConfig = { on: false },
): void {
  const variantParentKeys = parentableVariantKeys({
    strategy: bundle.strategy,
    pageMap: bundle.pageMap,
    contentGaps: bundle.contentGaps,
    trackedKeywords: bundle.trackedKeywords,
    feedback: bundle.feedback,
  });
  let tier1Dropped = 0;
  let tier2Dropped = 0;
  for (const metric of bundle.strategy?.siteKeywordMetrics ?? []) {
    if (isTier1JunkKeyword(metric.keyword)) { tier1Dropped++; continue; }
    addCandidateKey(candidates, metric.keyword, 0, metric.volume ?? 0, undefined, undefined, undefined, metric.difficulty);
  }
  for (const keyword of bundle.strategy?.siteKeywords ?? []) {
    if (isTier1JunkKeyword(keyword)) { tier1Dropped++; continue; }
    addCandidateKey(candidates, keyword, 0);
  }
  for (const page of bundle.pageMap) {
    const pageSearchText = `${page.pageTitle ?? ''} ${page.pagePath ?? ''}`.toLowerCase();
    if (isTier1JunkKeyword(page.primaryKeyword)) tier1Dropped++;
    else addCandidateKey(candidates, page.primaryKeyword, 0, page.volume ?? 0, undefined, pageSearchText);
    for (const secondary of page.secondaryKeywords ?? []) {
      if (isTier1JunkKeyword(secondary)) { tier1Dropped++; continue; }
      addCandidateKey(candidates, secondary, 1, page.volume ?? 0, undefined, pageSearchText);
    }
  }
  for (const gap of bundle.contentGaps) {
    if (isTier1JunkKeyword(gap.targetKeyword)) { tier1Dropped++; continue; }
    if (isTier2SuppressedDiscovery(gap.targetKeyword, gap.volume ?? 0, gap.difficulty ?? 0)) { tier2Dropped++; continue; }
    addCandidateKey(candidates, gap.targetKeyword, 1, gap.volume ?? 0, undefined, undefined, undefined, gap.difficulty);
  }
  for (const keyword of bundle.trackedKeywords) {
    if (isTier1JunkKeyword(keyword.query)) { tier1Dropped++; continue; }
    addCandidateKey(candidates, keyword.query, keyword.status === TRACKED_KEYWORD_STATUS.ACTIVE ? 1 : 5, keyword.volume ?? keyword.baselineImpressions ?? 0, undefined, undefined, undefined, keyword.difficulty);
  }
  for (const row of bundle.feedback.values()) {
    if (isTier1JunkKeyword(row.keyword)) { tier1Dropped++; continue; }
    addCandidateKey(candidates, row.keyword, row.status === 'requested' ? 2 : row.status === 'declined' ? 6 : 1);
  }
  for (const rank of bundle.latestRanks) {
    if (findVariantParentKey(keywordComparisonKey(rank.query), variantParentKeys)) continue;
    if (isTier1JunkKeyword(rank.query)) { tier1Dropped++; continue; }
    addCandidateKey(candidates, rank.query, 2, rank.impressions ?? 0, rank.position, undefined, rank.clicks);
  }
  for (const gap of bundle.keywordGaps) {
    if (isTier1JunkKeyword(gap.keyword)) { tier1Dropped++; continue; }
    if (isTier2SuppressedDiscovery(gap.keyword, gap.volume ?? 0, gap.difficulty ?? 0)) { tier2Dropped++; continue; }
    addCandidateKey(candidates, gap.keyword, 4, gap.volume ?? 0, undefined, undefined, undefined, gap.difficulty);
  }
  for (const visibility of localVisibility.values()) {
    if (isTier1JunkKeyword(visibility.keyword)) { tier1Dropped++; continue; }
    addCandidateKey(candidates, visibility.keyword, 2);
  }
  for (const lost of bundle.lostVisibilityRows ?? []) {
    if (isTier1JunkKeyword(lost.query)) { tier1Dropped++; continue; }
    addCandidateKey(candidates, lost.query, 2, lost.totalImpressions, lost.lastPosition ?? undefined);
  }

  if (tier1Dropped > 0 || tier2Dropped > 0) {
    log.debug(
      { workspaceId: bundle.workspaceId, tier1Dropped, tier2Dropped },
      'keyword-command-center junk gate dropped candidates',
    );
  }

  const resolved = resolveBundleMetrics(bundle, localVisibility);
  for (const candidate of candidates.values()) {
    const metrics = resolved.get(candidate.key);
    if (!metrics) continue;
    candidate.demand = metrics.volume ?? metrics.impressions ?? 0;
    candidate.clicks = metrics.clicks;
    candidate.rank = metrics.currentPosition;
    candidate.difficulty = metrics.difficulty;
    candidate.cpc = metrics.cpc;
    candidate.intent = metrics.intent;
    if (valueScoring.on && valueScoring.ctx) {
      candidate.valueScore = computeKeywordValueScore(
        {
          keyword: candidate.keyword,
          volume: metrics.volume,
          impressions: metrics.impressions,
          difficulty: metrics.difficulty,
          cpc: metrics.cpc,
          intent: metrics.intent,
        },
        valueScoring.ctx,
      );
    }
  }
}

export function resolveBundleMetrics(
  bundle: CommandCenterSourceBundle,
  localVisibility: Map<string, LocalSeoKeywordVisibilitySummary>,
): Map<string, KeywordCommandCenterMetrics> {
  const strategy = bundle.strategy;
  const rows = new Map<string, { keyword: string; metrics: KeywordCommandCenterMetrics; rawEvidenceOnly: boolean }>();
  const ensure = (keyword: string | null | undefined): { keyword: string; metrics: KeywordCommandCenterMetrics; rawEvidenceOnly: boolean } | null => {
    const key = keywordComparisonKey(keyword ?? '');
    if (!key) return null;
    const existing = rows.get(key);
    if (existing) return existing;
    const created = { keyword: (keyword ?? '').trim() || key, metrics: {} as KeywordCommandCenterMetrics, rawEvidenceOnly: false };
    rows.set(key, created);
    return created;
  };
  const merge = (target: { keyword: string; metrics: KeywordCommandCenterMetrics }, metrics: KeywordCommandCenterMetrics): void => {
    target.metrics = mergeMetricsInto(target.keyword, target.metrics, metrics);
  };

  for (const metric of strategy?.siteKeywordMetrics ?? []) {
    const row = ensure(metric.keyword);
    if (!row) continue;
    merge(row, { volume: metric.volume, difficulty: metric.difficulty });
  }
  for (const keyword of strategy?.siteKeywords ?? []) ensure(keyword);
  for (const page of bundle.pageMap) {
    for (const keyword of [page.primaryKeyword, ...(page.secondaryKeywords ?? [])].filter(Boolean)) {
      const row = ensure(keyword);
      if (!row) continue;
      merge(row, { volume: page.volume, difficulty: page.difficulty, cpc: page.cpc, intent: page.searchIntent });
    }
  }
  for (const gap of bundle.contentGaps) {
    const row = ensure(gap.targetKeyword);
    if (!row) continue;
    merge(row, { volume: gap.volume, difficulty: gap.difficulty, cpc: gap.cpc, intent: gap.intent });
  }
  for (const gap of bundle.keywordGaps) {
    const row = ensure(gap.keyword);
    if (!row) continue;
    row.rawEvidenceOnly = true;
    merge(row, { volume: gap.volume, difficulty: gap.difficulty });
  }
  for (const keyword of bundle.trackedKeywords) {
    const row = ensure(keyword.query);
    if (!row) continue;
    merge(row, {
      volume: keyword.volume,
      difficulty: keyword.difficulty,
      cpc: keyword.cpc,
      intent: keyword.intent,
      currentPosition: keyword.baselinePosition,
      clicks: keyword.baselineClicks,
      impressions: keyword.baselineImpressions,
    });
  }
  for (const row of bundle.feedback.values()) ensure(row.keyword);
  for (const lost of bundle.lostVisibilityRows ?? []) {
    const row = ensure(lost.query);
    if (!row) continue;
    row.rawEvidenceOnly = true;
    merge(row, { currentPosition: lost.lastPosition ?? undefined, impressions: lost.totalImpressions });
  }

  const strategyKeys = [...rows.entries()]
    .filter(([, row]) => row.rawEvidenceOnly !== true)
    .map(([key]) => key);
  const metricsMap = new Map(strategyKeys.map(key => [key, rows.get(key)?.metrics.impressions ?? 0]));
  const variantParentMap = new Map<string, string>();
  for (const rank of bundle.latestRanks) {
    const normalizedQuery = keywordComparisonKey(rank.query);
    if (!normalizedQuery || rows.has(normalizedQuery)) continue;
    const parent = findBestParent(normalizedQuery, strategyKeys, metricsMap);
    if (parent) variantParentMap.set(normalizedQuery, parent);
  }

  const rankedUntrackedFiltered = bundle.latestRanks
    .filter(rank => !rows.has(keywordComparisonKey(rank.query)))
    .filter(rank => !variantParentMap.has(keywordComparisonKey(rank.query)));
  const { selected: rankedUntracked } = selectRankEvidence(rankedUntrackedFiltered, bundle.workspaceId);
  for (const rank of rankedUntracked) {
    const row = ensure(rank.query);
    if (!row) continue;
    merge(row, { currentPosition: rank.position, clicks: rank.clicks, impressions: rank.impressions, ctr: rank.ctr });
  }

  for (const rank of bundle.latestRanks) {
    const row = rows.get(keywordComparisonKey(rank.query));
    if (!row) continue;
    merge(row, { currentPosition: rank.position, clicks: rank.clicks, impressions: rank.impressions, ctr: rank.ctr });
  }

  for (const rank of bundle.latestRanks) {
    const normalizedQuery = keywordComparisonKey(rank.query);
    const parentKey = variantParentMap.get(normalizedQuery);
    if (!parentKey) continue;
    const parentRow = rows.get(parentKey);
    if (!parentRow) continue;
    parentRow.metrics.impressions = (parentRow.metrics.impressions ?? 0) + rank.impressions;
    parentRow.metrics.clicks = (parentRow.metrics.clicks ?? 0) + rank.clicks;
    if (parentRow.metrics.currentPosition == null || rank.position < parentRow.metrics.currentPosition) {
      parentRow.metrics.currentPosition = rank.position;
    }
  }

  for (const candidate of localVisibility.values()) ensure(candidate.keyword);
  for (const candidate of bundle.localCandidates ?? []) {
    const row = ensure(candidate.keyword);
    if (!row) continue;
    merge(row, { volume: candidate.volume, difficulty: candidate.difficulty });
  }

  const result = new Map<string, KeywordCommandCenterMetrics>();
  for (const [key, row] of rows) result.set(key, row.metrics);
  return result;
}

const CANDIDATE_SORT_ACCESSORS: SortFieldAccessors<RowCandidateKey> = {
  keyword: (c) => c.keyword,
  demand: (c) => c.demand,
  rank: (c) => c.rank,
  clicks: (c) => c.clicks,
  difficulty: (c) => c.difficulty,
  opportunity: (c) => c.valueScore,
};

export function candidateSortForQuery(
  sort: KeywordCommandCenterSort | undefined,
  direction?: 'asc' | 'desc',
): (a: RowCandidateKey, b: RowCandidateKey) => number {
  if (sort === undefined || sort === 'priority') {
    return (a, b) => {
      if (a.sourcePriority !== b.sourcePriority) return a.sourcePriority - b.sourcePriority;
      if (a.demand !== b.demand) return b.demand - a.demand;
      return a.keyword.localeCompare(b.keyword);
    };
  }
  return keywordSortComparator(sort, direction, CANDIDATE_SORT_ACCESSORS);
}

export function trackedKeywordMatchesFilter(keyword: TrackedKeyword, filter: KeywordCommandCenterFilter): boolean {
  const status = keyword.status ?? TRACKED_KEYWORD_STATUS.ACTIVE;
  if (filter === KEYWORD_COMMAND_CENTER_FILTERS.TRACKED) return status === TRACKED_KEYWORD_STATUS.ACTIVE;
  if (filter === KEYWORD_COMMAND_CENTER_FILTERS.RETIRED) return status !== TRACKED_KEYWORD_STATUS.ACTIVE;
  if (filter === KEYWORD_COMMAND_CENTER_FILTERS.IN_STRATEGY) {
    return status === TRACKED_KEYWORD_STATUS.ACTIVE && keyword.strategyOwned === true;
  }
  return true;
}

export function __candidateKeysForTest(
  bundle: CommandCenterSourceBundle,
  localVisibility: Map<string, LocalSeoKeywordVisibilitySummary> = new Map(),
): Set<string> {
  const candidates = new Map<string, RowCandidateKey>();
  addCandidateKeysFromBundle(candidates, { ...bundle, includeStrategyUx: false }, localVisibility);
  return new Set(candidates.keys());
}

export function rowCandidateKeysForQuery(
  bundle: CommandCenterSourceBundle,
  localVisibility: Map<string, LocalSeoKeywordVisibilitySummary>,
  query: KeywordCommandCenterRowsQuery,
  valueScoring: ValueScoringConfig = { on: false },
): { keys: Set<string>; page: number; pageSize: number; totalRows: number; totalPages: number } {
  const candidates = new Map<string, RowCandidateKey>();
  addCandidateKeysFromBundle(candidates, bundle, localVisibility, valueScoring);
  const rawSearch = query.search?.trim().toLowerCase();
  const normalizedSearch = keywordComparisonKey(query.search ?? '');
  const filtered = [...candidates.values()]
    .filter(candidate =>
      !rawSearch
      || candidate.keyword.toLowerCase().includes(rawSearch)
      || (normalizedSearch ? candidate.key.includes(normalizedSearch) : false)
      || candidate.searchText?.includes(rawSearch)
    )
    .sort(candidateSortForQuery(query.sort, query.direction));
  const pageSize = Math.min(Math.max(query.pageSize ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
  const requestedPage = Math.max(query.page ?? 1, 1);
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const page = Math.min(requestedPage, totalPages);
  const start = (page - 1) * pageSize;
  return {
    keys: new Set(filtered.slice(start, start + pageSize).map(candidate => candidate.key)),
    page,
    pageSize,
    totalRows: filtered.length,
    totalPages,
  };
}

export function sourceKeysForRows(input: {
  workspaceId: string;
  filter: KeywordCommandCenterFilter;
  strategy: KeywordStrategy | null | undefined;
  pageMap: PageKeywordMap[];
  contentGaps: ContentGap[];
  keywordGaps: KeywordGapItem[];
  trackedKeywords: TrackedKeyword[];
  latestRanks: LatestRank[];
  feedback: Map<string, FeedbackRow>;
  localVisibility: Map<string, LocalSeoKeywordVisibilitySummary>;
  lostVisibilityRows: LostVisibilityQuery[];
}): Set<string> | null {
  const keys = new Set<string>();
  const add = (keyword: string | undefined | null) => {
    const key = keywordComparisonKey(keyword ?? '');
    if (key) keys.add(key);
  };
  const pageKeys = new Set<string>();
  addPageKeys(pageKeys, input.pageMap);
  const selectedOrTrackedOrFeedbackKeys = new Set<string>();
  addStrategyKeys(selectedOrTrackedOrFeedbackKeys, input.strategy);
  addPageKeys(selectedOrTrackedOrFeedbackKeys, input.pageMap);
  for (const gap of input.contentGaps) {
    const key = keywordComparisonKey(gap.targetKeyword);
    if (key) selectedOrTrackedOrFeedbackKeys.add(key);
  }
  for (const keyword of input.trackedKeywords) {
    const key = keywordComparisonKey(keyword.query);
    if (key) selectedOrTrackedOrFeedbackKeys.add(key);
  }
  for (const key of input.feedback.keys()) selectedOrTrackedOrFeedbackKeys.add(key);
  const rawEvidenceKeys = new Set(input.keywordGaps.map(gap => keywordComparisonKey(gap.keyword)).filter(Boolean));
  const lostVisibilityKeys = new Set(input.lostVisibilityRows.map(row => keywordComparisonKey(row.query)).filter(Boolean));
  const declinedKeys = new Set(
    [...input.feedback.values()]
      .filter(row => row.status === 'declined')
      .map(row => keywordComparisonKey(row.keyword))
      .filter(Boolean),
  );
  const nonStrategyFeedbackKeys = new Set(
    [...input.feedback.values()]
      .filter(row => row.status === 'declined' || row.status === 'requested')
      .map(row => keywordComparisonKey(row.keyword))
      .filter(Boolean),
  );
  const variantParentKeys = parentableVariantKeys(input);

  switch (input.filter) {
    case KEYWORD_COMMAND_CENTER_FILTERS.ALL:
      addStrategyKeys(keys, input.strategy);
      addPageKeys(keys, input.pageMap);
      for (const gap of input.contentGaps) add(gap.targetKeyword);
      for (const gap of input.keywordGaps) add(gap.keyword);
      for (const keyword of input.trackedKeywords) add(keyword.query);
      for (const row of input.feedback.values()) add(row.keyword);
      for (const key of input.localVisibility.keys()) keys.add(key);
      for (const key of lostVisibilityKeys) keys.add(key);
      {
        const filtered = input.latestRanks.filter(rank => {
          const key = keywordComparisonKey(rank.query);
          if (findVariantParentKey(key, variantParentKeys)) return false;
          return key && !keys.has(key) && !rawEvidenceKeys.has(key);
        });
        for (const rank of selectRankEvidence(filtered, input.workspaceId).selected) add(rank.query);
      }
      return keys;
    case KEYWORD_COMMAND_CENTER_FILTERS.IN_STRATEGY:
      addStrategyKeys(keys, input.strategy);
      addPageKeys(keys, input.pageMap);
      for (const gap of input.contentGaps) add(gap.targetKeyword);
      for (const keyword of input.trackedKeywords.filter(entry => trackedKeywordMatchesFilter(entry, input.filter))) add(keyword.query);
      for (const row of input.feedback.values()) if (row.status === 'approved') add(row.keyword);
      for (const key of nonStrategyFeedbackKeys) keys.delete(key);
      return keys;
    case KEYWORD_COMMAND_CENTER_FILTERS.TRACKED:
      for (const keyword of input.trackedKeywords.filter(entry => trackedKeywordMatchesFilter(entry, input.filter))) add(keyword.query);
      return keys;
    case KEYWORD_COMMAND_CENTER_FILTERS.RETIRED:
      for (const keyword of input.trackedKeywords.filter(entry => trackedKeywordMatchesFilter(entry, input.filter))) add(keyword.query);
      for (const key of declinedKeys) keys.delete(key);
      return keys;
    case KEYWORD_COMMAND_CENTER_FILTERS.NEEDS_REVIEW:
      for (const row of input.feedback.values()) if (row.status === 'requested') add(row.keyword);
      {
        const filtered = input.latestRanks.filter(rank => {
          const key = keywordComparisonKey(rank.query);
          if (findVariantParentKey(key, variantParentKeys)) return false;
          return key && !selectedOrTrackedOrFeedbackKeys.has(key) && !rawEvidenceKeys.has(key);
        });
        for (const rank of selectRankEvidence(filtered, input.workspaceId).selected) add(rank.query);
      }
      return keys;
    case KEYWORD_COMMAND_CENTER_FILTERS.CONTENT:
      for (const gap of input.contentGaps) {
        const key = keywordComparisonKey(gap.targetKeyword);
        if (key && !pageKeys.has(key)) keys.add(key);
      }
      return keys;
    case KEYWORD_COMMAND_CENTER_FILTERS.PAGE_ASSIGNED:
      addPageKeys(keys, input.pageMap);
      return keys;
    case KEYWORD_COMMAND_CENTER_FILTERS.RAW_EVIDENCE:
      for (const gap of input.keywordGaps) {
        const key = keywordComparisonKey(gap.keyword);
        if (key && !selectedOrTrackedOrFeedbackKeys.has(key)) keys.add(key);
      }
      return keys;
    case KEYWORD_COMMAND_CENTER_FILTERS.REQUESTED:
      for (const row of input.feedback.values()) if (row.status === 'requested') add(row.keyword);
      return keys;
    case KEYWORD_COMMAND_CENTER_FILTERS.DECLINED:
      for (const row of input.feedback.values()) if (row.status === 'declined') add(row.keyword);
      return keys;
    case KEYWORD_COMMAND_CENTER_FILTERS.LOST_VISIBILITY:
      for (const key of lostVisibilityKeys) keys.add(key);
      return keys;
    case KEYWORD_COMMAND_CENTER_FILTERS.LOCAL:
    case KEYWORD_COMMAND_CENTER_FILTERS.VISIBLE_LOCALLY:
    case KEYWORD_COMMAND_CENTER_FILTERS.POSSIBLE_MATCH:
    case KEYWORD_COMMAND_CENTER_FILTERS.NOT_VISIBLE:
    case KEYWORD_COMMAND_CENTER_FILTERS.PROVIDER_DEGRADED:
      for (const key of input.localVisibility.keys()) keys.add(key);
      return keys;
    case KEYWORD_COMMAND_CENTER_FILTERS.NOT_CHECKED:
      return keys;
    case KEYWORD_COMMAND_CENTER_FILTERS.STRIKING_DISTANCE:
      for (const rank of input.latestRanks) {
        if (rank.position >= 11 && rank.position <= 20) {
          const key = keywordComparisonKey(rank.query);
          if (key) keys.add(key);
        }
      }
      for (const keyword of input.trackedKeywords) {
        const pos = keyword.baselinePosition;
        if (pos != null && pos >= 11 && pos <= 20) {
          add(keyword.query);
        }
      }
      return keys;
    case KEYWORD_COMMAND_CENTER_FILTERS.LOCAL_CANDIDATES:
      return null;
  }
}

export function filterBundleToKeys(
  bundle: CommandCenterSourceBundle & { keys: Set<string> | null },
  keys: Set<string>,
): CommandCenterSourceBundle & { keys: Set<string> } {
  const variantParentKeys = parentableVariantKeys(bundle);
  return {
    ...bundle,
    keys,
    strategy: filterStrategyForKeys(bundle.strategy, keys),
    pageMap: bundle.pageMap
      .map(page => restrictPageToKeys(page, keys))
      .filter((page): page is PageKeywordMap => page !== null),
    contentGaps: bundle.contentGaps.filter(gap => keys.has(keywordComparisonKey(gap.targetKeyword))),
    keywordGaps: bundle.keywordGaps.filter(gap => keys.has(keywordComparisonKey(gap.keyword))),
    trackedKeywords: bundle.trackedKeywords.filter(keyword => keys.has(keywordComparisonKey(keyword.query))),
    latestRanks: bundle.latestRanks.filter(rank => {
      const key = keywordComparisonKey(rank.query);
      const parent = findVariantParentKey(key, variantParentKeys);
      return keys.has(key) || Boolean(parent && keys.has(parent));
    }),
    feedback: filterMapByKeys(bundle.feedback, keys),
    lostVisibilityRows: (bundle.lostVisibilityRows ?? []).filter(row => keys.has(keywordComparisonKey(row.query))),
  };
}
