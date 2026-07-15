// @ds-rebuilt
import { useLayoutEffect, useRef } from 'react';
import type {
  CSSProperties,
  FocusEvent as ReactFocusEvent,
  KeyboardEvent as ReactKeyboardEvent,
  ReactElement,
  ReactNode,
} from 'react';

/**
 * Controls row above tables/boards/lists. A wrapping flex row on one spacing
 * rhythm; separate left controls (search/filters/lens) from right actions with
 * a `<ToolbarSpacer/>`. role="toolbar" + arrow-key focus movement (roving
 * tabindex) between the focusable controls.
 */
export interface ToolbarProps {
  children?: ReactNode;
  gap?: number | string;
  align?: 'center' | 'flex-start' | 'flex-end' | 'baseline';
  wrap?: boolean;
  /** Accessible label for the role="toolbar" region. */
  label?: string;
  className?: string;
  id?: string;
  style?: CSSProperties;
}

// Focusable toolbar controls. Deliberately LOCAL and distinct from
// ui/overlay/overlayUtils.ts's FOCUSABLE_SELECTOR: Toolbar re-scans its controls
// AFTER roving has set the non-active ones to tabindex="-1", so the selector must
// match bare `[tabindex]` (including -1) rather than excluding `[tabindex="-1"]`
// the way the overlay trap selector does. Only the control types a toolbar
// actually holds are listed — importing the overlay selector here would silently
// drop every roved-out control from the re-scan (review finding).
const TOOLBAR_FOCUSABLE =
  'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]';

const NAV_KEYS = ['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown', 'Home', 'End'];

export function Toolbar({
  children,
  gap = 10,
  align = 'center',
  wrap = true,
  label,
  className,
  id,
  style,
}: ToolbarProps): ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);

  const getItems = (): HTMLElement[] =>
    Array.from(containerRef.current?.querySelectorAll<HTMLElement>(TOOLBAR_FOCUSABLE) ?? []);

  const applyRoving = (activeIndex: number, items: HTMLElement[]) => {
    items.forEach((el, i) => {
      el.tabIndex = i === activeIndex ? 0 : -1;
    });
  };

  // Roving tabindex: exactly one control is tabbable (the first, until focus
  // moves). Re-applied before paint whenever the rendered controls change, so
  // there is no flash of every control being tabbable.
  useLayoutEffect(() => {
    applyRoving(0, getItems());
  }, [children]);

  // Arrow/Home/End move focus AND the roving marker together, computed LOCALLY
  // from the pressed key — never from a lagging state read. Enter/Space are left
  // untouched so the focused control activates natively (a toolbar button's
  // click must not be preventDefault-ed).
  const handleKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!NAV_KEYS.includes(e.key)) return;
    const items = getItems();
    if (items.length === 0) return;
    const current = items.indexOf(e.target as HTMLElement);
    if (current === -1) return;
    e.preventDefault();
    let next = current;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (current + 1) % items.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (current - 1 + items.length) % items.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = items.length - 1;
    applyRoving(next, items);
    items[next].focus();
  };

  // Keep the roving marker on whichever control the user tabs or clicks into,
  // so a subsequent Tab-out/Shift-Tab-back returns to the last-focused control.
  const handleFocus = (e: ReactFocusEvent<HTMLDivElement>) => {
    const items = getItems();
    const idx = items.indexOf(e.target as HTMLElement);
    if (idx === -1) return;
    applyRoving(idx, items);
  };

  return (
    <div
      ref={containerRef}
      id={id}
      className={className}
      role="toolbar"
      aria-label={label}
      onKeyDown={handleKeyDown}
      onFocus={handleFocus}
      style={{
        display: 'flex',
        alignItems: align,
        gap,
        flexWrap: wrap ? 'wrap' : 'nowrap',
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/** Flexible spacer that pushes following Toolbar items to the right. */
export function ToolbarSpacer(): ReactElement {
  return <div style={{ flex: 1 }} aria-hidden="true" />;
}
