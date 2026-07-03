// @ds-rebuilt
import { useLayoutEffect, useRef, useState } from 'react';
import type {
  CSSProperties,
  FocusEvent as ReactFocusEvent,
  KeyboardEvent as ReactKeyboardEvent,
  ReactElement,
  ReactNode,
} from 'react';
import { useRovingTabindex } from '../useRovingTabindex';

/**
 * Controls row above tables/boards/lists. A wrapping flex row on one spacing
 * rhythm; separate left controls (search/filters/lens) from right actions with
 * a `<ToolbarSpacer/>`. role="toolbar" + arrow-key focus movement between
 * controls (useRovingTabindex).
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

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]';

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
  const itemsRef = useRef<HTMLElement[]>([]);
  const [itemCount, setItemCount] = useState(0);
  const roving = useRovingTabindex(itemCount);

  // Re-scan the focusable descendants whenever the rendered controls change.
  // Runs before paint so tabIndex is correct on first render (no flash of
  // every control being tabbable).
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const items = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
    itemsRef.current = items;
    setItemCount(items.length);
    items.forEach((el, index) => {
      const itemProps = roving.getItemProps(index);
      el.tabIndex = itemProps.tabIndex;
      itemProps.ref(el);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-scan on children only; roving.getItemProps is recreated each render and including it would loop
  }, [children]);

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const items = itemsRef.current;
    if (items.length === 0) return;
    const target = event.target as HTMLElement;
    const index = items.indexOf(target);
    if (index === -1) return;
    roving.getItemProps(index).onKeyDown(event);
    const nextIndex = roving.activeIndex;
    items.forEach((el, i) => {
      el.tabIndex = i === nextIndex ? 0 : -1;
    });
  };

  const handleFocus = (event: ReactFocusEvent<HTMLDivElement>) => {
    const items = itemsRef.current;
    const index = items.indexOf(event.target as HTMLElement);
    if (index === -1) return;
    roving.getItemProps(index).onFocus();
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
