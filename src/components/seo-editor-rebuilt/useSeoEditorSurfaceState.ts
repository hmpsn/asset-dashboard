// @ds-rebuilt
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { resolveTabSearchParam } from '../../lib/tab-search-param';
import type { FixContext } from '../../types/fix-context';
import { SEO_EDITOR_TARGET_TYPES, type SeoEditorTargetType } from '../../../shared/types/seo-editor-write-target';

export const SEO_EDITOR_SURFACE_TABS = [
  { id: 'edit', label: 'Edit' },
  { id: 'research', label: 'Research' },
] as const;

export type SeoEditorSurfaceTab = typeof SEO_EDITOR_SURFACE_TABS[number]['id'];
export type SeoEditorSourceScope = 'all' | SeoEditorTargetType;
export type SeoEditorQuickFilter = 'all' | 'needs-title' | 'needs-meta' | 'needs-review' | 'unsaved';

export const SEO_EDITOR_SOURCE_OPTIONS = [
  { id: 'all', label: 'All' },
  { id: SEO_EDITOR_TARGET_TYPES.staticPage, label: 'Static' },
  { id: SEO_EDITOR_TARGET_TYPES.cmsItem, label: 'CMS' },
  { id: SEO_EDITOR_TARGET_TYPES.manual, label: 'Manual' },
] as const satisfies ReadonlyArray<{ id: SeoEditorSourceScope; label: string }>;

export const SEO_EDITOR_QUICK_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'needs-title', label: 'Missing title' },
  { id: 'needs-meta', label: 'Missing meta' },
  { id: 'needs-review', label: 'Needs review' },
  { id: 'unsaved', label: 'Unsaved' },
] as const satisfies ReadonlyArray<{ id: SeoEditorQuickFilter; label: string }>;

const VALID_TABS = SEO_EDITOR_SURFACE_TABS.map((tab) => tab.id);
const SOURCE_VALUES = new Set<string>(SEO_EDITOR_SOURCE_OPTIONS.map((option) => option.id));
const FILTER_VALUES = new Set<string>(SEO_EDITOR_QUICK_FILTERS.map((filter) => filter.id));
const DEFAULT_TAB: SeoEditorSurfaceTab = 'edit';
const DEFAULT_SOURCE: SeoEditorSourceScope = 'all';
const DEFAULT_FILTER: SeoEditorQuickFilter = 'all';
const SEARCH_DEBOUNCE_MS = 300;

type ParamValue = string | number | null | undefined;

export function seoEditorSourceScopeLabel(source: SeoEditorSourceScope): string {
  return SEO_EDITOR_SOURCE_OPTIONS.find((option) => option.id === source)?.label ?? 'All';
}

export function seoEditorQuickFilterLabel(filter: SeoEditorQuickFilter): string {
  return SEO_EDITOR_QUICK_FILTERS.find((option) => option.id === filter)?.label ?? 'All';
}

function readTab(value: string | null): SeoEditorSurfaceTab {
  return resolveTabSearchParam<SeoEditorSurfaceTab>(value, {
    validValues: VALID_TABS,
    fallback: DEFAULT_TAB,
  });
}

function readSource(value: string | null): SeoEditorSourceScope {
  return typeof value === 'string' && SOURCE_VALUES.has(value) ? value as SeoEditorSourceScope : DEFAULT_SOURCE;
}

function readFilter(value: string | null): SeoEditorQuickFilter {
  return typeof value === 'string' && FILTER_VALUES.has(value) ? value as SeoEditorQuickFilter : DEFAULT_FILTER;
}

function readFixContext(state: unknown): FixContext | null {
  if (!state || typeof state !== 'object') return null;
  const maybeContext = (state as { fixContext?: FixContext }).fixContext;
  if (maybeContext?.targetRoute === 'seo-editor') return maybeContext;
  return null;
}

