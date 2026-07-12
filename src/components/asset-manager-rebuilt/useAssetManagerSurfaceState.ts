// @ds-rebuilt
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import {
  ASSET_MANAGER_LENSES,
  AUDIT_ISSUE_FILTERS,
  BROWSE_FILTERS,
  CMS_FILTERS,
  NON_CMS_FILTERS,
  type AssetManagerLens,
  type AssetSort,
  type AssetViewMode,
  type AuditIssueFilter,
  type AuditSort,
  type BrowseFilter,
} from './types';

const DEFAULT_LENS: AssetManagerLens = 'browse';
const DEFAULT_ASSET_SORT: AssetSort = 'createdOn';
const DEFAULT_AUDIT_SORT: AuditSort = 'issues';
const DEFAULT_VIEW: AssetViewMode = 'grid';
const SEARCH_DEBOUNCE_MS = 300;

const LENS_VALUES = new Set<string>(ASSET_MANAGER_LENSES.map((lens) => lens.id));
const BROWSE_FILTER_VALUES = new Set<string>(BROWSE_FILTERS.map((filter) => filter.id));
const AUDIT_FILTER_VALUES = new Set<string>(AUDIT_ISSUE_FILTERS.map((filter) => filter.id));
const ASSET_SORT_VALUES = new Set<string>(['createdOn', 'fileName', 'fileSize']);
const AUDIT_SORT_VALUES = new Set<string>(['issues', 'size', 'name']);
const VIEW_VALUES = new Set<string>(['grid', 'table']);

type ParamValue = string | number | null | undefined;

function isLens(value: string | null | undefined): value is AssetManagerLens {
  return typeof value === 'string' && LENS_VALUES.has(value);
}

function isBrowseFilter(value: string | null | undefined): value is BrowseFilter {
  return typeof value === 'string' && BROWSE_FILTER_VALUES.has(value);
}

function isAuditFilter(value: string | null | undefined): value is AuditIssueFilter {
  return typeof value === 'string' && AUDIT_FILTER_VALUES.has(value);
}

function isAssetSort(value: string | null | undefined): value is AssetSort {
  return typeof value === 'string' && ASSET_SORT_VALUES.has(value);
}

function isAuditSort(value: string | null | undefined): value is AuditSort {
  return typeof value === 'string' && AUDIT_SORT_VALUES.has(value);
}

function isView(value: string | null | undefined): value is AssetViewMode {
  return typeof value === 'string' && VIEW_VALUES.has(value);
}

function lensFromParams(params: URLSearchParams): AssetManagerLens {
  const tab = params.get('tab');
  return isLens(tab) ? tab : DEFAULT_LENS;
}

function browseFiltersFromParams(params: URLSearchParams): Set<BrowseFilter> {
  const raw = params.get('filter');
  if (!raw) return new Set<BrowseFilter>();
  return new Set(raw.split(',').filter(isBrowseFilter));
}

function auditFilterFromParams(params: URLSearchParams): AuditIssueFilter | null {
  const raw = params.get('filter');
  return isAuditFilter(raw) ? raw : null;
}

export interface UseAssetManagerSurfaceStateReturn {
  lens: AssetManagerLens;
  setLens: (lens: AssetManagerLens) => void;
  browseFilters: Set<BrowseFilter>;
  toggleBrowseFilter: (filter: BrowseFilter) => void;
  showAllBrowseAssets: () => void;
  clearBrowseFilters: () => void;
  auditFilter: AuditIssueFilter | null;
  setAuditFilter: (filter: AuditIssueFilter | null) => void;
  searchInput: string;
  setSearchInput: (value: string) => void;
  search: string;
  assetSort: AssetSort;
  setAssetSort: (sort: AssetSort) => void;
  auditSort: AuditSort;
  setAuditSort: (sort: AuditSort) => void;
  view: AssetViewMode;
  setView: (view: AssetViewMode) => void;
  selectedAssetId: string | null;
  openAsset: (assetId: string) => void;
  closeAsset: () => void;
  clearAll: () => void;
}

