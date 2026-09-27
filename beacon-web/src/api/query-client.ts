import { shouldRetryQuery } from './rate-limit';
import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: shouldRetryQuery,
      refetchOnWindowFocus: false,
      // Preserve route caches long enough for normal tab navigation. Individual live query families
      // still control freshness through WebSocket invalidation and their explicit stale times.
      gcTime: 30 * 60_000,
    },
  },
});
