// @ds-rebuilt
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  KEYWORD_COMMAND_CENTER_FILTERS,
  KEYWORD_COMMAND_CENTER_GROUP_BY,
  type KeywordCommandCenterFilter,
  type KeywordCommandCenterGroupedViewQuery,
  type KeywordCommandCenterRowsQuery,
} from '../../../shared/types/keyword-command-center';
import {
  HUB_DEEP_LINK_PARAMS,
  readHubDeepLink,
} from '../../lib/keywordHubDeepLink';
import { keywordTrackingKey } from '../../lib/keywordTracking';
import {
  KEYWORD_HUB_SORT_KEYS,
  hubSortToKccSort,
  type KeywordHubSortKey,
  type KeywordHubSortState,
} from '../../lib/keywordHubSort';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';

export const KEYWORDS_SURFACE_LENSES = [
  { id: 'rankings', label: 'Rankings' },
  { id: 'lifecycle', label: 'Lifecycle' },
] as const;

export type KeywordsSurfaceLens = typeof KEYWORDS_SURFACE_LENSES[number]['id'];
export type KeywordColumnsMode = 'full' | 'triage';
export type KeywordGroupBy = 'none' | 'page' | 'cluster';
type LegacyKeywordsSurfaceLens = 'opportunities' | 'pages' | 'clusters';

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
const LEGACY_LENS_VALUES = new Set<LegacyKeywordsSurfaceLens>(['opportunities', 'pages', 'clusters']);
const FILTER_VALUES = new Set<string>(Object.values(KEYWORD_COMMAND_CENTER_FILTERS));
const SORT_VALUES = new Set<string>(KEYWORD_HUB_SORT_KEYS);

const DEFAULT_LENS: KeywordsSurfaceLens = 'rankings';
// The rebuilt surface's own lens lives in its OWN param — NOT the shared 'tab' segment,
// which is the cross-surface FILTER deep-link contract (readHubDeepLink). Overloading
// 'tab' for both silently dropped an inbound filter the moment the user switched lens
// (review PR #1480).
const LENS_PARAM = 'lens';
const COLUMNS_PARAM = 'columns';
const GROUP_PARAM = 'group';
const DEFAULT_FILTER = KEYWORD_COMMAND_CENTER_FILTERS.ALL;
const DEFAULT_SORT: KeywordHubSortState = { key: 'position', direction: 'asc' };
const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 50;
const SEARCH_DEBOUNCE_MS = 300;

function isKeywordsSurfaceLens(value: string | null | undefined): value is KeywordsSurfaceLens {
  return typeof value === 'string' && LENS_VALUES.has(value);
}

function isLegacyKeywordsSurfaceLens(value: string | null | undefined): value is LegacyKeywordsSurfaceLens {
  return typeof value === 'string' && LEGACY_LENS_VALUES.has(value as LegacyKeywordsSurfaceLens);
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
  if (isKeywordsSurfaceLens(lensParam)) return lensParam;
  if (isLegacyKeywordsSurfaceLens(lensParam)) return DEFAULT_LENS;
  return DEFAULT_LENS;
}

function columnsFromParams(params: URLSearchParams): KeywordColumnsMode {
  const explicit = params.get(COLUMNS_PARAM);
  if (explicit === 'triage' || explicit === 'full') return explicit;
  return params.get(LENS_PARAM) === 'opportunities' ? 'triage' : 'full';
}

function groupByFromParams(params: URLSearchParams): KeywordGroupBy {
  const explicit = params.get(GROUP_PARAM);
  if (explicit === 'page' || explicit === 'cluster' || explicit === 'none') return explicit;
  const legacyLens = params.get(LENS_PARAM);
  if (legacyLens === 'pages') return 'page';
  if (legacyLens === 'clusters') return 'cluster';
  return 'none';
}

function sortFromParams(params: URLSearchParams): KeywordHubSortState {
  const key = params.get('sort');
  const direction = params.get('direction');
  const lensDefault = defaultSortForColumns(columnsFromParams(params));
  return {
    key: isKeywordHubSortKey(key) ? key : lensDefault.key,
    direction: isSortDirection(direction) ? direction : lensDefault.direction,
  };
}

function defaultSortForColumns(columns: KeywordColumnsMode): KeywordHubSortState {
  if (columns === 'triage') return { key: 'opportunity', direction: 'desc' };
  return DEFAULT_SORT;
}

type ParamValue = string | number | null | undefined;

export interface UseKeywordsSurfaceStateReturn {
  lens: KeywordsSurfaceLens;
  setLens: (lens: KeywordsSurfaceLens) => void;
  columns: KeywordColumnsMode;
  setColumns: (columns: KeywordColumnsMode) => void;
  groupBy: KeywordGroupBy;
  setGroupBy: (groupBy: KeywordGroupBy) => void;
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
  groupedQuery: KeywordCommandCenterGroupedViewQuery | null;
}

