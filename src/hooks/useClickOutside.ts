import { useEffect } from 'react';

/**
 * Adds a document `mousedown` listener that calls `onOutside` whenever the
 * event target falls outside the element bound to `ref`. The listener is only
 * active when `active` is not `false` (default: active).
 */
export function useClickOutside<T extends HTMLElement>(
  ref: React.RefObject<T | null>,
  onOutside: () => void,
  active?: boolean,
): void {
  useEffect(() => {
    if (active === false) return;

    const handleMouseDown = (event: MouseEvent) => {
      const el = ref.current;
      if (!el) return;
      if (el.contains(event.target as Node)) return;
      onOutside();
    };

    document.addEventListener('mousedown', handleMouseDown);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
    };
  }, [ref, onOutside, active]);
}