export interface UseSeoEditorSurfaceStateReturn {
  tab: SeoEditorSurfaceTab;
  setTab: (tab: SeoEditorSurfaceTab) => void;
  tabOptions: Array<{ value: SeoEditorSurfaceTab; label: string }>;
  source: SeoEditorSourceScope;
  setSource: (source: SeoEditorSourceScope) => void;
  filter: SeoEditorQuickFilter;
  setFilter: (filter: SeoEditorQuickFilter) => void;
  collection: string;
  setCollection: (collection: string) => void;
  searchInput: string;
  setSearchInput: (value: string) => void;
  search: string;
  selectedPage: string | null;
  openPage: (id: string) => void;
  closePage: () => void;
  clearFilters: () => void;
  fixContext: FixContext | null;
}

export function useSeoEditorSurfaceState(): UseSeoEditorSurfaceStateReturn {
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const [fixContext, setFixContext] = useState<FixContext | null>(() => readFixContext(location.state));
  const committedSearch = searchParams.get('search') ?? '';
  const lastSyncedSearchRef = useRef(committedSearch);
  const [searchInput, setSearchInput] = useState(committedSearch);
  const debouncedSearchInput = useDebouncedValue(searchInput, SEARCH_DEBOUNCE_MS);

  const tab = readTab(searchParams.get('tab'));
  const source = readSource(searchParams.get('source'));
  const filter = readFilter(searchParams.get('filter'));
  const collection = searchParams.get('collection') || 'all';
  const selectedPage = searchParams.get('page') || null;
  const search = committedSearch.trim();

  useEffect(() => {
    const nextFixContext = readFixContext(location.state);
    if (nextFixContext) setFixContext(nextFixContext);
  }, [location.state]);

  const updateParams = useCallback((updates: Record<string, ParamValue>, replace = true) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      for (const [key, value] of Object.entries(updates)) {
        if (value === null || value === undefined || value === '') next.delete(key);
        else next.set(key, String(value));
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
    lastSyncedSearchRef.current = nextSearch;
    updateParams({ search: nextSearch || null });
  }, [committedSearch, debouncedSearchInput, searchInput, updateParams]);

  const setTab = useCallback((nextTab: SeoEditorSurfaceTab) => {
    updateParams({ tab: nextTab === DEFAULT_TAB ? null : nextTab });
  }, [updateParams]);

  const setSource = useCallback((nextSource: SeoEditorSourceScope) => {
    updateParams({
      source: nextSource === DEFAULT_SOURCE ? null : nextSource,
      collection: nextSource === SEO_EDITOR_TARGET_TYPES.staticPage || nextSource === SEO_EDITOR_TARGET_TYPES.manual ? null : collection,
    });
  }, [collection, updateParams]);

  const setFilter = useCallback((nextFilter: SeoEditorQuickFilter) => {
    updateParams({ filter: nextFilter === DEFAULT_FILTER ? null : nextFilter });
  }, [updateParams]);

  const setCollection = useCallback((nextCollection: string) => {
    updateParams({ collection: nextCollection === 'all' ? null : nextCollection });
  }, [updateParams]);

  const openPage = useCallback((id: string) => {
    updateParams({ page: id }, false);
  }, [updateParams]);

  const closePage = useCallback(() => {
    updateParams({ page: null }, false);
  }, [updateParams]);

  const clearFilters = useCallback(() => {
    setSearchInput('');
    updateParams({ source: null, filter: null, collection: null, search: null });
  }, [updateParams]);

  const tabOptions = useMemo(() => SEO_EDITOR_SURFACE_TABS.map((option) => ({
    value: option.id,
    label: option.label,
  })), []);

  return {
    tab,
    setTab,
    tabOptions,
    source,
    setSource,
    filter,
    setFilter,
    collection,
    setCollection,
    searchInput,
    setSearchInput,
    search,
    selectedPage,
    openPage,
    closePage,
    clearFilters,
    fixContext,
  };
}