export function useKeywordsSurfaceState(): UseKeywordsSurfaceStateReturn {
  const [searchParams, setSearchParams] = useSearchParams();
  const committedSearch = searchParams.get('search') ?? '';
  const lastSyncedSearchRef = useRef(committedSearch);
  const drawerOriginFocusRef = useRef<HTMLElement | null>(null);
  const focusRestoreFrameRef = useRef<number | null>(null);
  const [searchInput, setSearchInput] = useState(committedSearch);
  const debouncedSearchInput = useDebouncedValue(searchInput, SEARCH_DEBOUNCE_MS);

  const lens = lensFromParams(searchParams);
  const columns = columnsFromParams(searchParams);
  const groupBy = groupByFromParams(searchParams);
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

  useEffect(() => () => {
    if (focusRestoreFrameRef.current != null) {
      window.cancelAnimationFrame(focusRestoreFrameRef.current);
    }
  }, []);

  const setLens = useCallback((nextLens: KeywordsSurfaceLens) => {
    const nextSort = nextLens === 'rankings' ? defaultSortForColumns(columns) : DEFAULT_SORT;
    updateParams({
      [LENS_PARAM]: nextLens,
      [COLUMNS_PARAM]: columns === 'triage' ? columns : null,
      [GROUP_PARAM]: groupBy === 'none' ? null : groupBy,
      sort: nextSort.key,
      direction: nextSort.direction,
      page: DEFAULT_PAGE,
    });
  }, [columns, groupBy, updateParams]);

  const setColumns = useCallback((nextColumns: KeywordColumnsMode) => {
    const nextSort = defaultSortForColumns(nextColumns);
    updateParams({
      [LENS_PARAM]: DEFAULT_LENS,
      [COLUMNS_PARAM]: nextColumns === 'full' ? null : nextColumns,
      [GROUP_PARAM]: groupBy === 'none' ? null : groupBy,
      sort: nextSort.key,
      direction: nextSort.direction,
      page: DEFAULT_PAGE,
    });
  }, [groupBy, updateParams]);

  const setGroupBy = useCallback((nextGroupBy: KeywordGroupBy) => {
    updateParams({
      [LENS_PARAM]: DEFAULT_LENS,
      [COLUMNS_PARAM]: columns === 'full' ? null : columns,
      [GROUP_PARAM]: nextGroupBy === 'none' ? null : nextGroupBy,
      page: DEFAULT_PAGE,
    });
  }, [columns, updateParams]);

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
    if (focusRestoreFrameRef.current != null) {
      window.cancelAnimationFrame(focusRestoreFrameRef.current);
      focusRestoreFrameRef.current = null;
    }
    if (typeof document !== 'undefined') {
      const activeElement = document.activeElement;
      drawerOriginFocusRef.current = activeElement instanceof HTMLElement ? activeElement : null;
    }
    updateParams({ [HUB_DEEP_LINK_PARAMS.query]: keywordTrackingKey(keyword) }, false);
  }, [updateParams]);

  const closeKeyword = useCallback(() => {
    const origin = drawerOriginFocusRef.current;
    drawerOriginFocusRef.current = null;
    updateParams({ [HUB_DEEP_LINK_PARAMS.query]: null }, false);

    if (!origin || typeof window === 'undefined') return;
    focusRestoreFrameRef.current = window.requestAnimationFrame(() => {
      focusRestoreFrameRef.current = null;
      if (document.contains(origin)) origin.focus();
    });
  }, [updateParams]);

  const rowsQuery = useMemo<KeywordCommandCenterRowsQuery>(() => ({
    filter,
    search: search || undefined,
    sort: hubSortToKccSort(sort.key),
    direction: sort.direction,
    page,
    pageSize,
  }), [filter, page, pageSize, search, sort.direction, sort.key]);
  const groupedQuery = useMemo<KeywordCommandCenterGroupedViewQuery | null>(() => {
    const serverGroupBy = lens === 'lifecycle'
      ? KEYWORD_COMMAND_CENTER_GROUP_BY.LIFECYCLE_STAGE
      : groupBy === 'page'
        ? KEYWORD_COMMAND_CENTER_GROUP_BY.PAGE
        : groupBy === 'cluster'
          ? KEYWORD_COMMAND_CENTER_GROUP_BY.CLUSTER
          : null;
    if (!serverGroupBy) return null;
    return {
      groupBy: serverGroupBy,
      filter,
      search: search || undefined,
      sort: hubSortToKccSort(sort.key),
      direction: sort.direction,
    };
  }, [filter, groupBy, lens, search, sort.direction, sort.key]);

  return {
    lens,
    setLens,
    columns,
    setColumns,
    groupBy,
    setGroupBy,
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
    groupedQuery,
  };
}
