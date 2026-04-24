import {
  Children,
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactElement,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../../lib/utils';

/* ──────────────────────────────────────────────────────────────────────────
 * <Popover> — a lightweight menu overlay with outside-click + escape dismissal,
 * keyboard arrow navigation, and roving focus.
 *
 * Compound children:
 *   <Popover.Item onClick danger?>…</Popover.Item>
 *   <Popover.Separator />
 * ────────────────────────────────────────────────────────────────────────── */

export type PopoverPlacement =
  | 'bottom-start'
  | 'bottom-end'
  | 'top-start'
  | 'top-end'
  | 'bottom'
  | 'top'
  | 'right'
  | 'left';

interface PopoverProps {
  trigger: ReactElement;
  placement?: PopoverPlacement;
  closeOnSelect?: boolean;
  children: ReactNode;
  /** Offset in px from the trigger. Defaults to 8. */
  offset?: number;
}

interface PopoverComponent {
  (props: PopoverProps): React.ReactElement | null;
  Item: typeof PopoverItem;
  Separator: typeof PopoverSeparator;
}

interface PositionRect {
  top: number;
  left: number;
}

function computePosition(
  triggerRect: DOMRect,
  menuRect: DOMRect,
  placement: PopoverPlacement,
  offset: number,
): PositionRect {
  let top = 0;
  let left = 0;
  switch (placement) {
    case 'bottom':
      top = triggerRect.bottom + offset;
      left = triggerRect.left + triggerRect.width / 2 - menuRect.width / 2;
      break;
    case 'bottom-start':
      top = triggerRect.bottom + offset;
      left = triggerRect.left;
      break;
    case 'bottom-end':
      top = triggerRect.bottom + offset;
      left = triggerRect.right - menuRect.width;
      break;
    case 'top':
      top = triggerRect.top - menuRect.height - offset;
      left = triggerRect.left + triggerRect.width / 2 - menuRect.width / 2;
      break;
    case 'top-start':
      top = triggerRect.top - menuRect.height - offset;
      left = triggerRect.left;
      break;
    case 'top-end':
      top = triggerRect.top - menuRect.height - offset;
      left = triggerRect.right - menuRect.width;
      break;
    case 'right':
      top = triggerRect.top + triggerRect.height / 2 - menuRect.height / 2;
      left = triggerRect.right + offset;
      break;
    case 'left':
      top = triggerRect.top + triggerRect.height / 2 - menuRect.height / 2;
      left = triggerRect.left - menuRect.width - offset;
      break;
  }
  // Viewport clamp.
  if (typeof window !== 'undefined') {
    const pad = 4;
    const maxLeft = window.innerWidth - menuRect.width - pad;
    const maxTop = window.innerHeight - menuRect.height - pad;
    if (left < pad) left = pad;
    if (left > maxLeft) left = Math.max(pad, maxLeft);
    if (top < pad) top = pad;
    if (top > maxTop) top = Math.max(pad, maxTop);
  }
  return { top, left };
}

/* ── Item + Separator ────────────────────────────────────────────────── */

interface PopoverItemProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  onClick?: () => void;
  danger?: boolean;
  children: ReactNode;
  /** @internal wired by <Popover>. */
  __popoverClose?: () => void;
  /** @internal wired by <Popover>. */
  __closeOnSelect?: boolean;
  /** @internal wired by <Popover>. */
  __itemIndex?: number;
  /** @internal wired by <Popover>. */
  __registerItem?: (index: number, el: HTMLButtonElement | null) => void;
}

function PopoverItem({
  onClick,
  danger = false,
  children,
  __popoverClose,
  __closeOnSelect,
  __itemIndex,
  __registerItem,
  className,
  ...rest
}: PopoverItemProps): React.ReactElement {
  const baseClass = danger
    ? 'text-red-400 hover:bg-red-500/10'
    : 'text-zinc-200 hover:bg-zinc-800';
  const handleClick = () => {
    onClick?.();
    if (__closeOnSelect && __popoverClose) __popoverClose();
  };
  return (
    <button
      ref={(el) => __registerItem?.(__itemIndex ?? 0, el)}
      type="button"
      role="menuitem"
      tabIndex={-1}
      onClick={handleClick}
      className={cn(baseClass, 'px-3 py-1.5 text-sm w-full text-left focus:outline-none focus:bg-zinc-800', className)}
      {...rest}
    >
      {children}
    </button>
  );
}

function PopoverSeparator(): React.ReactElement {
  return <div role="separator" className="border-t border-zinc-800 my-1" />;
}

/* ── Popover shell ───────────────────────────────────────────────────── */

