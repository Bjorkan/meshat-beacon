import { useQuery } from '@tanstack/react-query';
import { useRegion } from '../../hooks/useRegion';
import { statsQueries } from '../../api/queries';
import type { StatsRange } from './types';

function useStatsRegion() {
  const region = useRegion();
  return {
    ...region,
    regionKey: region.isResolved === false ? `${region.regionKey}:pending` : region.regionKey,
  };
}

export function useStatsOverview() {
  const { iatas, regionKey, isResolved } = useStatsRegion();
  return useQuery({ enabled: isResolved !== false, ...statsQueries.overview(regionKey, iatas) });
}

export function useStatsObservations(range: StatsRange) {
  const { iatas, regionKey, isResolved } = useStatsRegion();
  return useQuery({
    enabled: isResolved !== false,
    ...statsQueries.observations(regionKey, iatas, range),
  });
}

export function usePayloadBreakdown(range: StatsRange) {
  const { iatas, regionKey, isResolved } = useStatsRegion();
  return useQuery({
    enabled: isResolved !== false,
    ...statsQueries.payloadBreakdown(regionKey, iatas, range),
  });
}

export function useTopNodes(limit = 10) {
  const { iatas, regionKey, isResolved } = useStatsRegion();
  return useQuery({
    enabled: isResolved !== false,
    ...statsQueries.topNodes(regionKey, iatas, limit),
  });
}

export function useTopObservers(range: StatsRange, limit = 10) {
  const { iatas, regionKey, isResolved } = useStatsRegion();
  return useQuery({
    enabled: isResolved !== false,
    ...statsQueries.topObservers(regionKey, iatas, range, limit),
  });
}

export function useTopAdvertisers(range: StatsRange, limit = 10) {
  const { iatas, regionKey, isResolved } = useStatsRegion();
  return useQuery({
    enabled: isResolved !== false,
    ...statsQueries.topAdvertisers(regionKey, iatas, range, limit),
  });
}

export function useTopTalkers(range: StatsRange, limit = 10) {
  const { iatas, regionKey, isResolved } = useStatsRegion();
  return useQuery({
    enabled: isResolved !== false,
    ...statsQueries.topTalkers(regionKey, iatas, range, limit),
  });
}

export function useRadioPresets() {
  const { iatas, regionKey, isResolved } = useStatsRegion();
  return useQuery({
    enabled: isResolved !== false,
    ...statsQueries.radioPresets(regionKey, iatas),
  });
}

export function useNodeTypes() {
  const { iatas, regionKey, isResolved } = useStatsRegion();
  return useQuery({ enabled: isResolved !== false, ...statsQueries.nodeTypes(regionKey, iatas) });
}

export function useClockDrift(limit = 100) {
  const { iatas, regionKey, isResolved } = useStatsRegion();
  return useQuery({
    enabled: isResolved !== false,
    ...statsQueries.clockDrift(regionKey, iatas, limit),
  });
}

export function useScopes() {
  const { iatas, regionKey, isResolved } = useStatsRegion();
  return useQuery({
    ...statsQueries.scopes(regionKey, iatas),
    enabled: isResolved !== false,
    placeholderData: undefined,
  });
}
