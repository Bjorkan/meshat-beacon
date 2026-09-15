import type * as Models from '../../api/generated/models';
import type { NullableFields } from '../../api/model-types';

export type StatsOverview = Models.StatsOverview;
export type ObservationPoint = Models.ObservationPoint;
export type PayloadBreakdownItem = Models.PayloadBreakdownItem;
export type TopNode = NullableFields<Models.TopNode, 'nodeName'>;
export type TopObserver = NullableFields<Models.TopObserver, 'displayName' | 'observerType'>;
export type TopAdvertiser = NullableFields<Models.TopAdvertiser, 'nodeName'>;
export type TopTalker = Models.TopTalker;
export type ClockDriftEntry = NullableFields<Models.ClockDriftEntry, 'nodeName'>;
export type RadioPreset = Models.RadioPreset;
export type NodeTypeCount = Models.NodeTypeCount;
export type ScopeStats = Models.ScopeStats;
// Missing measurements become null gaps for charts rather than artificial zeroes.
export type TelemetryPoint = NullableFields<
  Models.ObserverTelemetryPoint,
  Exclude<keyof Models.ObserverTelemetryPoint, 't'>
>;
export type ObserverTelemetry = Omit<Models.ObserverTelemetry, 'points'> & {
  points: TelemetryPoint[];
};

// Sub-tab + time-range identifiers shared across the Stats page.
export type StatsTab = 'mesh' | 'talkers' | 'clockdrift' | 'observer' | 'graph';
export type StatsRange = '24h' | '7d' | '30d';

export const RANGE_MS: Record<StatsRange, number> = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
};
