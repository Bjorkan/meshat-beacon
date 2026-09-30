import { useQuery } from '@tanstack/react-query';
import { useRegion } from '../../hooks/useRegion';
import { statsQueries } from '../../api/queries';
import type { StatsRange } from './types';

// Region-scoped stats factories gate themselves on a pending region filter, so the raw
// useRegion() values can be passed through unchanged: nothing fetches until the selected
// region's IATA set has resolved, and the all-regions selection keeps its "*" scope.
export function useStatsOverview() {
  const { iatas, regionKey } = useRegion();
  return useQuery(statsQueries.overview(regionKey, iatas));
}

export function useStatsObservations(range: StatsRange) {
  const { iatas, regionKey } = useRegion();
  return useQuery(statsQueries.observations(regionKey, iatas, range));
}

export function usePayloadBreakdown(range: StatsRange) {
  const { iatas, regionKey } = useRegion();
  return useQuery(statsQueries.payloadBreakdown(regionKey, iatas, range));
}

export function useTopNodes(limit = 10) {
  const { iatas, regionKey } = useRegion();
  return useQuery(statsQueries.topNodes(regionKey, iatas, limit));
}

export function useTopObservers(range: StatsRange, limit = 10) {
  const { iatas, regionKey } = useRegion();
  return useQuery(statsQueries.topObservers(regionKey, iatas, range, limit));
}

export function useTopAdvertisers(range: StatsRange, limit = 10) {
  const { iatas, regionKey } = useRegion();
  return useQuery(statsQueries.topAdvertisers(regionKey, iatas, range, limit));
}

export function useTopTalkers(range: StatsRange, limit = 10) {
  const { iatas, regionKey } = useRegion();
  return useQuery(statsQueries.topTalkers(regionKey, iatas, range, limit));
}

export function useRadioPresets() {
  const { iatas, regionKey } = useRegion();
  return useQuery(statsQueries.radioPresets(regionKey, iatas));
}

export function useNodeTypes() {
  const { iatas, regionKey } = useRegion();
  return useQuery(statsQueries.nodeTypes(regionKey, iatas));
}

export function useClockDrift(limit = 100) {
  const { iatas, regionKey } = useRegion();
  return useQuery(statsQueries.clockDrift(regionKey, iatas, limit));
}

export function useScopes() {
  const { iatas, regionKey } = useRegion();
  return useQuery({
    ...statsQueries.scopes(regionKey, iatas),
    enabled: regionKey !== null,
    placeholderData: undefined,
  });
}
