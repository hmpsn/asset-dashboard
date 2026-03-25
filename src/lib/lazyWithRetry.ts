import { lazy, type ComponentType } from 'react';

/**
 * Wraps React.lazy() to handle stale chunk errors after deploys.
 *
 * When Vite rebuilds, chunk filenames change (content hashing). If a user's
 * browser still has the old HTML cached, dynamic imports will 404. This wrapper
 * catches that error and does a single hard reload to fetch the new HTML.
 *
 * A sessionStorage flag prevents infinite reload loops.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyWithRetry<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
): React.LazyExoticComponent<T> {
  return lazy(async () => {
    const KEY = 'chunk-reload-retried';
    try {
      const component = await factory();
      // Success — clear any previous retry flag
      sessionStorage.removeItem(KEY);
      return component;
    } catch (err) {
      // Only retry once per session to avoid infinite loops
      if (!sessionStorage.getItem(KEY)) {
        sessionStorage.setItem(KEY, '1');
        window.location.reload();
        // Return a never-resolving promise so React doesn't render the error
        return new Promise(() => {});
      }
      // Already retried once — let the error propagate to ErrorBoundary
      throw err;
    }
  });
}
