import { useState, useCallback } from 'react';

interface ToggleSetOptions {
  min?: number;  // minimum active items (default 1)
  max?: number;  // maximum active items (default 3)
}

/**
 * Shared hook for toggle-set interactions (e.g., chart line selectors).
 * Keeps between `min` and `max` items active at all times.
 */
export function useToggleSet(
  defaults: string[],
  { min = 1, max = 3 }: ToggleSetOptions = {},
): [Set<string>, (key: string) => void] {
  const [active, setActive] = useState<Set<string>>(() => new Set(defaults));

  const toggle = useCallback((key: string) => {
    setActive(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        if (next.size > min) next.delete(key);
      } else if (next.size < max) {
        next.add(key);
      }
      return next;
    });
  }, [min, max]);

  return [active, toggle];
}
