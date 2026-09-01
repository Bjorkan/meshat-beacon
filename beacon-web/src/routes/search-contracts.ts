import { parseMapViewSearch } from "../features/map/map-url";
import type { StatsRange, StatsTab } from "../features/stats/types";

export function searchString(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

function oneOf<T extends string>(value: unknown, values: readonly T[]): T | undefined {
  return typeof value === "string" && values.includes(value as T) ? value as T : undefined;
}

export interface NodesSearch {
  nq?: string;
  nsf?: "name" | "pubkey";
  nt?: string;
  np?: "true" | "false";
  ntr?: "true" | "false";
  ns?: string;
  nsort?: "name" | "type" | "radio" | "neighbors";
  ndir?: "asc" | "desc";
}

export function validateNodesSearch(search: Record<string, unknown>): NodesSearch {
  return {
    nq: searchString(search.nq),
    nsf: oneOf(search.nsf, ["name", "pubkey"] as const),
    nt: searchString(search.nt),
    np: oneOf(search.np, ["true", "false"] as const),
    ntr: oneOf(search.ntr, ["true", "false"] as const),
    ns: searchString(search.ns),
    nsort: oneOf(search.nsort, ["name", "type", "radio", "neighbors"] as const),
    ndir: oneOf(search.ndir, ["asc", "desc"] as const),
  };
}

export interface ObserversSearch {
  oq?: string;
  osf?: "name";
  ost?: "online" | "offline";
  ot?: string;
  ob?: string;
  os?: string;
  osort?: "name" | "type" | "radio" | "iata" | "status";
  odir?: "asc" | "desc";
}

export function validateObserversSearch(search: Record<string, unknown>): ObserversSearch {
  return {
    oq: searchString(search.oq),
    osf: oneOf(search.osf, ["name"] as const),
    ost: oneOf(search.ost, ["online", "offline"] as const),
    ot: searchString(search.ot),
    ob: searchString(search.ob),
    os: searchString(search.os),
    osort: oneOf(search.osort, ["name", "type", "radio", "iata", "status"] as const),
    odir: oneOf(search.odir, ["asc", "desc"] as const),
  };
}

export interface ChannelsSearch {
  cq?: string;
  csf?: "name" | "hash";
  ck?: "known" | "unknown";
  ch?: "true" | "false";
}

export function validateChannelsSearch(search: Record<string, unknown>): ChannelsSearch {
  return {
    cq: searchString(search.cq),
    csf: oneOf(search.csf, ["name", "hash"] as const),
    ck: oneOf(search.ck, ["known", "unknown"] as const),
    ch: oneOf(search.ch, ["true", "false"] as const),
  };
}

export interface TracesSearch {
  tt?: "TRACE" | "PING";
}

export function validateTracesSearch(search: Record<string, unknown>): TracesSearch {
  return { tt: oneOf(search.tt, ["TRACE", "PING"] as const) };
}

export interface MapSearch {
  node?: string;
  lat?: number;
  lng?: number;
  zoom?: number;
  clustering?: boolean;
  node_type?: string;
  neighbor_lines?: "on" | "selected" | "off";
  style?: string;
  flow?: boolean;
  borders?: boolean;
}

export function validateMapSearch(search: Record<string, unknown>): MapSearch {
  const mapView = parseMapViewSearch(search);
  return {
    node: searchString(search.node),
    lat: mapView.center?.[1],
    lng: mapView.center?.[0],
    zoom: mapView.zoom,
    clustering: mapView.clustered,
    node_type: mapView.nodeType,
    neighbor_lines: mapView.neighborLines,
    style: mapView.styleId,
    flow: mapView.flow,
    borders: mapView.borders,
  };
}

export interface AnalyticsSearch {
  statsTab?: StatsTab;
  observerId?: string;
  range?: StatsRange;
}

export function validateAnalyticsSearch(search: Record<string, unknown>): AnalyticsSearch {
  return {
    statsTab: oneOf(search.statsTab, ["mesh", "talkers", "clockdrift", "observer", "graph"] as const),
    observerId: searchString(search.observerId),
    range: oneOf(search.range, ["24h", "7d", "30d"] as const),
  };
}
