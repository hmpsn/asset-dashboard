// @ds-rebuilt
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  KEYWORD_COMMAND_CENTER_FILTERS,
  type KeywordCommandCenterFilter,
  type KeywordCommandCenterRowsQuery,
} from '../../../shared/types/keyword-command-center';
import {
  HUB_DEEP_LINK_PARAMS,
  readHubDeepLink,
} from '../../lib/keywordHubDeepLink';
import { keywordTrackingKey } from '../../lib/keywordTracking';
import {
  hubSortToKccSort,
  type KeywordHubSortKey,
  type KeywordHubSortState,
} from '../../lib/keywordHubSort';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';

export const KEYWORDS_SURFACE_LENSES = [
  { id: 'rankings', label: 'Rankings' },
  { id: 'opportunities', label: 'Opportunities' },
  { id: 'pages', label: 'Pages' },
  { id: 'clusters', label: 'Clusters' },
  { id: 'lifecycle', label: 'Lifecycle' },
] as const;

export type KeywordsSurfaceLens = typeof KEYWORDS_SURFACE_LENSES[number]['id'];

export const KEYWORDS_SURFACE_FILTERS = [
  { id: KEYWORD_COMMAND_CENTER_FILTERS.ALL, label: 'All' },
  { id: KEYWORD_COMMAND_CENTER_FILTERS.IN_STRATEGY, label: 'In strategy' },
  { id: KEYWORD_COMMAND_CENTER_FILTERS.TRACKED, label: 'Tracked' },
  { id: KEYWORD_COMMAND_CENTER_FILTERS.NEEDS_REVIEW, label: 'Needs review' },
  { id: KEYWORD_COMMAND_CENTER_FILTERS.RETIRED, label: 'Retired' },
  { id: KEYWORD_COMMAND_CENTER_FILTERS.LOCAL, label: 'Local' },
  { id: KEYWORD_COMMAND_CENTER_FILTERS.STRIKING_DISTANCE, label: 'Striking distance' },
] as const satisfies ReadonlyArray<{ id: KeywordCommandCenterFilter; label: string }>;

const LENS_VALUES = new Set<string>(KEYWORDS_SURFACE_LENSES.map((lens) => lens.id));
const FILTER_VALUES = new Set<string>(Object.values(KEYWORD_COMMAND_CENTER_FILTERS));
const SORT_VALUES = new Set<string>([
  'opportunity',
  'keyword',
  'position',
  'change',
  'clicks',
  'volume',
  'difficulty',
  'date',
]);

const DEFAULT_LENS: KeywordsSurfaceLens = 'rankings';
// The rebuilt surface's own lens lives in its OWN param — NOT the shared 'tab' segment,
// which is the cross-surface FILTER deep-link contract (readHubDeepLink). Overloading
// 'tab' for both silently dropped an inbound filter the moment the user switched lens
// (review PR #1480).
const LENS_PARAM = 'lens';
const DEFAULT_FILTER = KEYWORD_COMMAND_CENTER_FILTERS.ALL;
const DEFAULT_SORT: KeywordHubSortState = { key: 'position', direction: 'asc' };
const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 50;
const SEARCH_DEBOUNCE_MS = 300;

function isKeywordsSurfaceLens(value: string | null | undefined): value is KeywordsSurfaceLens {
  return typeof value === 'string' && LENS_VALUES.has(value);
}

function isKeywordHubSortKey(value: string | null | undefined): value is KeywordHubSortKey {
  return typeof value === 'string' && SORT_VALUES.has(value);
}

function isKeywordCommandCenterFilter(value: string | null | undefined): value is KeywordCommandCenterFilter {
  return typeof value === 'string' && FILTER_VALUES.has(value);
}

function isSortDirection(value: string | null | undefined): value is KeywordHubSortState['direction'] {
  return value === 'asc' || value === 'desc';
}

