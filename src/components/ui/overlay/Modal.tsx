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

// ─── Body-scroll lock coordination across stacked modals ──────────────────
// Simple reference counter: each open modal increments; each close
// decrements. The lock is applied only when the counter transitions 0→1
// and released only when it transitions 1→0. Prevents the "outer modal
// closes → scroll re-enabled while inner modal still open" bug and the
// inverse where the inner modal's cleanup leaves the body permanently
// locked.
let activeModalCount = 0;
let originalBodyOverflow = '';

function acquireScrollLock(): void {
  if (typeof document === 'undefined') return;
  if (activeModalCount === 0) {
    originalBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  activeModalCount++;
}

function releaseScrollLock(): void {
  if (typeof document === 'undefined') return;
  activeModalCount = Math.max(0, activeModalCount - 1);
  if (activeModalCount === 0) {
    document.body.style.overflow = originalBodyOverflow;
  }
}

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

type ModalSize = 'sm' | 'md' | 'lg' | 'xl';

const SIZE_MAX_WIDTH: Record<ModalSize, string> = {
  sm: 'max-w-[24rem]',
  md: 'max-w-[32rem]',
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
}

interface ModalComponent {
  (props: ModalProps): React.ReactElement | null;
  Header: typeof ModalHeader;
  Body: typeof ModalBody;
  Footer: typeof ModalFooter;
}

/** Selector matching every element that can receive keyboard focus. */
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'iframe',
  'object',
  'embed',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
].join(',');

function getFocusable(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => !el.hasAttribute('disabled') && el.tabIndex !== -1,
  );
}

function ModalInner({
  open,
  onClose,
  size = 'md',
  children,
  labelledById,
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
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
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
    if (e.target === e.currentTarget && backdropMouseDownRef.current) {
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
        tabIndex={-1}
        style={{ zIndex: 'var(--z-modal)' }}
        className={`relative bg-zinc-900 border border-zinc-800 rounded-lg shadow-2xl w-full ${SIZE_MAX_WIDTH[size]} outline-none ${motionClass}`}
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
    <div className="flex items-start justify-between px-6 pt-5 pb-3 border-b border-zinc-800">
      <h2 id={__titleId} className="text-zinc-100 font-semibold text-base leading-snug">
        {title}
      </h2>
      {onClose ? (
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="text-zinc-400 hover:text-zinc-200 transition-colors -mr-2 -mt-1 p-2 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
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
    <div className={cn('px-6 py-4 text-zinc-300 text-sm leading-relaxed', className)} {...rest}>
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
      className={cn('flex items-center justify-end gap-3 px-6 pt-3 pb-5 border-t border-zinc-800', className)}
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
