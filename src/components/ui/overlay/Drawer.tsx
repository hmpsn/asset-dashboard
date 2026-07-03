// @ds-rebuilt
import {
  useEffect,
  useId,
  useRef,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { prefersReducedMotion } from './reducedMotion';
import { getFocusable, acquireScrollLock, releaseScrollLock } from './overlayUtils';

/**
 * Right-anchored (or left) slide-over panel + scrim. The canonical detail
 * drawer — one width-parameterized replacement for the app's five bespoke
 * drawers. Sticky header (eyebrow/title/subtitle + optional action + close),
 * scrolling body, optional sticky footer. Portal + focus-trap + scroll-lock via
 * ui/overlay/overlayUtils.ts; reduced-motion honored.
 */
export interface DrawerProps {
  open?: boolean;
  onClose?: () => void;
  title?: string;
  subtitle?: string;
  eyebrow?: string;
  /** Panel width — number (px) or CSS string. Default 440. */
  width?: number | string;
  side?: 'right' | 'left';
  footer?: ReactNode;
  headerAction?: ReactNode;
  /** Close when the backdrop/scrim is clicked. Default true. */
  closeOnBackdrop?: boolean;
  children?: ReactNode;
  className?: string;
  id?: string;
  style?: CSSProperties;
}

export function Drawer({
  open = false,
  onClose,
  title,
  subtitle,
  eyebrow,
  width = 440,
  side = 'right',
  footer,
  headerAction,
  closeOnBackdrop = true,
  children,
  className,
  id,
  style,
}: DrawerProps): ReactElement | null {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const backdropMouseDownRef = useRef(false);
  const generatedId = useId();
  const titleId = title ? `drawer-title-${generatedId}` : undefined;
  const reducedMotion = prefersReducedMotion();
  const isRight = side !== 'left';
  const panelWidth = typeof width === 'number' ? `${width}px` : width;

  // Capture the previously focused element once when the drawer opens
  // (open: false→true). Separate effect with deps=[open] only so a
  // non-memoized onClose passed inline doesn't retrigger this while open.
  useEffect(() => {
    if (!open) return;
    previouslyFocusedRef.current = (document.activeElement as HTMLElement | null) ?? null;
  }, [open]);

  // Escape key + focus trap.
  useEffect(() => {
    if (!open) return;

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose?.();
        return;
      }
      if (e.key !== 'Tab') return;
      const root = containerRef.current;
      if (!root) return;
      const focusables = getFocusable(root);
      if (focusables.length === 0) {
        e.preventDefault();
        root.focus();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey) {
        if (active === first || !root.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', handleKey); // keydown-ok — drawer intentionally traps Escape + Tab regardless of focus target
    return () => {
      document.removeEventListener('keydown', handleKey);
    };
  }, [open, onClose]);

  // Initial focus on first focusable, fall back to container.
  useEffect(() => {
    if (!open) return;
    const root = containerRef.current;
    if (!root) return;
    const raf = requestAnimationFrame(() => {
      const focusables = getFocusable(root);
      if (focusables.length > 0) focusables[0].focus();
      else root.focus();
    });
    return () => cancelAnimationFrame(raf);
  }, [open]);

  // Restore focus on close. Guard with document.contains so we don't call
  // .focus() on an element unmounted while the drawer was open.
  useEffect(() => {
    if (open) return;
    const prev = previouslyFocusedRef.current;
    if (prev && typeof prev.focus === 'function' && document.contains(prev)) {
      prev.focus();
    }
  }, [open]);

  // Body scroll lock while open — shared counter with Modal so stacked
  // overlays don't clobber each other's state.
  useEffect(() => {
    if (!open) return;
    acquireScrollLock();
    return () => {
      releaseScrollLock();
    };
  }, [open]);

  if (!open) return null;
  if (typeof document === 'undefined') return null;

  const handleBackdropMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    backdropMouseDownRef.current = e.target === e.currentTarget;
  };

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (closeOnBackdrop && e.target === e.currentTarget && backdropMouseDownRef.current) {
      onClose?.();
    }
    backdropMouseDownRef.current = false;
  };

  const motionClass = reducedMotion ? '' : 'transition-transform motion-safe:duration-[var(--dur-base)] ease-[var(--ease-out)]';

  return createPortal(
    <div
      className="fixed inset-0 bg-[var(--brand-overlay)]"
      style={{ zIndex: 'var(--z-modal-backdrop)' as unknown as number }}
      onMouseDown={handleBackdropMouseDown}
      onClick={handleBackdropClick}
      data-drawer-backdrop="true"
    >
      <div
        ref={containerRef}
        id={id}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        style={{ zIndex: 'var(--z-modal)' as unknown as number, width: panelWidth, ...style }}
        className={cn(
          'fixed top-0 h-full max-w-[94vw] flex flex-col bg-[var(--surface-2)] shadow-[var(--shadow-lg)] outline-none',
          isRight ? 'right-0 border-l border-[var(--brand-border-hover)]' : 'left-0 border-r border-[var(--brand-border-hover)]',
          motionClass,
          className,
        )}
      >
        {(title || eyebrow || headerAction) && (
          <header className="flex items-start gap-3 flex-shrink-0 px-5 pt-4 pb-4 border-b border-[var(--brand-border)]">
            <div className="min-w-0 flex-1">
              {eyebrow && (
                <div className="t-micro text-[var(--brand-text-dim)] mb-1.5">{eyebrow}</div>
              )}
              {title && (
                <h2 id={titleId} className="t-h2 text-[var(--brand-text-bright)]">
                  {title}
                </h2>
              )}
              {subtitle && <div className="t-caption text-[var(--brand-text-muted)] mt-1">{subtitle}</div>}
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {headerAction}
              {onClose && (
                <button
                  type="button"
                  aria-label="Close"
                  onClick={onClose}
                  className="w-[30px] h-[30px] rounded-[var(--radius-md)] border-none cursor-pointer bg-[var(--surface-3)] text-[var(--brand-text-dim)] flex items-center justify-center hover:text-[var(--brand-text-bright)] hover:bg-[var(--surface-active)] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--teal)]"
                >
                  <X size={16} aria-hidden="true" />
                </button>
              )}
            </div>
          </header>
        )}
        <div className="flex-1 overflow-y-auto px-5 py-5 t-body text-[var(--brand-text)]">{children}</div>
        {footer && (
          <footer className="flex-shrink-0 flex items-center gap-2 px-5 py-3.5 border-t border-[var(--brand-border)]">
            {footer}
          </footer>
        )}
      </div>
    </div>,
    document.body,
  );
}
