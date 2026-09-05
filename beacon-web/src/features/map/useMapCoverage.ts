import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { coverageQueries } from '../../api/queries';
import type { CoverageResponse } from './coverage';

async function fetchCoverage(
  bbox: [number, number, number, number] | null,
): Promise<CoverageResponse> {
  if (!bbox) throw new Error('coverage requires a bbox');
  return coverageQueries.fetch(bbox);
}

// Coverage grid for the current map viewport. The bbox snaps outward to 0.5°
// steps so small pans reuse the React Query cache instead of refetching per
// pixel. Server caps at 20k cells/response, so a country-wide zoom still
// renders fast; zooming in narrows the box and shows full detail. Refetches at
// most every 15 min (staleTime) mirroring the upstream cache; disabled responses
// (no key configured) resolve to null data, not an error state.
export function useMapCoverage(
  viewportBbox: [number, number, number, number] | null,
  enabled: boolean,
) {
  const key = useMemo(() => {
    if (!viewportBbox) return null;
    const r = (v: number) => Math.floor(v * 2) / 2 - 0.25;
    const c = (v: number) => Math.ceil(v * 2) / 2 + 0.25;
    return [r(viewportBbox[0]), r(viewportBbox[1]), c(viewportBbox[2]), c(viewportBbox[3])] as [
      number,
      number,
      number,
      number,
    ];
  }, [viewportBbox]);
  const query = useQuery({
    queryKey: ['coverage', key],
    queryFn: () => fetchCoverage(key),
    enabled: enabled && key != null,
    staleTime: 15 * 60 * 1000,
    retry: 1,
  });
  const data = query.data?.disabled ? null : (query.data ?? null);
  return { ...query, data };
}
