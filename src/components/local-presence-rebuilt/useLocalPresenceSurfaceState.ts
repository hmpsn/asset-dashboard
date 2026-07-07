// @ds-rebuilt
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';

export const LOCAL_PRESENCE_LENSES = [
  { id: 'overview', label: 'Overview' },
  { id: 'visibility', label: 'Visibility' },
  { id: 'reviews', label: 'Reviews' },
  { id: 'setup', label: 'Setup' },
] as const;

export type LocalPresenceLens = typeof LOCAL_PRESENCE_LENSES[number]['id'];

export const LOCAL_PRESENCE_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'attention', label: 'Needs attention' },
  { id: 'configured', label: 'Configured' },
  { id: 'no_data', label: 'No data' },
] as const;

export type LocalPresenceFilter = typeof LOCAL_PRESENCE_FILTERS[number]['id'];

export const LOCAL_PRESENCE_DESKS = [
  { value: 'on_your_desk', label: 'On your desk' },
  { value: 'with_client', label: 'With client' },
  { value: 'published', label: 'Published' },
  { value: 'all', label: 'All' },
] as const;

export type LocalPresenceDesk = typeof LOCAL_PRESENCE_DESKS[number]['value'];

const LENS_VALUES = new Set<string>(LOCAL_PRESENCE_LENSES.map((lens) => lens.id));
const FILTER_VALUES = new Set<string>(LOCAL_PRESENCE_FILTERS.map((filter) => filter.id));
const DESK_VALUES = new Set<string>(LOCAL_PRESENCE_DESKS.map((desk) => desk.value));
const LENS_PARAM = 'lens';
const LEGACY_TAB_PARAM = 'tab';
const DEFAULT_LENS: LocalPresenceLens = 'overview';
const DEFAULT_FILTER: LocalPresenceFilter = 'all';
const DEFAULT_DESK: LocalPresenceDesk = 'on_your_desk';
const SEARCH_DEBOUNCE_MS = 300;

function isLocalPresenceLens(value: string | null | undefined): value is LocalPresenceLens {
  return typeof value === 'string' && LENS_VALUES.has(value);
}

function isLocalPresenceFilter(value: string | null | undefined): value is LocalPresenceFilter {
  return typeof value === 'string' && FILTER_VALUES.has(value);
}

function isLocalPresenceDesk(value: string | null | undefined): value is LocalPresenceDesk {
  return typeof value === 'string' && DESK_VALUES.has(value);
}

function lensFromParams(params: URLSearchParams): LocalPresenceLens {
  const explicitLens = params.get(LENS_PARAM);
  if (isLocalPresenceLens(explicitLens)) return explicitLens;
  const legacyTab = params.get(LEGACY_TAB_PARAM);
  if (isLocalPresenceLens(legacyTab)) return legacyTab;
  return DEFAULT_LENS;
}

function filterFromParams(params: URLSearchParams): LocalPresenceFilter {
  const filter = params.get('filter');
  return isLocalPresenceFilter(filter) ? filter : DEFAULT_FILTER;
}

function deskFromParams(params: URLSearchParams): LocalPresenceDesk {
  const desk = params.get('desk');
  return isLocalPresenceDesk(desk) ? desk : DEFAULT_DESK;
}

type ParamValue = string | number | null | undefined;

export interface UseLocalPresenceSurfaceStateReturn {
  lens: LocalPresenceLens;
  setLens: (lens: LocalPresenceLens) => void;
  filter: LocalPresenceFilter;
  setFilter: (filter: LocalPresenceFilter) => void;
  desk: LocalPresenceDesk;
  setDesk: (desk: LocalPresenceDesk) => void;
  search: string;
  searchInput: string;
  setSearchInput: (value: string) => void;
  clearFilters: () => void;
}

export function useLocalPresenceSurfaceState(): UseLocalPresenceSurfaceStateReturn {
  const [searchParams, setSearchParams] = useSearchParams();
  const committedSearch = searchParams.get('search') ?? '';
  const lastSyncedSearchRef = useRef(committedSearch);
  const [searchInput, setSearchInput] = useState(committedSearch);
  const debouncedSearchInput = useDebouncedValue(searchInput, SEARCH_DEBOUNCE_MS);

  const lens = lensFromParams(searchParams);
  const filter = filterFromParams(searchParams);
  const desk = deskFromParams(searchParams);
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
    updateParams({ search: nextSearch });
  }, [committedSearch, debouncedSearchInput, searchInput, updateParams]);

  const setLens = useCallback((nextLens: LocalPresenceLens) => {
    updateParams({
      [LENS_PARAM]: nextLens === DEFAULT_LENS ? null : nextLens,
      [LEGACY_TAB_PARAM]: null,
    });
  }, [updateParams]);

  const setFilter = useCallback((nextFilter: LocalPresenceFilter) => {
    updateParams({ filter: nextFilter === DEFAULT_FILTER ? null : nextFilter });
  }, [updateParams]);

  const setDesk = useCallback((nextDesk: LocalPresenceDesk) => {
    updateParams({ desk: nextDesk === DEFAULT_DESK ? null : nextDesk });
  }, [updateParams]);

  const clearFilters = useCallback(() => {
    setSearchInput('');
    updateParams({ filter: null, desk: null, search: null });
  }, [updateParams]);

  return {
    lens,
    setLens,
    filter,
    setFilter,
    desk,
    setDesk,
    search,
    searchInput,
    setSearchInput,
    clearFilters,
  };
}