export function useAssetManagerSurfaceState(): UseAssetManagerSurfaceStateReturn {
  const [searchParams, setSearchParams] = useSearchParams();
  const lens = lensFromParams(searchParams);
  const browseFilters = browseFiltersFromParams(searchParams);
  const auditFilter = auditFilterFromParams(searchParams);
  const assetSort = isAssetSort(searchParams.get('sort')) ? searchParams.get('sort') as AssetSort : DEFAULT_ASSET_SORT;
  const auditSort = isAuditSort(searchParams.get('sort')) ? searchParams.get('sort') as AuditSort : DEFAULT_AUDIT_SORT;
  const view = isView(searchParams.get('view')) ? searchParams.get('view') as AssetViewMode : DEFAULT_VIEW;
  const selectedAssetId = searchParams.get('asset');
  const committedSearch = searchParams.get('search') ?? '';
  const lastSyncedSearchRef = useRef(committedSearch);
  const [searchInput, setSearchInput] = useState(committedSearch);
  const debouncedSearchInput = useDebouncedValue(searchInput, SEARCH_DEBOUNCE_MS);

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
    updateParams({ search: nextSearch });
  }, [committedSearch, debouncedSearchInput, searchInput, updateParams]);

  const setLens = useCallback((nextLens: AssetManagerLens) => {
    updateParams({
      tab: nextLens === DEFAULT_LENS ? null : nextLens,
      filter: null,
      asset: null,
      sort: nextLens === 'audit' ? DEFAULT_AUDIT_SORT : null,
    });
  }, [updateParams]);

  // Not a local useState<Set> toggle: the source of truth is the URL (?filter= via
  // updateParams), and toggling carries CMS↔non-CMS mutual-exclusion side effects.
  // useToggleSet manages local state and can't own the URL param or the exclusion. use-toggle-set-ok
  const toggleBrowseFilter = useCallback((filter: BrowseFilter) => {
    const next = new Set(browseFilters);
    if (CMS_FILTERS.has(filter)) {
      NON_CMS_FILTERS.forEach((item) => next.delete(item));
    } else {
      CMS_FILTERS.forEach((item) => next.delete(item));
    }
    if (next.has(filter)) next.delete(filter);
    else next.add(filter);
    updateParams({ filter: [...next].join(',') || null });
  }, [browseFilters, updateParams]);

  const clearBrowseFilters = useCallback(() => {
    updateParams({ filter: null, search: null });
    setSearchInput('');
  }, [updateParams]);

  const showAllBrowseAssets = useCallback(() => {
    updateParams({ filter: null });
  }, [updateParams]);

  const setAuditFilter = useCallback((filter: AuditIssueFilter | null) => {
    updateParams({ filter });
  }, [updateParams]);

  const setAssetSort = useCallback((sort: AssetSort) => {
    updateParams({ sort: sort === DEFAULT_ASSET_SORT ? null : sort });
  }, [updateParams]);

  const setAuditSort = useCallback((sort: AuditSort) => {
    updateParams({ sort: sort === DEFAULT_AUDIT_SORT ? null : sort });
  }, [updateParams]);

  const setView = useCallback((nextView: AssetViewMode) => {
    updateParams({ view: nextView === DEFAULT_VIEW ? null : nextView });
  }, [updateParams]);

  const openAsset = useCallback((assetId: string) => {
    updateParams({ asset: assetId }, false);
  }, [updateParams]);

  const closeAsset = useCallback(() => {
    updateParams(lens === 'upload' ? { asset: null, tab: null } : { asset: null }, false);
  }, [lens, updateParams]);

  const clearAll = useCallback(() => {
    setSearchInput('');
    updateParams({ filter: null, search: null, asset: null });
  }, [updateParams]);

  const search = committedSearch.trim();

  return useMemo(() => ({
    lens,
    setLens,
    browseFilters,
    toggleBrowseFilter,
    showAllBrowseAssets,
    clearBrowseFilters,
    auditFilter,
    setAuditFilter,
    searchInput,
    setSearchInput,
    search,
    assetSort,
    setAssetSort,
    auditSort,
    setAuditSort,
    view,
    setView,
    selectedAssetId,
    openAsset,
    closeAsset,
    clearAll,
  }), [
    assetSort,
    auditFilter,
    auditSort,
    browseFilters,
    clearAll,
    clearBrowseFilters,
    closeAsset,
    lens,
    openAsset,
    search,
    searchInput,
    selectedAssetId,
    setAssetSort,
    setAuditFilter,
    setAuditSort,
    setLens,
    setSearchInput,
    setView,
    showAllBrowseAssets,
    toggleBrowseFilter,
    view,
  ]);
}
