// Deep-link map view <-> URL params. Pure and maplibre-free so it stays unit-testable; mirrors the
// region-selection.ts pattern. Inbound parsing is lenient — any invalid/unknown value is dropped so a
// malformed link degrades to the normal view rather than breaking.
import {
  type NeighborLinesMode,
  MAX_PITCH,
  DEFAULT_CENTER,
  DEFAULT_ZOOM,
  DEFAULT_PITCH,
  DEFAULT_BEARING,
  DEFAULT_CLUSTERED,
  DEFAULT_NEIGHBOR_LINES,
  DEFAULT_FLOW,
  DEFAULT_BORDERS,
} from './types';
import { NODE_TYPE_NAMES } from '../../lib/node-types';

// A parsed view carries only the fields whose params were present AND valid.
export interface ParsedMapView {
  center?: [number, number]; // [lng, lat]
  zoom?: number;
  pitch?: number; // camera tilt 0..MAX_PITCH; absent = flat default
  bearing?: number; // camera rotation -180..180; absent = north up
  clustered?: boolean;
  nodeType?: string;
  neighborLines?: NeighborLinesMode;
  flow?: boolean;
  borders?: boolean;
  meshcoreRegion?: string; // confirmed MeshCore region-scope token, e.g. "se" ("" = All)
}

// The live map state a copy-link snapshot is built from (every field concrete).
export interface MapViewSnapshot {
  center: [number, number]; // [lng, lat]
  zoom: number;
  pitch: number;
  bearing: number;
  clustered: boolean;
  nodeType: string; // "" = All
  neighborLines: NeighborLinesMode;
  flow: boolean;
  borders: boolean;
  meshcoreRegion: string; // "" = All
}

const NEIGHBOR_MODES: NeighborLinesMode[] = ['on', 'selected', 'off'];

function parseCoord(lat: string | null, lng: string | null): [number, number] | undefined {
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
  const zoom = Number.parseFloat(raw);
  return Number.isFinite(zoom) && zoom >= 0 && zoom <= 22 ? zoom : undefined;
}

// Camera tilt: 0 (flat) .. MAX_PITCH (the map's own ceiling).
function parsePitch(raw: string | null): number | undefined {
  if (raw === null) return undefined;
  const pitch = Number.parseFloat(raw);
  return Number.isFinite(pitch) && pitch >= 0 && pitch <= MAX_PITCH ? pitch : undefined;
}

// Camera rotation in maplibre's own range (getBearing normalizes to -180..180).
function parseBearing(raw: string | null): number | undefined {
  if (raw === null) return undefined;
  const bearing = Number.parseFloat(raw);
  return Number.isFinite(bearing) && bearing >= -180 && bearing <= 180 ? bearing : undefined;
}

function parseBool(raw: string | null): boolean | undefined {
  const v = raw?.toLowerCase();
  if (v === 'on') return true;
  if (v === 'off') return false;
  return undefined;
}

// Lenient parsing over the plain search object TanStack Router hands to the /map route.
export function parseMapViewSearch(search: Record<string, unknown>): ParsedMapView {
  const get = (key: string) => {
    const value = search[key];
    if (typeof value === 'string' || typeof value === 'number') return String(value);
    if (typeof value === 'boolean') return value ? 'on' : 'off';
    return null;
  };
  return parseMapViewValues(get);
}

function parseMapViewValues(get: (key: string) => string | null): ParsedMapView {
  const view: ParsedMapView = {};

  const center = parseCoord(get('lat'), get('lng'));
  if (center) view.center = center;

  const zoom = parseZoom(get('zoom'));
  if (zoom !== undefined) view.zoom = zoom;

  const pitch = parsePitch(get('pitch'));
  if (pitch !== undefined) view.pitch = pitch;

  const bearing = parseBearing(get('bearing'));
  if (bearing !== undefined) view.bearing = bearing;

  const clustered = parseBool(get('clustering'));
  if (clustered !== undefined) view.clustered = clustered;

  const type = get('node_type')?.toLowerCase();
  if (type && NODE_TYPE_NAMES.includes(type as (typeof NODE_TYPE_NAMES)[number]))
    view.nodeType = type;

  const neighbor = get('neighbor_lines')?.toLowerCase();
  if (neighbor && NEIGHBOR_MODES.includes(neighbor as NeighborLinesMode)) {
    view.neighborLines = neighbor as NeighborLinesMode;
  }

  const flow = parseBool(get('flow'));
  if (flow !== undefined) view.flow = flow;

  const borders = parseBool(get('borders'));
  if (borders !== undefined) view.borders = borders;

  // Single MeshCore region-scope token; lenient like node_type — anything malformed
  // is dropped so a bad link degrades to the unfiltered view.
  const meshcoreRegion = get('meshcore_region')?.toLowerCase();
  if (meshcoreRegion && /^[a-z0-9*._-]{1,64}$/.test(meshcoreRegion)) {
    view.meshcoreRegion = meshcoreRegion;
  }

  return view;
}

// Round to `dp` decimals without trailing-zero noise (45.3 stays "45.3").
function round(n: number, dp: number): string {
  const f = 10 ** dp;
  return String(Math.round(n * f) / f);
}