function positiveInt(value: string | null, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function filterFromParams(params: URLSearchParams): KeywordCommandCenterFilter {
  const explicitFilter = params.get('filter');
  if (isKeywordCommandCenterFilter(explicitFilter)) return explicitFilter;
  return readHubDeepLink(params).segment ?? DEFAULT_FILTER;
}

function lensFromParams(params: URLSearchParams): KeywordsSurfaceLens {
  const lensParam = params.get(LENS_PARAM);
  return isKeywordsSurfaceLens(lensParam) ? lensParam : DEFAULT_LENS;
}

function sortFromParams(params: URLSearchParams): KeywordHubSortState {
  const key = params.get('sort');
  const direction = params.get('direction');
  const lensDefault = defaultSortForLens(lensFromParams(params));
  return {
    key: isKeywordHubSortKey(key) ? key : lensDefault.key,
    direction: isSortDirection(direction) ? direction : lensDefault.direction,
  };
}

function defaultSortForLens(lens: KeywordsSurfaceLens): KeywordHubSortState {
  if (lens === 'opportunities') return { key: 'opportunity', direction: 'desc' };
  return DEFAULT_SORT;
}

type ParamValue = string | number | null | undefined;

export interface UseKeywordsSurfaceStateReturn {
  lens: KeywordsSurfaceLens;
  setLens: (lens: KeywordsSurfaceLens) => void;
  filter: KeywordCommandCenterFilter;
  setFilter: (filter: KeywordCommandCenterFilter) => void;
  searchInput: string;
  setSearchInput: (value: string) => void;
  clearFilters: () => void;
  search: string;
  sort: KeywordHubSortState;
  setSort: (key: KeywordHubSortKey) => void;
  page: number;
  setPage: (page: number) => void;
  pageSize: number;
  selectedKeyword: string | null;
  openKeyword: (keyword: string) => void;
  closeKeyword: () => void;
  rowsQuery: KeywordCommandCenterRowsQuery;
}

export function useKeywordsSurfaceState(): UseKeywordsSurfaceStateReturn {
  const [searchParams, setSearchParams] = useSearchParams();
  const committedSearch = searchParams.get('search') ?? '';
  const lastSyncedSearchRef = useRef(committedSearch);
  const [searchInput, setSearchInput] = useState(committedSearch);
  const debouncedSearchInput = useDebouncedValue(searchInput, SEARCH_DEBOUNCE_MS);

  const lens = lensFromParams(searchParams);
  const filter = filterFromParams(searchParams);
  const sort = sortFromParams(searchParams);
  const page = positiveInt(searchParams.get('page'), DEFAULT_PAGE);
  const pageSize = positiveInt(searchParams.get('pageSize'), DEFAULT_PAGE_SIZE);
  const selectedKeyword = readHubDeepLink(searchParams).query;
  const search = committedSearch.trim();

  const updateParams = useCallback((updates: Record<string, ParamValue>, replace = true) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      for (const [key, value] of Object.entries(updates)) {
        if (value === null || value === undefined || value === '') {
          next.delete(key);
        } else {
          next.set(key, String(value));
        }
      }
      return next;
    }, { replace });
  }, [setSearchParams]);

  useEffect(() => {
    if (committedSearch === lastSyncedSearchRef.current) return;
    lastSyncedSearchRef.current = committedSearch;
    setSearchInput(committedSearch);
  }, [committedSearch]);

  useEffect(() => {
    const nextSearch = debouncedSearchInput.trim();
    if (nextSearch !== searchInput.trim()) return;
    if (nextSearch === committedSearch) return;
    updateParams({ search: nextSearch, page: DEFAULT_PAGE });
  }, [committedSearch, debouncedSearchInput, searchInput, updateParams]);

  const setLens = useCallback((nextLens: KeywordsSurfaceLens) => {
    const nextSort = defaultSortForLens(nextLens);
    updateParams({
      [LENS_PARAM]: nextLens,
      sort: nextSort.key,
      direction: nextSort.direction,
      page: DEFAULT_PAGE,
    });
  }, [updateParams]);

  const setFilter = useCallback((nextFilter: KeywordCommandCenterFilter) => {
    updateParams({ filter: nextFilter, page: DEFAULT_PAGE });
  }, [updateParams]);

  const clearFilters = useCallback(() => {
    setSearchInput('');
    updateParams({ filter: null, search: null, page: DEFAULT_PAGE });
  }, [updateParams]);

  const setSort = useCallback((key: KeywordHubSortKey) => {
    const nextDirection = sort.key === key
      ? (sort.direction === 'asc' ? 'desc' : 'asc')
      : 'asc';
    updateParams({ sort: key, direction: nextDirection, page: DEFAULT_PAGE });
  }, [sort.direction, sort.key, updateParams]);

  const setPage = useCallback((nextPage: number) => {
    updateParams({ page: Math.max(DEFAULT_PAGE, nextPage) }, false);
  }, [updateParams]);

  const openKeyword = useCallback((keyword: string) => {
    updateParams({ [HUB_DEEP_LINK_PARAMS.query]: keywordTrackingKey(keyword) }, false);
  }, [updateParams]);

  const closeKeyword = useCallback(() => {
    updateParams({ [HUB_DEEP_LINK_PARAMS.query]: null }, false);
  }, [updateParams]);

  const rowsQuery = useMemo<KeywordCommandCenterRowsQuery>(() => ({
    filter,
    search: search || undefined,
    sort: hubSortToKccSort(sort.key),
    direction: sort.direction,
    page,
    pageSize,
  }), [filter, page, pageSize, search, sort.direction, sort.key]);

  return {
    lens,
    setLens,
    filter,
    setFilter,
    searchInput,
    setSearchInput,
    clearFilters,
    search,
    sort,
    setSort,
    page,
    setPage,
    pageSize,
    selectedKeyword,
    openKeyword,
    closeKeyword,
    rowsQuery,
  };
}
