/**
 * Tests for useKeywordHubState — the shared interaction-state hook for the
 * Keyword Hub (P1-T1). Exercises the contract described in the plan:
 *   - segment / search / sort / page / selection state
 *   - debounced search (300 ms)
 *   - reset rules (segment change → page=1 + clear selection + clear advancedFilter;
 *     debouncedSearch change → page=1 + clear selection; page change → clear selection only)
 *   - setSort: same key toggles direction; new key sets 'asc'
 *   - initialSegment override (valid) and fallback to 'all' for invalid/missing
 *   - advancedFilter overrides activeKccFilter; clearing reverts to segment mapping
 *   - full HubSegment → filter mapping
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  useKeywordHubState,
  type HubSegment,
} from '../../src/hooks/admin/useKeywordHubState';
import { KEYWORD_COMMAND_CENTER_FILTERS } from '../../shared/types/keyword-command-center';

describe('useKeywordHubState', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ---------------------------------------------------------------------------
  // Init defaults
  // ---------------------------------------------------------------------------
  it('initialises with default state', () => {
    const { result } = renderHook(() => useKeywordHubState());

    expect(result.current.segment).toBe('all');
    expect(result.current.searchTerm).toBe('');
    expect(result.current.debouncedSearch).toBe('');
    expect(result.current.sort).toEqual({ key: 'opportunity', direction: 'desc' });
    expect(result.current.page).toBe(1);
    expect(result.current.selectedKeys.size).toBe(0);
    expect(result.current.someSelected).toBe(false);
    expect(result.current.advancedFilter).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // initialSegment override
  // ---------------------------------------------------------------------------
  it('accepts a valid initialSegment', () => {
    const { result } = renderHook(() =>
      useKeywordHubState({ initialSegment: 'tracked' }),
    );
    expect(result.current.segment).toBe('tracked');
  });

  it('falls back to "all" for an invalid initialSegment', () => {
    const { result } = renderHook(() =>
      // @ts-expect-error deliberate bad value
      useKeywordHubState({ initialSegment: 'not_a_real_segment' }),
    );
    expect(result.current.segment).toBe('all');
  });

  it('falls back to "all" when no initialSegment given', () => {
    const { result } = renderHook(() => useKeywordHubState({}));
    expect(result.current.segment).toBe('all');
  });

  // ---------------------------------------------------------------------------
  // Segment changes: resets page + clears selection + clears advancedFilter
  // ---------------------------------------------------------------------------
  it('setSegment resets page to 1, clears selection, clears advancedFilter', () => {
    const { result } = renderHook(() => useKeywordHubState());

    // Set advancedFilter first (resets page to 1), then setPage to 3 to establish
    // the precondition the test needs. setAdvancedFilter now also resets page per
    // the A3 contract — so order matters.
    act(() => {
      result.current.setAdvancedFilter(KEYWORD_COMMAND_CENTER_FILTERS.CONTENT);
    });
    act(() => {
      result.current.setPage(3);
      result.current.toggleKey('kw-a');
    });

    expect(result.current.page).toBe(3);
    expect(result.current.selectedKeys.size).toBe(1);
    expect(result.current.advancedFilter).toBe(KEYWORD_COMMAND_CENTER_FILTERS.CONTENT);

    act(() => {
      result.current.setSegment('tracked');
    });

    expect(result.current.segment).toBe('tracked');
    expect(result.current.page).toBe(1);
    expect(result.current.selectedKeys.size).toBe(0);
    expect(result.current.advancedFilter).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // Search debounce
  // ---------------------------------------------------------------------------
  it('setSearchTerm does not update debouncedSearch until 300 ms', () => {
    const { result } = renderHook(() => useKeywordHubState());

    act(() => {
      result.current.setSearchTerm('seo');
    });

    expect(result.current.searchTerm).toBe('seo');
    expect(result.current.debouncedSearch).toBe('');

    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(result.current.debouncedSearch).toBe('seo');
  });

  // ---------------------------------------------------------------------------
  // debouncedSearch change resets page + clears selection
  // ---------------------------------------------------------------------------
  it('debouncedSearch change resets page and clears selection', () => {
    const { result } = renderHook(() => useKeywordHubState());

    act(() => {
      result.current.setPage(2);
      result.current.toggleKey('kw-x');
    });

    expect(result.current.page).toBe(2);
    expect(result.current.selectedKeys.size).toBe(1);

    // Separate acts so the debounce timer fires and settles before we assert
    act(() => { result.current.setSearchTerm('content'); });
    act(() => { vi.advanceTimersByTime(300); });

    expect(result.current.page).toBe(1);
    expect(result.current.selectedKeys.size).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // Page change: clears selection only (preserves segment + search)
  // ---------------------------------------------------------------------------
  it('setPage clears selection but preserves segment and search', () => {
    const { result } = renderHook(() => useKeywordHubState());

    // Settle segment + debounced search first (separate acts)
    act(() => { result.current.setSegment('tracked'); });
    act(() => { result.current.setSearchTerm('blog'); });
    act(() => { vi.advanceTimersByTime(300); });
    // Now add a selection
    act(() => { result.current.toggleKey('kw-1'); });

    expect(result.current.segment).toBe('tracked');
    expect(result.current.debouncedSearch).toBe('blog');
    expect(result.current.selectedKeys.size).toBe(1);

    act(() => {
      result.current.setPage(2);
    });

    expect(result.current.page).toBe(2);
    expect(result.current.segment).toBe('tracked');
    expect(result.current.debouncedSearch).toBe('blog');
    expect(result.current.selectedKeys.size).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // Sort: same key toggles direction; new key sets 'asc'
  // ---------------------------------------------------------------------------
  it('setSort same key toggles asc→desc→asc', () => {
    const { result } = renderHook(() => useKeywordHubState());

    // Select a fresh column first (default is now opportunity/desc); a new key → asc.
    act(() => result.current.setSort('keyword'));
    expect(result.current.sort).toEqual({ key: 'keyword', direction: 'asc' });

    act(() => result.current.setSort('keyword'));
    expect(result.current.sort).toEqual({ key: 'keyword', direction: 'desc' });

    act(() => result.current.setSort('keyword'));
    expect(result.current.sort).toEqual({ key: 'keyword', direction: 'asc' });
  });

  it('setSort new key sets direction to asc', () => {
    const { result } = renderHook(() => useKeywordHubState());

    act(() => result.current.setSort('position'));
    expect(result.current.sort).toEqual({ key: 'position', direction: 'asc' });

    act(() => result.current.setSort('position'));
    expect(result.current.sort).toEqual({ key: 'position', direction: 'desc' });

    act(() => result.current.setSort('volume'));
    expect(result.current.sort).toEqual({ key: 'volume', direction: 'asc' });
  });

  // ---------------------------------------------------------------------------
  // Selection
  // ---------------------------------------------------------------------------
  it('toggleKey adds a key then removes it', () => {
    const { result } = renderHook(() => useKeywordHubState());

    act(() => result.current.toggleKey('kw-1'));
    expect(result.current.selectedKeys.has('kw-1')).toBe(true);
    expect(result.current.someSelected).toBe(true);

    act(() => result.current.toggleKey('kw-1'));
    expect(result.current.selectedKeys.has('kw-1')).toBe(false);
    expect(result.current.someSelected).toBe(false);
  });

  it('toggleAll selects all provided keys', () => {
    const { result } = renderHook(() => useKeywordHubState());

    act(() => result.current.toggleAll(['kw-a', 'kw-b', 'kw-c']));
    expect(result.current.selectedKeys.size).toBe(3);
    expect(result.current.someSelected).toBe(true);
  });

  it('clearSelection empties the set', () => {
    const { result } = renderHook(() => useKeywordHubState());

    act(() => {
      result.current.toggleKey('kw-1');
      result.current.toggleKey('kw-2');
    });

    act(() => result.current.clearSelection());
    expect(result.current.selectedKeys.size).toBe(0);
    expect(result.current.someSelected).toBe(false);
  });

  it('someSelected is false when empty, true when any selected', () => {
    const { result } = renderHook(() => useKeywordHubState());

    expect(result.current.someSelected).toBe(false);

    act(() => result.current.toggleKey('kw-x'));
    expect(result.current.someSelected).toBe(true);

    act(() => result.current.clearSelection());
    expect(result.current.someSelected).toBe(false);
  });

  it('allSelected returns true only when all visible keys are selected', () => {
    const { result } = renderHook(() => useKeywordHubState());
    const visible = ['kw-1', 'kw-2', 'kw-3'];

    expect(result.current.allSelected(visible)).toBe(false);

    act(() => result.current.toggleAll(visible));
    expect(result.current.allSelected(visible)).toBe(true);

    act(() => result.current.toggleKey('kw-1'));
    expect(result.current.allSelected(visible)).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // advancedFilter overrides activeKccFilter; clearing reverts to segment mapping
  // ---------------------------------------------------------------------------
  it('advancedFilter overrides activeKccFilter when set', () => {
    const { result } = renderHook(() => useKeywordHubState());

    // Default segment 'all' maps to KEYWORD_COMMAND_CENTER_FILTERS.ALL
    expect(result.current.activeKccFilter).toBe(KEYWORD_COMMAND_CENTER_FILTERS.ALL);

    act(() => {
      result.current.setAdvancedFilter(KEYWORD_COMMAND_CENTER_FILTERS.CONTENT);
    });

    expect(result.current.advancedFilter).toBe(KEYWORD_COMMAND_CENTER_FILTERS.CONTENT);
    expect(result.current.activeKccFilter).toBe(KEYWORD_COMMAND_CENTER_FILTERS.CONTENT);
  });

  it('clearing advancedFilter reverts to segment mapping', () => {
    const { result } = renderHook(() =>
      useKeywordHubState({ initialSegment: 'in_strategy' }),
    );

    act(() => {
      result.current.setAdvancedFilter(KEYWORD_COMMAND_CENTER_FILTERS.CONTENT);
    });

    expect(result.current.activeKccFilter).toBe(KEYWORD_COMMAND_CENTER_FILTERS.CONTENT);

    act(() => {
      result.current.setAdvancedFilter(null);
    });

    expect(result.current.advancedFilter).toBeNull();
    expect(result.current.activeKccFilter).toBe(
      KEYWORD_COMMAND_CENTER_FILTERS.IN_STRATEGY,
    );
  });

  // ---------------------------------------------------------------------------
  // A3: setAdvancedFilter resets page to 1 AND clears selection
  // ---------------------------------------------------------------------------
  it('setAdvancedFilter resets page to 1 and clears selection (A3 blocker 4)', () => {
    const { result } = renderHook(() => useKeywordHubState());

    // Get onto page 3 with a selection
    act(() => {
      result.current.setPage(3);
      result.current.toggleKey('kw-a');
      result.current.toggleKey('kw-b');
    });

    expect(result.current.page).toBe(3);
    expect(result.current.selectedKeys.size).toBe(2);

    // Now apply an advanced filter — must reset page + clear selection
    act(() => {
      result.current.setAdvancedFilter(KEYWORD_COMMAND_CENTER_FILTERS.CONTENT);
    });

    expect(result.current.advancedFilter).toBe(KEYWORD_COMMAND_CENTER_FILTERS.CONTENT);
    expect(result.current.page).toBe(1);
    expect(result.current.selectedKeys.size).toBe(0);
  });

  it('setAdvancedFilter(null) also resets page to 1 and clears selection (A3 blocker 4)', () => {
    const { result } = renderHook(() => useKeywordHubState());

    act(() => {
      result.current.setAdvancedFilter(KEYWORD_COMMAND_CENTER_FILTERS.CONTENT);
      result.current.setPage(2);
      result.current.toggleKey('kw-x');
    });

    expect(result.current.page).toBe(2);
    expect(result.current.selectedKeys.size).toBe(1);

    act(() => {
      result.current.setAdvancedFilter(null);
    });

    expect(result.current.advancedFilter).toBeNull();
    expect(result.current.page).toBe(1);
    expect(result.current.selectedKeys.size).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // Full HubSegment → KeywordCommandCenterFilter mapping table
  // ---------------------------------------------------------------------------
  const SEGMENT_TO_FILTER: Array<[HubSegment, string]> = [
    ['all', KEYWORD_COMMAND_CENTER_FILTERS.ALL],
    ['in_strategy', KEYWORD_COMMAND_CENTER_FILTERS.IN_STRATEGY],
    ['tracked', KEYWORD_COMMAND_CENTER_FILTERS.TRACKED],
    ['needs_review', KEYWORD_COMMAND_CENTER_FILTERS.NEEDS_REVIEW],
    ['retired', KEYWORD_COMMAND_CENTER_FILTERS.RETIRED],
    ['local', KEYWORD_COMMAND_CENTER_FILTERS.LOCAL],
  ];

  it.each(SEGMENT_TO_FILTER)(
    'segment "%s" maps activeKccFilter to "%s"',
    (segment, expectedFilter) => {
      const { result } = renderHook(() =>
        useKeywordHubState({ initialSegment: segment }),
      );
      expect(result.current.activeKccFilter).toBe(expectedFilter);
    },
  );
});
