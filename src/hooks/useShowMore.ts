import { useState, useCallback } from 'react';

export interface UseShowMoreResult<T> {
  /** The items to render (either capped slice or full array). */
  visible: T[];
  /** How many items are hidden (0 when not capped or when expanded). */
  hiddenCount: number;
  /** Whether the full list is currently expanded. Always false when not capped. */
  expanded: boolean;
  /** Toggle between capped and full list. No-op when canExpand is false. */
  toggle: () => void;
  /** False when maxVisible is undefined or items.length <= maxVisible. */
  canExpand: boolean;
}

/**
 * Shared cap-at-N + show-more pattern for list components.
 *
 * Semantics:
 * - `maxVisible` undefined OR `items.length <= maxVisible` → full list, `canExpand = false`, no toggle UI.
 * - Otherwise: `visible = items.slice(0, maxVisible)` until `expanded = true`, then full list.
 *   `hiddenCount = items.length - maxVisible`.
 *
 * The `maxVisible` prop is the frozen contract with callers (Lane A, flag-gated):
 * absent / undefined → byte-identical full-list render with no toggle affordance.
 */
export function useShowMore<T>(items: T[], maxVisible?: number): UseShowMoreResult<T> {
  const capped = maxVisible !== undefined && items.length > maxVisible;
  const [expanded, setExpanded] = useState(false);

  const toggle = useCallback(() => {
    if (!capped) return;
    setExpanded(prev => !prev);
  }, [capped]);

  if (!capped) {
    return {
      visible: items,
      hiddenCount: 0,
      expanded: false,
      toggle,
      canExpand: false,
    };
  }

  const visible = expanded ? items : items.slice(0, maxVisible);
  const hiddenCount = expanded ? 0 : items.length - maxVisible!;

  return {
    visible,
    hiddenCount,
    expanded,
    toggle,
    canExpand: true,
  };
}
