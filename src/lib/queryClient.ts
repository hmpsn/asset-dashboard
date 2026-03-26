import { QueryClient } from '@tanstack/react-query';

/** Stale time constants — pick the right tier for each query. */
export const STALE_TIMES = {
  /** Rarely-changing config: health, workspace list, publish targets. */
  STABLE: 5 * 60_000,
  /** Default — most dashboard data (analytics, audit, activity). */
  NORMAL: 60_000,
  /** Frequently-changing state: queue, SEO editor pages. */
  FAST: 30_000,
  /** Always revalidate on access (use sparingly). */
  REALTIME: 0,
} as const;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: STALE_TIMES.NORMAL,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: true,
      retry: 1,
    },
  },
});
