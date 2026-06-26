import { keywordComparisonKey } from '../../../shared/keyword-normalization.js';
import {
  KEYWORD_COMMAND_CENTER_FILTERS,
  KEYWORD_COMMAND_CENTER_LOCAL_LIFECYCLE,
  KEYWORD_COMMAND_CENTER_STATUS,
  type KeywordCommandCenterCounts,
  type KeywordCommandCenterFilter,
  type KeywordCommandCenterFilterMeta,
  type KeywordCommandCenterRow,
  type KeywordCommandCenterRowsQuery,
  type KeywordCommandCenterRowsResponse,
  type KeywordCommandCenterSort,
  type KeywordCommandCenterStatus,
} from '../../../shared/types/keyword-command-center.js';
import { LOCAL_SEO_VISIBILITY_POSTURE, type LocalSeoKeywordVisibilitySummary } from '../../../shared/types/local-seo.js';
import { TRACKED_KEYWORD_STATUS } from '../../../shared/types/rank-tracking.js';
import { keywordSortComparator, type SortFieldAccessors } from './sort.js';

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 100;

/**
 * Per-request transient carrier for a finalized row's precomputed value-first
 * score. Kept off the public `KeywordCommandCenterRow` type so it never
 * serializes to clients.
 */
const rowValueScore = new WeakMap<KeywordCommandCenterRow, number>();

export function setKeywordCommandCenterRowValueScore(row: KeywordCommandCenterRow, score: number): void {
  rowValueScore.set(row, score);
}

export function sortRows(a: KeywordCommandCenterRow, b: KeywordCommandCenterRow): number {
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

const ROW_SORT_ACCESSORS: SortFieldAccessors<KeywordCommandCenterRow> = {
  keyword: (row) => row.keyword,
  demand: (row) => row.metrics.volume ?? row.metrics.impressions,
  rank: (row) => row.metrics.currentPosition,
  clicks: (row) => row.metrics.clicks,
  difficulty: (row) => row.metrics.difficulty,
  opportunity: (row) => rowValueScore.get(row),
};

export function sortRowsForQuery(
  sort: KeywordCommandCenterSort | undefined,
  direction?: 'asc' | 'desc',
): (a: KeywordCommandCenterRow, b: KeywordCommandCenterRow) => number {
  if (sort === undefined || sort === 'priority') return sortRows;
  return keywordSortComparator(sort, direction, ROW_SORT_ACCESSORS);
}

function isStrikingDistanceRow(row: KeywordCommandCenterRow): boolean {
  const pos = row.metrics.currentPosition;
  return pos != null && pos >= 11 && pos <= 20;
}

export function matchesFilter(row: KeywordCommandCenterRow, filter: KeywordCommandCenterFilter): boolean {
  if (filter === KEYWORD_COMMAND_CENTER_FILTERS.ALL) return true;
  if (filter === KEYWORD_COMMAND_CENTER_FILTERS.STRIKING_DISTANCE) return isStrikingDistanceRow(row);
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
  if (filter === KEYWORD_COMMAND_CENTER_FILTERS.LOST_VISIBILITY) return row.isLostVisibility === true;
  return row.lifecycleStatus === filter;
}

export function matchesSearch(row: KeywordCommandCenterRow, search: string | undefined): boolean {
  const query = keywordComparisonKey(search ?? '');
  if (!query) return true;
  return row.normalizedKeyword.includes(query)
    || row.assignment?.pagePath?.toLowerCase().includes(query) === true
    || row.assignment?.pageTitle?.toLowerCase().includes(query) === true;
}

export function stripLocalSeoVisibility<T extends LocalSeoKeywordVisibilitySummary | undefined>(visibility: T): T {
  if (!visibility) return visibility;
  return {
    ...visibility,
    topCompetitors: undefined,
    markets: visibility.markets.map(market => ({ ...market, topCompetitors: undefined })),
  } as T;
}

export function stripRowForList(row: KeywordCommandCenterRow): KeywordCommandCenterRow {
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

export function paginateRows(
  rows: KeywordCommandCenterRow[],
  query: KeywordCommandCenterRowsQuery,
): KeywordCommandCenterRowsResponse['pageInfo'] & { rows: KeywordCommandCenterRow[] } {
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

export function filterCount(rows: KeywordCommandCenterRow[], filter: KeywordCommandCenterFilter): number {
  if (filter === KEYWORD_COMMAND_CENTER_FILTERS.ALL) return rows.length;
  if (filter === KEYWORD_COMMAND_CENTER_FILTERS.STRIKING_DISTANCE) return rows.filter(isStrikingDistanceRow).length;
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
  if (filter === KEYWORD_COMMAND_CENTER_FILTERS.LOST_VISIBILITY) {
    return rows.filter(row => row.isLostVisibility === true).length;
  }
  return rows.filter(row => row.lifecycleStatus === filter).length;
}

export function filterNeedsLocalCandidates(filter: KeywordCommandCenterFilter | undefined): boolean {
  return filter === KEYWORD_COMMAND_CENTER_FILTERS.LOCAL_CANDIDATES;
}

export function buildCounts(rows: KeywordCommandCenterRow[]): KeywordCommandCenterCounts {
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
    strikingDistance: rows.filter(isStrikingDistanceRow).length,
    lostVisibility: rows.filter(row => row.isLostVisibility === true).length,
    missingVolume: rows.filter(row => row.metrics.volume == null || row.metrics.volume <= 0).length,
  };
}

export function buildFilters(rows: KeywordCommandCenterRow[]): KeywordCommandCenterFilterMeta[] {
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
    { id: KEYWORD_COMMAND_CENTER_FILTERS.LOST_VISIBILITY, label: 'Lost Visibility' },
  ];
  return filters.map(filter => ({ ...filter, count: filterCount(rows, filter.id) }));
}

export interface SkinnyFilterCounts {
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
  lostVisibility: number;
  strikingDistance: number;
}

export function buildFilterFacetsFromCounts(counts: SkinnyFilterCounts): KeywordCommandCenterFilterMeta[] {
  return [
    { id: KEYWORD_COMMAND_CENTER_FILTERS.ALL, label: 'All', count: counts.all },
    { id: KEYWORD_COMMAND_CENTER_FILTERS.STRIKING_DISTANCE, label: 'Striking Distance', count: counts.strikingDistance },
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
    { id: KEYWORD_COMMAND_CENTER_FILTERS.LOST_VISIBILITY, label: 'Lost Visibility', count: counts.lostVisibility },
  ];
}