// ── live URL sync patches ────────────────────────────────────────────────────────────────────
// The /map search mirrors the map live: the camera after every move, the settings after every
// toggle, all replace-navigated. Neutral values are omitted so everyday links stay compact — an
// absent param always means its neutral default (both here and when parsing). Pure and
// maplibre-free so the writers in MapView stay thin and this contract stays unit-testable.

export interface MapCamera {
  center: [number, number]; // [lng, lat]
  zoom: number;
  pitch: number;
  bearing: number;
}

export interface MapSettingsState {
  clustered: boolean;
  nodeType: string; // "" = All
  neighborLines: NeighborLinesMode;
  flow: boolean;
  borders: boolean;
  meshcoreRegion: string; // "" = All
}

export interface MapSettingsPatch {
  clustering?: boolean;
  node_type?: string;
  neighbor_lines?: NeighborLinesMode;
  flow?: boolean;
  borders?: boolean;
  meshcore_region?: string;
}

export interface MapCameraPatch {
  lat?: number; // omitted at the configured default center (lat/lng move as a pair)
  lng?: number;
  zoom?: number; // omitted at the configured default zoom
  pitch?: number; // omitted when flat (0)
  bearing?: number; // omitted when north-up (0)
}

// Camera patch for the search object: default center/zoom and flat/north-up tilt/rotation are
// omitted; present values are rounded (5 dp coords, 2 dp zoom, 1 dp tilt/rotation).
export function buildCameraPatch(camera: MapCamera): MapCameraPatch {
  const lat = Number(round(camera.center[1], 5));
  const lng = Number(round(camera.center[0], 5));
  const atDefaultCenter =
    lat === Number(round(DEFAULT_CENTER[1], 5)) && lng === Number(round(DEFAULT_CENTER[0], 5));
  const zoom = Number(round(camera.zoom, 2));
  return {
    ...(atDefaultCenter ? {} : { lat, lng }),
    ...(zoom === Number(round(DEFAULT_ZOOM, 2)) ? {} : { zoom }),
    ...(camera.pitch ? { pitch: Number(round(camera.pitch, 1)) } : {}),
    ...(camera.bearing ? { bearing: Number(round(camera.bearing, 1)) } : {}),
  };
}

// Settings patch for the search object: only non-neutral settings are emitted.
export function buildSettingsPatch(settings: MapSettingsState): MapSettingsPatch {
  return {
    ...(settings.clustered === DEFAULT_CLUSTERED ? {} : { clustering: settings.clustered }),
    ...(settings.nodeType ? { node_type: settings.nodeType } : {}),
    ...(settings.neighborLines === DEFAULT_NEIGHBOR_LINES
      ? {}
      : { neighbor_lines: settings.neighborLines }),
    ...(settings.flow === DEFAULT_FLOW ? {} : { flow: settings.flow }),
    ...(settings.borders === DEFAULT_BORDERS ? {} : { borders: settings.borders }),
    ...(settings.meshcoreRegion ? { meshcore_region: settings.meshcoreRegion } : {}),
  };
}

// True when the search's camera already equals the live one — an absent param reads as its neutral
// default, so a param-less URL matches the opening view and no redundant navigation happens.
export function cameraMatchesUrl(url: ParsedMapView, camera: MapCamera): boolean {
  const lat = Number(round(camera.center[1], 5));
  const lng = Number(round(camera.center[0], 5));
  const zoom = Number(round(camera.zoom, 2));
  const atDefaultCenter =
    lat === Number(round(DEFAULT_CENTER[1], 5)) && lng === Number(round(DEFAULT_CENTER[0], 5));
  return (
    (url.center ? url.center[1] === lat && url.center[0] === lng : atDefaultCenter) &&
    (url.zoom !== undefined ? url.zoom === zoom : zoom === Number(round(DEFAULT_ZOOM, 2))) &&
    (url.pitch ?? 0) === Number(round(camera.pitch, 1)) &&
    (url.bearing ?? 0) === Number(round(camera.bearing, 1))
  );
}

// True when the search already carries exactly these settings — absent params read as neutral.
export function settingsMatchUrl(url: ParsedMapView, settings: MapSettingsState): boolean {
  return (
    (url.clustered ?? DEFAULT_CLUSTERED) === settings.clustered &&
    (url.nodeType ?? '') === settings.nodeType &&
    (url.neighborLines ?? DEFAULT_NEIGHBOR_LINES) === settings.neighborLines &&
    (url.flow ?? DEFAULT_FLOW) === settings.flow &&
    (url.borders ?? DEFAULT_BORDERS) === settings.borders &&
    (url.meshcoreRegion ?? '') === settings.meshcoreRegion
  );
}

// The camera a search asks for, with neutral defaults filled in; null when it carries no camera.
export function urlCamera(view: ParsedMapView): MapCamera | null {
  return view.center
    ? {
        center: view.center,
        zoom: view.zoom ?? DEFAULT_ZOOM,
        pitch: view.pitch ?? DEFAULT_PITCH,
        bearing: view.bearing ?? DEFAULT_BEARING,
      }
    : null;
}
