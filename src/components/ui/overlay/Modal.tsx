import {
  Children,
  cloneElement,
  isValidElement,
  useEffect,
  useId,
  useRef,
  type HTMLAttributes,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../../lib/utils';
import { prefersReducedMotion } from './reducedMotion';
import {
  getFocusable,
  acquireScrollLock,
  releaseScrollLock,
  isTopmostOverlay,
} from './overlayUtils';

/* ──────────────────────────────────────────────────────────────────────────
 * <Modal> — centered portal dialog with focus trap, escape, outside-click,
 * body-scroll lock, and ARIA dialog semantics.
 *
 * Compound children:
 *   <Modal.Header title onClose?>
 *   <Modal.Body>…</Modal.Body>
 *   <Modal.Footer>…</Modal.Footer>
 *
 * Respects `prefers-reduced-motion` — no fade/scale animation when the user
 * prefers reduced motion.
 * ────────────────────────────────────────────────────────────────────────── */

type ModalSize = 'sm' | 'md' | 'workflow' | 'lg' | 'xl';

const SIZE_MAX_WIDTH: Record<ModalSize, string> = {
  sm: 'max-w-[24rem]',
  md: 'max-w-[32rem]',
  /** Compact editor/workflow shell approved for prototype-led Brand flows. */
  workflow: 'max-w-[42.5rem]',
  lg: 'max-w-[48rem]',
  xl: 'max-w-[64rem]',
};

interface ModalProps {
  open: boolean;
  onClose: () => void;
  size?: ModalSize;
  children: ReactNode;
  /** Optional id override for the header title; defaults to auto-generated. */
  labelledById?: string;
  /** Optional id of supporting copy that describes the dialog. */
  describedById?: string;
}

interface ModalComponent {
  (props: ModalProps): React.ReactElement | null;
  Header: typeof ModalHeader;
  Body: typeof ModalBody;
  Footer: typeof ModalFooter;
}

function ModalInner({
  open,
  onClose,
  size = 'md',
  children,
  labelledById,
  describedById,
}: ModalProps): React.ReactElement | null {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const backdropMouseDownRef = useRef(false);
  const generatedId = useId();
  const titleId = labelledById ?? `modal-title-${generatedId}`;
  const reducedMotion = prefersReducedMotion();

  // Capture the previously focused element once when the modal opens (open: false→true).
  // Must be a separate effect with deps=[open] only so a non-memoized onClose prop
  // passed inline (the most common React pattern) does NOT retrigger this effect
  // while the modal is open — which would overwrite the capture with whatever element
  // is focused inside the modal, causing focus to restore to the wrong target on close.
  useEffect(() => {
    if (!open) return;
    previouslyFocusedRef.current = (document.activeElement as HTMLElement | null) ?? null;
  }, [open]);

  // Escape key + focus trap.
  useEffect(() => {
    if (!open) return;

    const handleKey = (e: KeyboardEvent) => {
      const root = containerRef.current;
      if (!isTopmostOverlay(root)) return;

      if (e.key === 'Escape') {
        // Native listeners for stacked overlays share the document target;
        // stopImmediatePropagation ensures this key closes exactly one layer.
        e.stopImmediatePropagation();
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      if (!root) return;
      e.stopImmediatePropagation();
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
        if (active === last || !root.contains(active)) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', handleKey); // keydown-ok — modal intentionally traps Escape + Tab regardless of focus target
    return () => {
      document.removeEventListener('keydown', handleKey);
    };
  }, [open, onClose]);

  // Initial focus on first focusable, fall back to container.
  useEffect(() => {
    if (!open) return;
    const root = containerRef.current;
    if (!root) return;
    // Defer one frame so children mount.
    const raf = requestAnimationFrame(() => {
      if (!isTopmostOverlay(root)) return;
      const focusables = getFocusable(root);
      if (focusables.length > 0) focusables[0].focus();
      else root.focus();
    });
    return () => cancelAnimationFrame(raf);
  }, [open]);

  // Restore focus on close. Guard with document.contains so we don't
  // call .focus() on an element that was unmounted while the modal was
  // open (common when route changes close the modal) — without the
  // guard, focus would silently move to <body>.
  useEffect(() => {
    if (open) return;
    const prev = previouslyFocusedRef.current;
    if (prev && typeof prev.focus === 'function' && document.contains(prev)) {
      prev.focus();
    }
  }, [open]);

  // Body scroll lock while open — counter-coordinated so stacked modals
  // don't clobber each other's state.
  useEffect(() => {
    if (!open) return;
    acquireScrollLock();
    return () => {
      releaseScrollLock();
    };
  }, [open]);

  if (!open) return null;
  if (typeof document === 'undefined') return null;

  // Track whether mousedown started on the backdrop (not on the panel). Only
  // close on mouseup when both down+up happened on the backdrop — prevents a
  // click that starts inside the panel and drags out from closing the modal.
  const handleBackdropMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    backdropMouseDownRef.current = e.target === e.currentTarget;
  };

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (
      e.target === e.currentTarget
      && backdropMouseDownRef.current
      && isTopmostOverlay(containerRef.current)
    ) {
      onClose();
    }
    backdropMouseDownRef.current = false;
  };

  // Uses the existing @keyframes scaleIn in src/index.css (fade + 0.95→1
  // scale). Prior revision referenced a non-existent `modal-in` keyframe,
  // so the animation was silently a no-op.
  const motionClass = reducedMotion
    ? ''
    : 'motion-safe:animate-[scaleIn_150ms_ease-out]';

  return createPortal(
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      style={{ zIndex: 'var(--z-modal-backdrop)' }}
      onMouseDown={handleBackdropMouseDown}
      onClick={handleBackdropClick}
      data-modal-backdrop="true"
    >
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={describedById}
        tabIndex={-1}
        data-overlay-panel="true"
        style={{ zIndex: 'var(--z-modal)' }}
        className={`relative bg-[var(--surface-2)] border border-[var(--brand-border)] rounded-[var(--radius-lg)] shadow-2xl w-full ${SIZE_MAX_WIDTH[size]} outline-none ${motionClass}`}
      >
        {injectTitleId(children, titleId, Boolean(labelledById))}
      </div>
    </div>,
    document.body,
  );
}

/**
 * Walk immediate children and inject `__titleId` onto the first `Modal.Header`
 * so the auto-generated title id stays aligned with `aria-labelledby`. Consumers
 * who pass an explicit `labelledById` to `<Modal>` are responsible for setting
 * that id on their own title node. If NEITHER is present, `aria-labelledby`
 * would point to a non-existent id and screen readers receive no dialog label.
 * Dev warning surfaces the misconfiguration so it's caught before shipping.
 */
function injectTitleId(
  children: ReactNode,
  id: string,
  hasExplicitLabelledBy: boolean,
): ReactNode {
  let patched = false;
  const result = Children.map(children, (child) => {
    if (!patched && isValidElement(child) && child.type === ModalHeader) {
      patched = true;
      return cloneElement(child as React.ReactElement<ModalHeaderProps>, {
        __titleId: id,
      });
    }
    return child;
  });
  if (!patched && !hasExplicitLabelledBy && process.env.NODE_ENV !== 'production') {
    // eslint-disable-next-line no-console
    console.warn(
      '[Modal] aria-labelledby points to an id with no matching element. ' +
        'Either include a <Modal.Header title="..."/> child (preferred) or ' +
        'pass `labelledById` and set that id on your own title node.',
    );
  }
  return result;
}

interface ModalHeaderProps {
  title: string;
  onClose?: () => void;
  /** @internal wired by <Modal> to tie aria-labelledby to this element. */
  __titleId?: string;
}

function ModalHeader({ title, onClose, __titleId }: ModalHeaderProps): React.ReactElement {
  return (
    <div className="flex items-start justify-between px-6 pt-5 pb-3 border-b border-[var(--brand-border)]">
      <h2 id={__titleId} className="text-[var(--brand-text-bright)] font-semibold text-base leading-snug">
        {title}
      </h2>
      {onClose ? (
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="text-[var(--brand-text)] hover:text-[var(--brand-text-bright)] transition-colors -mr-2 -mt-1 p-2 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
        >
          <svg
            viewBox="0 0 24 24"
            width="18"
            height="18"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </button>
      ) : null}
    </div>
  );
}

function ModalBody({
  children,
  className,
  ...rest
}: HTMLAttributes<HTMLDivElement> & { children: ReactNode }): React.ReactElement {
  return (
    <div className={cn('px-6 py-4 text-[var(--brand-text)] t-body', className)} {...rest}>
      {children}
    </div>
  );
}

function ModalFooter({
  children,
  className,
  ...rest
}: HTMLAttributes<HTMLDivElement> & { children: ReactNode }): React.ReactElement {
  return (
    <div
      className={cn('flex items-center justify-end gap-3 px-6 pt-3 pb-5 border-t border-[var(--brand-border)]', className)}
      {...rest}
    >
      {children}
    </div>
  );
}

export const Modal: ModalComponent = Object.assign(ModalInner, {
  Header: ModalHeader,
  Body: ModalBody,
  Footer: ModalFooter,
});