function PopoverInner({
  trigger,
  placement = 'bottom-start',
  closeOnSelect = true,
  offset = 8,
  children,
}: PopoverProps): React.ReactElement | null {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<PositionRect>({ top: -9999, left: -9999 });
  const triggerRef = useRef<HTMLElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const menuId = useId();
  const closeRef = useRef<(() => void) | null>(null);

  const close = useCallback(() => {
    setOpen(false);
    // Restore focus to the trigger.
    if (triggerRef.current && typeof triggerRef.current.focus === 'function') {
      triggerRef.current.focus();
    }
  }, []);
  closeRef.current = close;

  // Position after open (layout effect so the menu is measured before paint).
  useLayoutEffect(() => {
    if (!open) return;
    const tEl = triggerRef.current;
    const mEl = menuRef.current;
    if (!tEl || !mEl) return;
    const tRect = tEl.getBoundingClientRect();
    const mRect = mEl.getBoundingClientRect();
    setPosition(computePosition(tRect, mRect, placement, offset));
  }, [open, placement, offset]);

  // Reposition on scroll/resize.
  useEffect(() => {
    if (!open) return;
    const reflow = () => {
      const tEl = triggerRef.current;
      const mEl = menuRef.current;
      if (!tEl || !mEl) return;
      setPosition(computePosition(tEl.getBoundingClientRect(), mEl.getBoundingClientRect(), placement, offset));
    };
    window.addEventListener('scroll', reflow, true);
    window.addEventListener('resize', reflow);
    return () => {
      window.removeEventListener('scroll', reflow, true);
      window.removeEventListener('resize', reflow);
    };
  }, [open, placement, offset]);

  // Outside click + Escape + arrow nav.
  useEffect(() => {
    if (!open) return;
    const handlePointer = (e: MouseEvent) => {
      const target = e.target as Node;
      if (menuRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      close();
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
        return;
      }
      const items = itemRefs.current.filter((el): el is HTMLButtonElement => !!el);
      if (items.length === 0) return;
      const activeIdx = items.findIndex((el) => el === document.activeElement);
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const next = items[(activeIdx + 1 + items.length) % items.length] ?? items[0];
        next.focus();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        // When nothing is focused (activeIdx === -1), land on the last item.
        // The naive modular arithmetic gives (−1 − 1 + N) % N = N−2, which is off by one.
        const prev = activeIdx <= 0 ? items[items.length - 1] : items[activeIdx - 1];
        prev.focus();
      } else if (e.key === 'Home') {
        e.preventDefault();
        items[0].focus();
      } else if (e.key === 'End') {
        e.preventDefault();
        items[items.length - 1].focus();
      }
    };
    document.addEventListener('mousedown', handlePointer);
    document.addEventListener('keydown', handleKey); // keydown-ok — popover intentionally handles Escape/Arrow globally while open
    return () => {
      document.removeEventListener('mousedown', handlePointer);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open, close]);

  // Focus first item on open (next tick for the menu to be in the DOM).
  useEffect(() => {
    if (!open) return;
    const raf = requestAnimationFrame(() => {
      const first = itemRefs.current.find((el): el is HTMLButtonElement => !!el);
      first?.focus();
    });
    return () => cancelAnimationFrame(raf);
  }, [open]);

  const registerItem = useCallback((index: number, el: HTMLButtonElement | null) => {
    itemRefs.current[index] = el;
  }, []);

  // Clone children to inject internal wiring.
  const wiredChildren = useMemo(() => {
    let itemIndex = 0;
    return Children.map(children, (child) => {
      if (!isValidElement(child)) return child;
      if (child.type === PopoverItem) {
        const idx = itemIndex++;
        return cloneElement(child as ReactElement<PopoverItemProps>, {
          __popoverClose: closeRef.current ?? (() => {}),
          __closeOnSelect: closeOnSelect,
          __itemIndex: idx,
          __registerItem: registerItem,
        });
      }
      return child;
    });
  }, [children, closeOnSelect, registerItem]);

  // Reset registered items when children change length.
  useEffect(() => {
    itemRefs.current = itemRefs.current.slice(0, Children.count(children));
  }, [children]);

  // Clone trigger to add ref, onClick toggle, and ARIA.
  if (!isValidElement(trigger)) {
    throw new Error('Popover requires a single React element as `trigger`.');
  }

  type TriggerExtraProps = {
    ref: (el: HTMLElement | null) => void;
    onClick: (e: React.MouseEvent) => void;
    'aria-haspopup': 'menu';
    'aria-expanded': boolean;
    'aria-controls'?: string;
  };
  const triggerProps = trigger.props as {
    onClick?: (e: React.MouseEvent) => void;
    ref?: React.Ref<HTMLElement>;
  };
  const existingOnClick = triggerProps.onClick;
  const clonedTrigger = cloneElement(trigger as ReactElement, {
    ref: (el: HTMLElement | null) => {
      triggerRef.current = el;
      // Forward ref if the original trigger had one (callback form only).
      const origRef = triggerProps.ref;
      if (typeof origRef === 'function') origRef(el);
      else if (origRef && typeof origRef === 'object' && 'current' in origRef) {
        (origRef as React.MutableRefObject<HTMLElement | null>).current = el;
      }
    },
    onClick: (e: React.MouseEvent) => {
      existingOnClick?.(e);
      setOpen((v) => !v);
    },
    'aria-haspopup': 'menu',
    'aria-expanded': open,
    'aria-controls': open ? menuId : undefined,
  } as TriggerExtraProps);

  return (
    <>
      {clonedTrigger}
      {open && typeof document !== 'undefined'
        ? createPortal(
            <div
              id={menuId}
              ref={menuRef}
              role="menu"
              aria-orientation="vertical"
              data-popover-menu="true"
              style={{
                position: 'fixed',
                top: position.top,
                left: position.left,
                zIndex: 'var(--z-dropdown)' as unknown as number,
              }}
              className="min-w-[10rem] bg-zinc-900 border border-zinc-800 rounded-lg shadow-xl py-1"
            >
              {wiredChildren}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

export const Popover: PopoverComponent = Object.assign(PopoverInner, {
  Item: PopoverItem,
  Separator: PopoverSeparator,
});
