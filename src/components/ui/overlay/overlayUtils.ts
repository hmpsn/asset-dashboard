// @ds-rebuilt
// ─── Shared overlay machinery ─────────────────────────────────────────────────
// Focus-trap querying + body-scroll-lock coordination, extracted from Modal.tsx
// (F3.0.3) so every portal overlay — Modal, Drawer, and future takeovers —
// shares ONE implementation and ONE scroll-lock counter. Do NOT hand-roll a
// second focus trap or scroll lock; import from here.
//
// Placed directly under ui/overlay/ (NOT ui/internal/) so the `ds-deep-import`
// rule does not fire on consumers.

/** Selector matching every element that can receive keyboard focus. */
export const FOCUSABLE_SELECTOR = [
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

/** All keyboard-focusable descendants of `root`, in DOM order. */
export function getFocusable(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => !el.hasAttribute('disabled') && el.tabIndex !== -1,
  );
}

// ─── Body-scroll lock coordination across stacked overlays ────────────────────
// Simple reference counter: each open overlay increments; each close
// decrements. The lock is applied only when the counter transitions 0→1 and
// released only when it transitions 1→0. Prevents the "outer overlay closes →
// scroll re-enabled while inner overlay still open" bug and the inverse where
// an inner overlay's cleanup leaves the body permanently locked. The counter is
// module-shared, so a Modal stacked over a Drawer (or vice versa) coordinates
// correctly.
let activeOverlayCount = 0;
let originalBodyOverflow = '';

export function acquireScrollLock(): void {
  if (typeof document === 'undefined') return;
  if (activeOverlayCount === 0) {
    originalBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  activeOverlayCount++;
}

export function releaseScrollLock(): void {
  if (typeof document === 'undefined') return;
  activeOverlayCount = Math.max(0, activeOverlayCount - 1);
  if (activeOverlayCount === 0) {
    document.body.style.overflow = originalBodyOverflow;
  }
}
