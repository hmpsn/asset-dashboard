// @ds-rebuilt
import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

export const LINKS_SURFACE_TABS = [
  { id: 'redirects', label: 'Redirects' },
  { id: 'internal', label: 'Internal Links' },
  { id: 'dead-links', label: 'Dead Links' },
  { id: 'architecture', label: 'Architecture' },
] as const;

export type LinksSurfaceTab = typeof LINKS_SURFACE_TABS[number]['id'];
export type RedirectStatusFilter = 'all' | 'redirects' | '404s' | 'errors';
export type InternalPriorityFilter = 'all' | 'high' | 'medium' | 'low';
export type InternalViewMode = 'list' | 'grouped';
export type DeadLinksListMode = 'dead' | 'redirects';
export type LinkTypeFilter = 'all' | 'internal' | 'external';
export type ArchitectureSourceFilter = 'all' | 'existing' | 'planned' | 'strategy' | 'gap';

const TAB_PARAM = 'tab';
const SEARCH_PARAM = 'search';
const REDIRECT_FILTER_PARAM = 'status';
const INTERNAL_PRIORITY_PARAM = 'priority';
const INTERNAL_VIEW_PARAM = 'view';
const DEAD_LIST_PARAM = 'list';
const LINK_TYPE_PARAM = 'type';
const ARCHITECTURE_FILTER_PARAM = 'source';
const DETAIL_PARAM = 'detail';

const DEFAULT_TAB: LinksSurfaceTab = 'redirects';
const TAB_VALUES = new Set<string>(LINKS_SURFACE_TABS.map((tab) => tab.id));
const REDIRECT_FILTERS = new Set<string>(['all', 'redirects', '404s', 'errors']);
const INTERNAL_PRIORITIES = new Set<string>(['all', 'high', 'medium', 'low']);
const INTERNAL_VIEWS = new Set<string>(['list', 'grouped']);
const DEAD_LISTS = new Set<string>(['dead', 'redirects']);
const LINK_TYPES = new Set<string>(['all', 'internal', 'external']);
const ARCHITECTURE_SOURCES = new Set<string>(['all', 'existing', 'planned', 'strategy', 'gap']);

type ParamValue = string | number | null | undefined;

function readTab(params: URLSearchParams): LinksSurfaceTab {
  const raw = params.get(TAB_PARAM);
  if (raw === 'dead') return 'dead-links';
  return typeof raw === 'string' && TAB_VALUES.has(raw) ? raw as LinksSurfaceTab : DEFAULT_TAB;
}

function readRedirectFilter(params: URLSearchParams): RedirectStatusFilter {
  const raw = params.get(REDIRECT_FILTER_PARAM);
  return typeof raw === 'string' && REDIRECT_FILTERS.has(raw) ? raw as RedirectStatusFilter : 'all';
}

function readInternalPriority(params: URLSearchParams): InternalPriorityFilter {
  const raw = params.get(INTERNAL_PRIORITY_PARAM);
  return typeof raw === 'string' && INTERNAL_PRIORITIES.has(raw) ? raw as InternalPriorityFilter : 'all';
}

function readInternalView(params: URLSearchParams): InternalViewMode {
  const raw = params.get(INTERNAL_VIEW_PARAM);
  return typeof raw === 'string' && INTERNAL_VIEWS.has(raw) ? raw as InternalViewMode : 'list';
}

function readDeadList(params: URLSearchParams): DeadLinksListMode {
  const raw = params.get(DEAD_LIST_PARAM);
  return typeof raw === 'string' && DEAD_LISTS.has(raw) ? raw as DeadLinksListMode : 'dead';
}

function readLinkType(params: URLSearchParams): LinkTypeFilter {
  const raw = params.get(LINK_TYPE_PARAM);
  return typeof raw === 'string' && LINK_TYPES.has(raw) ? raw as LinkTypeFilter : 'all';
}

function readArchitectureFilter(params: URLSearchParams): ArchitectureSourceFilter {
  const raw = params.get(ARCHITECTURE_FILTER_PARAM);
  return typeof raw === 'string' && ARCHITECTURE_SOURCES.has(raw) ? raw as ArchitectureSourceFilter : 'all';
}

export function useLinksSurfaceState() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = readTab(searchParams);
  const search = searchParams.get(SEARCH_PARAM) ?? '';
  const redirectFilter = readRedirectFilter(searchParams);
  const internalPriority = readInternalPriority(searchParams);
  const internalView = readInternalView(searchParams);
  const deadList = readDeadList(searchParams);
  const linkType = readLinkType(searchParams);
  const architectureFilter = readArchitectureFilter(searchParams);
  const detail = searchParams.get(DETAIL_PARAM);

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

  const setTab = useCallback((nextTab: LinksSurfaceTab) => {
    updateParams({
      [TAB_PARAM]: nextTab === DEFAULT_TAB ? null : nextTab,
      [DETAIL_PARAM]: null,
    });
  }, [updateParams]);

  const setSearch = useCallback((value: string) => {
    updateParams({ [SEARCH_PARAM]: value.trim() });
  }, [updateParams]);

  const clearSearch = useCallback(() => {
    updateParams({ [SEARCH_PARAM]: null });
  }, [updateParams]);

  const setRedirectFilter = useCallback((value: RedirectStatusFilter) => {
    updateParams({ [REDIRECT_FILTER_PARAM]: value });
  }, [updateParams]);

  const setInternalPriority = useCallback((value: InternalPriorityFilter) => {
    updateParams({ [INTERNAL_PRIORITY_PARAM]: value });
  }, [updateParams]);

  const setInternalView = useCallback((value: InternalViewMode) => {
    updateParams({ [INTERNAL_VIEW_PARAM]: value });
  }, [updateParams]);

  const setDeadList = useCallback((value: DeadLinksListMode) => {
    updateParams({ [DEAD_LIST_PARAM]: value });
  }, [updateParams]);

  const setLinkType = useCallback((value: LinkTypeFilter) => {
    updateParams({ [LINK_TYPE_PARAM]: value });
  }, [updateParams]);

  const setArchitectureFilter = useCallback((value: ArchitectureSourceFilter) => {
    updateParams({ [ARCHITECTURE_FILTER_PARAM]: value });
  }, [updateParams]);

  const openDetail = useCallback((value: string) => {
    updateParams({ [DETAIL_PARAM]: value }, false);
  }, [updateParams]);

  const closeDetail = useCallback(() => {
    updateParams({ [DETAIL_PARAM]: null }, false);
  }, [updateParams]);

  return {
    tab,
    setTab,
    search,
    setSearch,
    clearSearch,
    redirectFilter,
    setRedirectFilter,
    internalPriority,
    setInternalPriority,
    internalView,
    setInternalView,
    deadList,
    setDeadList,
    linkType,
    setLinkType,
    architectureFilter,
    setArchitectureFilter,
    detail,
    openDetail,
    closeDetail,
  };
}
