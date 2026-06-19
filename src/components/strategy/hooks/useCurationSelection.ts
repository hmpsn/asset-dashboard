import { useCallback, useMemo, useState } from 'react';

type SelectionMode =
  | { kind: 'ids'; ids: Set<string> }
  | { kind: 'all-in-filter'; excluded: Set<string> };

export interface CurationSelection {
  selectedCount: number;
  isSelected: (id: string) => boolean;
  toggle: (id: string) => void;
  selectAllInFilter: () => void;
  clear: () => void;
  /** Concrete id list for the bulk mutation — resolved from whichever mode is active. */
  resolveSelectedIds: () => string[];
  /** True when select-all-in-filter is active (drives the "apply to all N matching" copy). */
  isAllInFilter: boolean;
}

/**
 * Predicate-based selection for the curation cockpit (spec §4.4, CLAUDE.md UI rule #9).
 * `select-all-in-filter` is a predicate (mode + exclusion set), NOT N mounted checkbox
 * booleans — so "apply to all 144 matching" coexists with the cap-at-8 rendered view.
 * `filteredIds` = the ids of the currently-filtered set (cockpit-provided, recomputed when
 * the filter changes). Toggling under all-in-filter ADDS to the exclusion set.
 */
export function useCurationSelection(filteredIds: string[]): CurationSelection {
  const [mode, setMode] = useState<SelectionMode>({ kind: 'ids', ids: new Set() });

  const isSelected = useCallback(
    (id: string) =>
      mode.kind === 'ids' ? mode.ids.has(id) : !mode.excluded.has(id),
    [mode],
  );

  // use-toggle-set-ok: two-mode predicate (ids | all-in-filter+excluded) — useToggleSet models a flat Set only; the all-in-filter exclusion mode cannot be expressed with it
  const toggle = useCallback((id: string) => {
    setMode(prev => {
      if (prev.kind === 'ids') {
        const next = new Set(prev.ids);
        next.has(id) ? next.delete(id) : next.add(id);
        return { kind: 'ids', ids: next };
      }
      // all-in-filter: toggling means moving in/out of the exclusion set.
      const excluded = new Set(prev.excluded);
      excluded.has(id) ? excluded.delete(id) : excluded.add(id);
      return { kind: 'all-in-filter', excluded };
    });
  }, []);

  const selectAllInFilter = useCallback(() => {
    setMode({ kind: 'all-in-filter', excluded: new Set() });
  }, []);

  const clear = useCallback(() => {
    setMode({ kind: 'ids', ids: new Set() });
  }, []);

  const resolveSelectedIds = useCallback((): string[] => {
    if (mode.kind === 'ids') return [...mode.ids];
    return filteredIds.filter(id => !mode.excluded.has(id));
  }, [mode, filteredIds]);

  const selectedCount = useMemo(
    () => (mode.kind === 'ids' ? mode.ids.size : filteredIds.filter(id => !mode.excluded.has(id)).length),
    [mode, filteredIds],
  );

  return {
    selectedCount,
    isSelected,
    toggle,
    selectAllInFilter,
    clear,
    resolveSelectedIds,
    isAllInFilter: mode.kind === 'all-in-filter',
  };
}
