import { useQuery } from '@tanstack/react-query';
import { getPathStats } from '../../api/client';
import { useRegion } from '../../hooks/useRegion';
import { RANGE_MS, type StatsRange } from './types';

export function usePathStats(range: StatsRange) {
  const { iatas, regionKey } = useRegion();
  return useQuery({
    queryKey: ['stats-paths', regionKey, range],
    enabled: regionKey !== null,
    queryFn: ({ signal }) => {
      // Unreachable while pending: a null regionKey keeps the query disabled.
      // Shared minute boundaries let viewers reuse server aggregates without changing the key every render.
      const until = Math.floor(Date.now() / 60_000) * 60_000;
      return getPathStats(until - RANGE_MS[range], until, iatas ?? undefined, signal);
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
    retry: false,
  });
}
