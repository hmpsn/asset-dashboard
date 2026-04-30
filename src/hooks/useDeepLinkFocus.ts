import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * Field-level deep-linking contract.
 *
 * When the URL has `?focus=<fieldId>`, this hook locates an element with
 * `data-schema-deeplink={fieldId}`, scrolls it into view, focuses it (if
 * focusable), and clears the `?focus=` param. If no match is found, the
 * param stays so a downstream component can handle it.
 *
 * Usage:
 *   1. In the receiving tab/component, call `useDeepLinkFocus()` once.
 *   2. On each schema-relevant input or row, add `data-schema-deeplink="<fieldId>"`.
 *   3. Senders link with `?tab=<tab>&focus=<fieldId>`.
 *
 * Two-halves contract: senders without receivers, or receivers without
 * senders, are silently ignored.
 */
export function useDeepLinkFocus(): void {
  const [searchParams, setSearchParams] = useSearchParams();
  const focus = searchParams.get('focus');

  useEffect(() => {
    if (!focus) return;
    // Allow one tick for the DOM to render after navigation
    const timer = setTimeout(() => {
      const el = document.querySelector<HTMLElement>(`[data-schema-deeplink="${CSS.escape(focus)}"]`);
      if (!el) return; // no match — leave param for another receiver

      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // If focusable, focus it
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
        el.focus({ preventScroll: true });
      } else if (el.tabIndex >= 0) {
        el.focus({ preventScroll: true });
      }

      // Clear the `focus` param so re-renders don't re-trigger. Using the
      // functional setter form reads CURRENT params from React Router (not the
      // effect-time closure), so any params added by other code during the 50ms
      // debounce window are preserved. (Devin Review INFO-0001 on PR #379.)
      setSearchParams(prev => {
        const next = new URLSearchParams(prev);
        next.delete('focus');
        return next;
      }, { replace: true });
    }, 50);

    return () => clearTimeout(timer);
  }, [focus, setSearchParams]);
}
