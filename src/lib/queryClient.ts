import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,       // Data considered fresh for 60s (matches old TTL)
      gcTime: 5 * 60_000,     // Keep unused data in cache for 5 minutes
      refetchOnWindowFocus: true,
      retry: 1,
    },
  },
});
