/**
 * useKeywordHubState — shared interaction-state owner for the Keyword Hub (P1).
 *
 * Owns: segment, search (debounced), sort, page, multi-select, advancedFilter.
 * The caller derives `initialSegment` from `useSearchParams().get('tab')` and
 * passes it here; the hook does NOT read SearchParams itself so it stays pure
 * and unit-testable without a router.
 *
 * Reset rules (per plan P1-T1 contract):
 *   - setSegment   → page=1 + clearSelection + advancedFilter=null
 *   - debouncedSearch change → page=1 + clearSelection
 *   - setPage      → clearSelection (preserves segment + search)
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { useDebouncedValue } from '../useDebouncedValue';
import type { KeywordCommandCenterFilter } from '../../../shared/types/keyword-command-center';
import { KEYWORD_COMMAND_CENTER_FILTERS } from '../../../shared/types/keyword-command-center';

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

export type HubSegment =
  | 'all'
  | 'in_strategy'
  | 'tracked'
  | 'needs_review'
  | 'retired'
  | 'local';

export type HubSortKey =
  | 'keyword'
  | 'position'
  | 'change'
  | 'clicks'
  | 'volume'
  | 'difficulty'
  | 'date';

export interface HubSortState {
  key: HubSortKey;
  direction: 'asc' | 'desc';
}

export interface UseKeywordHubStateReturn {
  // Segment
  segment: HubSegment;
  setSegment: (s: HubSegment) => void;

  // Advanced filter (overrides segment mapping when non-null)
  advancedFilter: KeywordCommandCenterFilter | null;
  setAdvancedFilter: (f: KeywordCommandCenterFilter | null) => void;

  // Resolved filter to pass to the KCC API (advancedFilter takes priority)
  activeKccFilter: KeywordCommandCenterFilter;

  // Search
  searchTerm: string;
  setSearchTerm: (s: string) => void;
  /** 300 ms debounced copy of searchTerm. Pass this to the API. */
  debouncedSearch: string;

  // Sort
  sort: HubSortState;
  /** Same key toggles direction; new key resets to 'asc'. */
  setSort: (key: HubSortKey) => void;

  // Pagination
  page: number;
  setPage: (p: number) => void;

  // Multi-select
  selectedKeys: Set<string>;
  toggleKey: (k: string) => void;
  toggleAll: (keys: string[]) => void;
  clearSelection: () => void;
  someSelected: boolean;
  allSelected: (visibleKeys: string[]) => boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VALID_SEGMENTS: ReadonlySet<HubSegment> = new Set([
  'all',
  'in_strategy',
  'tracked',
  'needs_review',
  'retired',
  'local',
]);

/** Maps a HubSegment to the corresponding KeywordCommandCenterFilter value. */
const SEGMENT_TO_FILTER: Record<HubSegment, KeywordCommandCenterFilter> = {
  all: KEYWORD_COMMAND_CENTER_FILTERS.ALL,
  in_strategy: KEYWORD_COMMAND_CENTER_FILTERS.IN_STRATEGY,
  tracked: KEYWORD_COMMAND_CENTER_FILTERS.TRACKED,
  needs_review: KEYWORD_COMMAND_CENTER_FILTERS.NEEDS_REVIEW,
  retired: KEYWORD_COMMAND_CENTER_FILTERS.RETIRED,
  local: KEYWORD_COMMAND_CENTER_FILTERS.LOCAL,
};

function isValidSegment(s: unknown): s is HubSegment {
  return typeof s === 'string' && VALID_SEGMENTS.has(s as HubSegment);
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

interface UseKeywordHubStateOptions {
  /**
   * Seed segment — derived by the caller from `useSearchParams().get('tab')`.
   * Invalid or missing values fall back to 'all'.
   */
  initialSegment?: HubSegment | string | null;
}

export function useKeywordHubState(
  options: UseKeywordHubStateOptions = {},
): UseKeywordHubStateReturn {
  const { initialSegment } = options;

  // Validate and resolve the initial segment
  const resolvedInitial: HubSegment = isValidSegment(initialSegment)
    ? initialSegment
    : 'all';

  // Core state
  const [segment, setSegmentRaw] = useState<HubSegment>(resolvedInitial);
  const [advancedFilter, setAdvancedFilterRaw] = useState<KeywordCommandCenterFilter | null>(null);
  const [searchTerm, setSearchTermRaw] = useState('');
  const [sort, setSortRaw] = useState<HubSortState>({ key: 'keyword', direction: 'asc' });
  const [page, setPageRaw] = useState(1);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());

  // Debounced search (300 ms via the shared hook, NOT hand-rolled)
  const debouncedSearch = useDebouncedValue(searchTerm, 300);

  // Track previous debouncedSearch to detect when it actually changes
  const prevDebouncedRef = useRef(debouncedSearch);

  // Reset page + selection when debouncedSearch changes (but not on mount)
  useEffect(() => {
    if (prevDebouncedRef.current !== debouncedSearch) {
      prevDebouncedRef.current = debouncedSearch;
      setPageRaw(1);
      setSelectedKeys(new Set());
    }
  }, [debouncedSearch]);

  // ---------------------------------------------------------------------------
  // Setters with reset rules
  // ---------------------------------------------------------------------------

  const setSegment = useCallback((s: HubSegment) => {
    setSegmentRaw(s);
    setPageRaw(1);
    setSelectedKeys(new Set());
    setAdvancedFilterRaw(null);
  }, []);

  const setAdvancedFilter = useCallback(
    (f: KeywordCommandCenterFilter | null) => {
      setAdvancedFilterRaw(f);
    },
    [],
  );

  const setSearchTerm = useCallback((s: string) => {
    setSearchTermRaw(s);
  }, []);

  const setSort = useCallback((key: HubSortKey) => {
    setSortRaw((prev) => {
      if (prev.key === key) {
        return { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' };
      }
      return { key, direction: 'asc' };
    });
  }, []);

  const setPage = useCallback((p: number) => {
    setPageRaw(p);
    setSelectedKeys(new Set());
  }, []);

  // ---------------------------------------------------------------------------
  // Selection helpers
  // ---------------------------------------------------------------------------

  const toggleKey = useCallback((k: string) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(k)) {
        next.delete(k);
      } else {
        next.add(k);
      }
      return next;
    });
  }, []);

  const toggleAll = useCallback((keys: string[]) => {
    setSelectedKeys(new Set(keys));
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedKeys(new Set());
  }, []);

  const someSelected = selectedKeys.size > 0;

  const allSelected = useCallback(
    (visibleKeys: string[]) => {
      if (visibleKeys.length === 0) return false;
      return visibleKeys.every((k) => selectedKeys.has(k));
    },
    [selectedKeys],
  );

  // ---------------------------------------------------------------------------
  // Derived: active KCC filter
  // ---------------------------------------------------------------------------

  const activeKccFilter: KeywordCommandCenterFilter =
    advancedFilter !== null ? advancedFilter : SEGMENT_TO_FILTER[segment];

  // ---------------------------------------------------------------------------
  // Return
  // ---------------------------------------------------------------------------

  return {
    segment,
    setSegment,
    advancedFilter,
    setAdvancedFilter,
    activeKccFilter,
    searchTerm,
    setSearchTerm,
    debouncedSearch,
    sort,
    setSort,
    page,
    setPage,
    selectedKeys,
    toggleKey,
    toggleAll,
    clearSelection,
    someSelected,
    allSelected,
  };
}
