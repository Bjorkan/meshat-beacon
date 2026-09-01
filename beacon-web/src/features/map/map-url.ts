// Deep-link map view <-> URL params. Pure and maplibre-free so it stays unit-testable; mirrors the
// region-selection.ts pattern. Inbound parsing is lenient — any invalid/unknown value is dropped so a
// malformed link degrades to the normal view rather than breaking.
import { MAP_STYLES, type NeighborLinesMode } from "./types";
import { NODE_TYPE_NAMES } from "../../lib/node-types";

// A parsed view carries only the fields whose params were present AND valid.
export interface ParsedMapView {
  center?: [number, number]; // [lng, lat]
  zoom?: number;
  clustered?: boolean;
  nodeType?: string;
  neighborLines?: NeighborLinesMode;
  styleId?: string;
  flow?: boolean;
  borders?: boolean;
}

// The live map state a copy-link snapshot is built from (every field concrete).
export interface MapViewSnapshot {
  center: [number, number]; // [lng, lat]
  zoom: number;
  clustered: boolean;
  nodeType: string; // "" = All
  neighborLines: NeighborLinesMode;
  styleId: string;
  flow: boolean;
  borders: boolean;
}

const NEIGHBOR_MODES: NeighborLinesMode[] = ["on", "selected", "off"];

function parseCoord(
  lat: string | null,
  lng: string | null,
): [number, number] | undefined {
  if (lat === null || lng === null) return undefined;
  const latN = Number.parseFloat(lat);
  const lngN = Number.parseFloat(lng);
  if (
    !Number.isFinite(latN) ||
    !Number.isFinite(lngN) ||
    Math.abs(latN) > 90 ||
    Math.abs(lngN) > 180
  ) {
    return undefined;
  }
  return [lngN, latN];
}

function parseZoom(raw: string | null): number | undefined {
  if (raw === null) return undefined;
  const z = Number.parseFloat(raw);
  return Number.isFinite(z) && z >= 0 && z <= 22 ? z : undefined;
}

function parseBool(raw: string | null): boolean | undefined {
  const v = raw?.toLowerCase();
  if (v === "on") return true;
  if (v === "off") return false;
  return undefined;
}

// Lenient parsing over the plain search object TanStack Router hands to the /map route.
export function parseMapViewSearch(
  search: Record<string, unknown>,
): ParsedMapView {
  const get = (key: string) => {
    const value = search[key];
    if (typeof value === "string" || typeof value === "number") return String(value);
    if (typeof value === "boolean") return value ? "on" : "off";
    return null;
  };
  return parseMapViewValues(get);
}

function parseMapViewValues(
  get: (key: string) => string | null,
): ParsedMapView {
  const view: ParsedMapView = {};

  const center = parseCoord(get("lat"), get("lng"));
  if (center) view.center = center;

  const zoom = parseZoom(get("zoom"));
  if (zoom !== undefined) view.zoom = zoom;

  const clustered = parseBool(get("clustering"));
  if (clustered !== undefined) view.clustered = clustered;

  const type = get("node_type")?.toLowerCase();
  if (
    type &&
    NODE_TYPE_NAMES.includes(type as (typeof NODE_TYPE_NAMES)[number])
  )
    view.nodeType = type;

  const neighbor = get("neighbor_lines")?.toLowerCase();
  if (neighbor && NEIGHBOR_MODES.includes(neighbor as NeighborLinesMode)) {
    view.neighborLines = neighbor as NeighborLinesMode;
  }

  const style = get("style")?.toLowerCase();
  const match = style && MAP_STYLES.find((s) => s.id.toLowerCase() === style);
  if (match) view.styleId = match.id;

  const flow = parseBool(get("flow"));
  if (flow !== undefined) view.flow = flow;

  const borders = parseBool(get("borders"));
  if (borders !== undefined) view.borders = borders;

  return view;
}

// Round to `dp` decimals and stringify without trailing-zero noise (45.3 stays "45.3").
function round(n: number, dp: number): string {
  const f = 10 ** dp;
  return String(Math.round(n * f) / f);
}

// Authoritative param map for a copy-link snapshot: every managed key set to its current value, with
// node_type deleted (null) when All so a stale ?node_type can't survive. Region/tab are handled by the
// caller (the URL is built from the address bar, which already carries ?iata).
export function buildMapParams(
  view: MapViewSnapshot,
): Record<string, string | null> {
  return {
    lat: round(view.center[1], 5),
    lng: round(view.center[0], 5),
    zoom: round(view.zoom, 2),
    clustering: view.clustered ? "on" : "off",
    node_type: view.nodeType || null,
    neighbor_lines: view.neighborLines,
    style: view.styleId,
    flow: view.flow ? "on" : "off",
    borders: view.borders ? "on" : "off",
  };
}
