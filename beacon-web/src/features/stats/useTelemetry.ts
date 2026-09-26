import { useQuery } from '@tanstack/react-query';
import { observerQueries, telemetryQueries } from '../../api/queries';
import { getObserverActivity, isNotFound } from '../../api/client';
import { keepPreviousData } from '@tanstack/react-query';
import type { StatsRange } from './types';

export function useObserver(observerId: string | null) {
  return useQuery({ ...observerQueries.detail(observerId ?? ''), enabled: !!observerId });
}

// Bucket per range: a quiet hour stays visible at 24h, the longer windows stay under ~200 points.
const ACTIVITY_INTERVAL: Record<StatsRange, string> = {
  '24h': '15m',
  '7d': '1h',
  '30d': '6h',
};

export function activityParamsFor(range: StatsRange): { range: string; interval: string } {
  return {
    range: { '24h': '24h', '7d': '168h', '30d': '720h' }[range],
    interval: ACTIVITY_INTERVAL[range],
  };
}

// Heard activity moves with packets, so poll; stop once a 404 says this server has no endpoint.
export function activityRefetchInterval(error: unknown): number | false {
  return isNotFound(error) ? false : 60_000;
}

export function useObserverActivity(observerId: string | null, range: StatsRange) {
  const params = activityParamsFor(range);
  return useQuery({
    queryKey: ['observer-activity', observerId, range],
    queryFn: () => getObserverActivity(observerId!, params.range, params.interval),
    enabled: !!observerId,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
    refetchInterval: (query) => activityRefetchInterval(query.state.error),
  });
}

export function useObserverTelemetry(observerId: string | null, range: StatsRange) {
  return useQuery(telemetryQueries.range(observerId ?? '', range));
}
