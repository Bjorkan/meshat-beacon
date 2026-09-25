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

// GET /observers/{id}/activity: what the observer heard per `interval`. The tab hides these charts on a 404.
export interface ActivityPoint {
  t: number; // epoch ms, bucket start
  observations: number;
  airtimeMs: number | null; // summed LoRa time-on-air; null when no row in the bucket could be costed
  snrAvg: number | null;
  snrMin: number | null;
  rssiAvg: number | null;
}

export interface ActivityRadio {
  freqMhz: number | null;
  sf: number | null;
  bwKhz: number | null;
  cr: number | null;
  preambleSymbols: number | null;
}

export interface ObserverActivity {
  range: string;
  interval: string;
  radio: ActivityRadio | null;
  payloadTypes: PayloadBreakdownItem[];
  points: ActivityPoint[];
}

// Sub-tab + time-range identifiers shared across the Stats page.
export type StatsTab =
  | 'mesh'
  | 'traffic'
  | 'signal'
  | 'paths'
  | 'scopes'
  | 'talkers'
  | 'clockdrift'
  | 'observer'
  | 'compare'
  | 'graph';
export type StatsRange = '24h' | '7d' | '30d';

export const RANGE_MS: Record<StatsRange, number> = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
};

// beacon-server /stats/signal: retained observation rows in [since, until).
export interface SignalBin {
  lower: number | null;
  upper: number | null;
  count: number;
}
export interface SignalMetric {
  samples: number;
  average: number | null;
  histogram: SignalBin[];
}
export interface SignalHour {
  hour: number;
  receptions: number;
  snrSamples: number;
  snrAverage: number | null;
  rssiSamples: number;
  rssiAverage: number | null;
}
export interface SignalStats {
  since: number;
  until: number;
  receptions: number;
  snr: SignalMetric;
  rssi: SignalMetric;
  hourly: SignalHour[];
}

// beacon-server /stats/paths: retained receptions; the four categories partition the total.
export interface PathHashWidth {
  bytes: number;
  receptions: number;
}
export interface PathLengthBin {
  entries: number;
  receptions: number;
}
export interface PathHour {
  hour: number;
  receptions: number;
  oneByte: number;
  twoByte: number;
  threeByte: number;
  empty: number;
  trace: number;
  unclassified: number;
}
export interface PathStats {
  since: number;
  until: number;
  receptions: number;
  hashed: number;
  empty: number;
  trace: number;
  unclassified: number;
  hashWidths: PathHashWidth[];
  pathLengths: PathLengthBin[];
  hourly: PathHour[];
}

export type ObserverComparison = Models.ObserverComparison;
