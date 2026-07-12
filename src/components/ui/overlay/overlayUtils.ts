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

// ─── Stacked-overlay coordination ────────────────────────────────────────────
// Portal overlays share the same z-index layer, so DOM order is also their
// visual stacking order. Keyboard and backdrop handlers must yield to the last
// connected panel; stopPropagation alone is insufficient because Modal and
// Drawer attach native listeners to the same `document` target.
export const OVERLAY_PANEL_SELECTOR = '[data-overlay-panel="true"]';

/** Whether `root` is the visually topmost open canonical overlay panel. */
export function isTopmostOverlay(root: HTMLElement | null): boolean {
  if (!root || typeof document === 'undefined' || !root.isConnected) return false;
  const panels = document.querySelectorAll<HTMLElement>(OVERLAY_PANEL_SELECTOR);
  return panels.length > 0 && panels[panels.length - 1] === root;
}

/** Whether `element` belongs to the visually topmost canonical overlay panel. */
export function isElementInTopmostOverlay(element: Element | null): boolean {
  if (!element || typeof document === 'undefined' || !element.isConnected) return false;
  const containingPanel = element.closest<HTMLElement>(OVERLAY_PANEL_SELECTOR);
  return isTopmostOverlay(containingPanel);
}

type OverlayStackListener = () => void;

const overlayStackListeners = new Set<OverlayStackListener>();
let overlayStackObserver: MutationObserver | null = null;

function nodeContainsOverlayPanel(node: Node): boolean {
  if (!(node instanceof Element)) return false;
  return node.matches(OVERLAY_PANEL_SELECTOR) || node.querySelector(OVERLAY_PANEL_SELECTOR) !== null;
}

function mutationChangesOverlayStack(mutation: MutationRecord): boolean {
  return Array.from(mutation.addedNodes).some(nodeContainsOverlayPanel)
    || Array.from(mutation.removedNodes).some(nodeContainsOverlayPanel);
}

function notifyOverlayStackListeners(): void {
  for (const listener of [...overlayStackListeners]) listener();
}

function startOverlayStackObserver(): void {
  if (
    overlayStackObserver
    || typeof document === 'undefined'
    || !document.body
    || typeof MutationObserver === 'undefined'
  ) return;

  overlayStackObserver = new MutationObserver((mutations) => {
    if (mutations.some(mutationChangesOverlayStack)) notifyOverlayStackListeners();
  });
  overlayStackObserver.observe(document.body, { childList: true, subtree: true });
}

function stopOverlayStackObserver(): void {
  if (overlayStackListeners.size > 0) return;
  overlayStackObserver?.disconnect();
  overlayStackObserver = null;
}

/** Subscribe while a consumer needs to react to canonical overlay membership/order changes. */
export function subscribeToOverlayStack(listener: OverlayStackListener): () => void {
  overlayStackListeners.add(listener);
  startOverlayStackObserver();
  return () => {
    overlayStackListeners.delete(listener);
    stopOverlayStackObserver();
  };
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
