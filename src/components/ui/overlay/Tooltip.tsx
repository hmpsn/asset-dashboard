import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../../lib/utils';
import { prefersReducedMotion } from './reducedMotion';

/* ──────────────────────────────────────────────────────────────────────────
 * <Tooltip> — hover-triggered description positioned relative to a trigger
 * child. Shows on mouseenter + focus, hides on mouseleave + blur.
 *
 *   <Tooltip content="Hello" placement?="top|bottom|left|right" delay?={ms}>
 *     <button>Hover me</button>
 *   </Tooltip>
 *
 * ARIA: the tooltip element has role="tooltip" and is linked to the trigger
 * via aria-describedby while visible. Respects prefers-reduced-motion.
 * ────────────────────────────────────────────────────────────────────────── */

export type TooltipPlacement = 'top' | 'bottom' | 'left' | 'right';

interface TooltipProps {
  content: ReactNode;
  placement?: TooltipPlacement;
  /** Delay (ms) before showing on hover. Focus shows instantly. Defaults to 500. */
  delay?: number;
  children: ReactElement;
}

interface TooltipPosition {
  top: number;
  left: number;
}

const GAP = 6;

function computeTooltipPosition(
  triggerRect: DOMRect,
  tipRect: DOMRect,
  placement: TooltipPlacement,
): TooltipPosition {
  let top = 0;
  let left = 0;
  switch (placement) {
    case 'top':
      top = triggerRect.top - tipRect.height - GAP;
      left = triggerRect.left + triggerRect.width / 2 - tipRect.width / 2;
      break;
    case 'bottom':
      top = triggerRect.bottom + GAP;
      left = triggerRect.left + triggerRect.width / 2 - tipRect.width / 2;
      break;
    case 'left':
      top = triggerRect.top + triggerRect.height / 2 - tipRect.height / 2;
      left = triggerRect.left - tipRect.width - GAP;
      break;
    case 'right':
      top = triggerRect.top + triggerRect.height / 2 - tipRect.height / 2;
      left = triggerRect.right + GAP;
      break;
  }
  if (typeof window !== 'undefined') {
    const pad = 4;
    const maxLeft = window.innerWidth - tipRect.width - pad;
    const maxTop = window.innerHeight - tipRect.height - pad;
    if (left < pad) left = pad;
    if (left > maxLeft) left = Math.max(pad, maxLeft);
    if (top < pad) top = pad;
    if (top > maxTop) top = Math.max(pad, maxTop);
  }
  return { top, left };
}

export function Tooltip({
  content,
  placement = 'top',
  delay = 500,
  children,
}: TooltipProps): React.ReactElement {
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState<TooltipPosition>({ top: -9999, left: -9999 });
  const triggerRef = useRef<HTMLElement | null>(null);
  const tipRef = useRef<HTMLDivElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tipId = useId();
  const reducedMotion = prefersReducedMotion();

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const show = useCallback(
    (instant: boolean) => {
      clearTimer();
      if (instant || delay <= 0) {
        setVisible(true);
      } else {
        timerRef.current = setTimeout(() => setVisible(true), delay);
      }
    },
    [clearTimer, delay],
  );

  const hide = useCallback(() => {
    clearTimer();
    setVisible(false);
  }, [clearTimer]);

  useEffect(() => clearTimer, [clearTimer]);

  useLayoutEffect(() => {
    if (!visible) return;
    const tEl = triggerRef.current;
    const tipEl = tipRef.current;
    if (!tEl || !tipEl) return;
    setPosition(
      computeTooltipPosition(tEl.getBoundingClientRect(), tipEl.getBoundingClientRect(), placement),
    );
  }, [visible, placement, content]);

  if (!isValidElement(children)) {
    throw new Error('Tooltip requires a single React element as its child.');
  }

  type ChildProps = {
    onMouseEnter?: (e: React.MouseEvent) => void;
    onMouseLeave?: (e: React.MouseEvent) => void;
    onFocus?: (e: React.FocusEvent) => void;
    onBlur?: (e: React.FocusEvent) => void;
    ref?: React.Ref<HTMLElement>;
    'aria-describedby'?: string;
  };
  const originalProps = (children.props ?? {}) as ChildProps;

  const clonedChild = cloneElement(children as ReactElement, {
    ref: (el: HTMLElement | null) => {
      triggerRef.current = el;
      const origRef = originalProps.ref;
      if (typeof origRef === 'function') origRef(el);
      else if (origRef && typeof origRef === 'object' && 'current' in origRef) {
        (origRef as React.MutableRefObject<HTMLElement | null>).current = el;
      }
    },
    onMouseEnter: (e: React.MouseEvent) => {
      originalProps.onMouseEnter?.(e);
      show(false);
    },
    onMouseLeave: (e: React.MouseEvent) => {
      originalProps.onMouseLeave?.(e);
      hide();
    },
    onFocus: (e: React.FocusEvent) => {
      originalProps.onFocus?.(e);
      show(true);
    },
    onBlur: (e: React.FocusEvent) => {
      originalProps.onBlur?.(e);
      hide();
    },
    'aria-describedby': visible
      ? [originalProps['aria-describedby'], tipId].filter(Boolean).join(' ')
      : originalProps['aria-describedby'],
  } as ChildProps);

  const motionClass = reducedMotion ? '' : 'transition-opacity duration-150';

  // Portal to document.body so ancestors with transform/filter/contain do not create
  // a new stacking context that would break position:fixed relative to the viewport.
  // The id on the portaled element is still linked to the trigger via aria-describedby.
  const tooltipNode =
    visible && typeof document !== 'undefined'
      ? createPortal(
          <div
            id={tipId}
            ref={tipRef}
            role="tooltip"
            data-tooltip="true"
            style={{
              position: 'fixed',
              top: position.top,
              left: position.left,
              zIndex: 'var(--z-tooltip)' as unknown as number,
              pointerEvents: 'none',
            }}
            className={cn('bg-zinc-950 text-zinc-100 text-xs px-2 py-1 rounded shadow-lg max-w-xs', motionClass)}
          >
            {content}
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      {clonedChild}
      {tooltipNode}
    </>
  );
}
