import { useState, useCallback } from 'react';

export interface ToggleSetOptions {
  min?: number;  // minimum active items (default 1)
  max?: number;  // maximum active items (default 3)
}

export const UNBOUNDED_TOGGLE_SET_OPTIONS = {
  min: 0,
  max: Number.POSITIVE_INFINITY,
} as const satisfies ToggleSetOptions;

type ToggleSetKey<T extends string | number> = T extends number ? number : string;

/**
 * Shared hook for toggle-set interactions (e.g., chart line selectors).
 * Keeps between `min` and `max` items active at all times.
 */
export function useToggleSet<T extends string | number>(
  defaults: Iterable<T> | (() => Iterable<T>),
  { min = 1, max = 3 }: ToggleSetOptions = {},
): [Set<ToggleSetKey<T>>, (key: ToggleSetKey<T>) => void] {
  const [active, setActive] = useState<Set<ToggleSetKey<T>>>(() =>
    new Set((typeof defaults === 'function' ? defaults() : defaults) as Iterable<ToggleSetKey<T>>),
  );

  const toggle = useCallback((key: ToggleSetKey<T>) => {
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
