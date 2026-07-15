// @ds-rebuilt
// ─── useRovingTabindex ────────────────────────────────────────────────────────
// The shared roving-tabindex + arrow-key hook for every keyboard-navigable
// group of controls: Segmented, LensSwitcher, RadioGroup (Lane C), Toolbar
// (Lane D), and DataTable rows (Lane B). Pre-committed in F3.0.4 so the lanes
// do NOT each hand-roll a trap (4–5 divergent implementations otherwise).
//
// Roving tabindex = exactly ONE item in the group is in the tab order
// (tabIndex 0); the rest are tabIndex -1 and reached with the arrow keys. Home/
// End jump to the ends; Enter/Space fire `onActivate`.
import { useCallback, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

export type RovingOrientation = 'horizontal' | 'vertical' | 'both';

export interface RovingTabindexOptions {
  /** Which arrow keys move focus. 'horizontal' = ←/→, 'vertical' = ↑/↓, 'both' = all four. Default 'horizontal'. */
  orientation?: RovingOrientation;
  /** Wrap from last→first and first→last. Default true. */
  wrap?: boolean;
  /** Fired on Enter/Space for the focused item. Selection controls wire this to onChange. */
  onActivate?: (index: number) => void;
  /** Initial active (tabbable) index. Default 0. */
  defaultIndex?: number;
}

export interface RovingItemProps {
  tabIndex: 0 | -1;
  onKeyDown: (e: ReactKeyboardEvent) => void;
  onFocus: () => void;
  onClick: () => void;
  ref: (el: HTMLElement | null) => void;
}

export interface RovingTabindex {
  /** Index currently in the tab order (tabIndex 0). */
  activeIndex: number;
  /** Move the tabbable index programmatically (does not steal DOM focus). */
  setActiveIndex: (index: number) => void;
  /** Spread onto each item element; pass the item's 0-based index. */
  getItemProps: (index: number) => RovingItemProps;
}

/**
 * @param itemCount number of items in the group (re-clamps activeIndex when it shrinks)
 */
export function useRovingTabindex(
  itemCount: number,
  { orientation = 'horizontal', wrap = true, onActivate, defaultIndex = 0 }: RovingTabindexOptions = {},
): RovingTabindex {
  const [rawActive, setRawActive] = useState(defaultIndex);
  const refs = useRef<(HTMLElement | null)[]>([]);

  // Clamp on read so a shrinking itemCount never yields an out-of-range tabIndex.
  const activeIndex = itemCount === 0 ? 0 : Math.min(rawActive, itemCount - 1);

  const focusIndex = useCallback((index: number) => {
    setRawActive(index);
    refs.current[index]?.focus();
  }, []);

  const move = useCallback(
    (from: number, delta: 1 | -1) => {
      if (itemCount === 0) return;
      let next = from + delta;
      if (next < 0) next = wrap ? itemCount - 1 : 0;
      else if (next >= itemCount) next = wrap ? 0 : itemCount - 1;
      focusIndex(next);
    },
    [itemCount, wrap, focusIndex],
  );

  const getItemProps = useCallback(
    (index: number): RovingItemProps => ({
      tabIndex: index === activeIndex ? 0 : -1,
      ref: (el) => {
        refs.current[index] = el;
      },
      onFocus: () => setRawActive(index),
      onClick: () => {
        setRawActive(index);
        onActivate?.(index);
      },
      onKeyDown: (e) => {
        const horiz = orientation === 'horizontal' || orientation === 'both';
        const vert = orientation === 'vertical' || orientation === 'both';
        switch (e.key) {
          case 'ArrowRight':
            if (horiz) { e.preventDefault(); move(index, 1); }
            break;
          case 'ArrowLeft':
            if (horiz) { e.preventDefault(); move(index, -1); }
            break;
          case 'ArrowDown':
            if (vert) { e.preventDefault(); move(index, 1); }
            break;
          case 'ArrowUp':
            if (vert) { e.preventDefault(); move(index, -1); }
            break;
          case 'Home':
            e.preventDefault();
            focusIndex(0);
            break;
          case 'End':
            e.preventDefault();
            focusIndex(Math.max(0, itemCount - 1));
            break;
          case 'Enter':
          case ' ':
            e.preventDefault();
            onActivate?.(index);
            break;
          default:
            break;
        }
      },
    }),
    [activeIndex, orientation, move, focusIndex, itemCount, onActivate],
  );

  return { activeIndex, setActiveIndex: setRawActive, getItemProps };
}
