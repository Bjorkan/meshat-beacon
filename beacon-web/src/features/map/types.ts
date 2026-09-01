// Map feature config: pure data and lookups, no maplibre import, so it stays unit-testable
// without pulling in the WebGL engine.

export interface MapStyleOption {
  id: string;
  name: string;
  url: string;
  dark: boolean;
}

export const MAP_STYLES: MapStyleOption[] = [
  {
    id: "dark",
    name: "Dark",
    url: "https://tiles.openfreemap.org/styles/dark",
    dark: true,
  },
  {
    id: "liberty",
    name: "Liberty",
    url: "https://tiles.openfreemap.org/styles/liberty",
    dark: false,
  },
  {
    id: "positron",
    name: "Light",
    url: "https://tiles.openfreemap.org/styles/positron",
    dark: false,
  },
];

export const DEFAULT_STYLE_ID = "dark";

export const MAP_CLUSTER_STORAGE_KEY = "beacon-map-clustering";
export const MAP_NODE_TYPE_STORAGE_KEY = "beacon-map-node-type";

// Map tiles follow the active app theme (Meshat Dark → dark basemap, Meshat Light → light
// basemap). Anything not explicitly a light theme — including legacy/unknown ids — stays dark,
// which also matches the historical default.
export function mapStyleForTheme(themeId: string): string {
  return /(^|[_-])light([_-]|$)/i.test(themeId) ? "positron" : DEFAULT_STYLE_ID;
}

// Always returns an option: falls back to the first entry, which also covers a stale/invalid id
// restored from localStorage.
export function resolveMapStyle(id: string): MapStyleOption {
  return MAP_STYLES.find((s) => s.id === id) ?? MAP_STYLES[0]!;
}

// DEM terrain tiles: public AWS Open Data terrarium set (keyless), 256px tiles (not the raster-dem
// spec default of 512).
export const DEM_TILES = [
  "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png",
];

// maplibre auto-attributes the basemap from its style JSON, but not a hand-added raster-dem source.
// The terrarium data requires attribution, so it's set on the source and surfaces in the control.
export const DEM_ATTRIBUTION =
  '<a href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md" target="_blank" rel="noopener">Tilezen Joerd</a>';

export const TERRAIN_EXAGGERATION = 1.5;

// The fallback/initial map view, configured per deployment via .env (VITE_MAP_CENTER as decimal
// "lat,lon", VITE_MAP_ZOOM). Used before airports load and when a selection has no airport coords;
// otherwise MapView fits bounds over the airports (see CLAUDE.md, map framing). With neither set,
// fall back to a wide world overview.
const FALLBACK_CENTER: [number, number] = [0, 20]; // [lng, lat] — neutral world view
const FALLBACK_ZOOM = 1.5;

export function parseMapCenter(raw: string | undefined): [number, number] {
  if (!raw) return FALLBACK_CENTER;
  const parts = raw.split(",").map((p) => Number.parseFloat(p.trim()));
  const [lat, lon] = parts;
  if (
    parts.length !== 2 ||
    lat === undefined ||
    lon === undefined ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lon) ||
    Math.abs(lat) > 90 ||
    Math.abs(lon) > 180
  ) {
    return FALLBACK_CENTER;
  }
  return [lon, lat]; // env is "lat,lon" (decimal); maplibre wants [lng, lat]
}

// Zoom for the fallback/initial view, clamped to the slippy-map range; falls back otherwise.
export function parseMapZoom(raw: string | undefined): number {
  if (!raw) return FALLBACK_ZOOM;
  const zoom = Number.parseFloat(raw.trim());
  if (!Number.isFinite(zoom) || zoom < 0 || zoom > 22) return FALLBACK_ZOOM;
  return zoom;
}

export const DEFAULT_CENTER: [number, number] = parseMapCenter(
  import.meta.env.VITE_MAP_CENTER as string | undefined,
);
export const DEFAULT_ZOOM = parseMapZoom(
  import.meta.env.VITE_MAP_ZOOM as string | undefined,
);
export const DEFAULT_PITCH = 0; // flat overview, no tilt
export const DEFAULT_BEARING = 0;
export const MAX_PITCH = 85;

// fitBounds caps zoom at IATA_ZOOM; a single-airport fit also gets IATA_PITCH (3D terrain tilt).
export const IATA_ZOOM = 9;
export const IATA_PITCH = 45;

// --- Nodes data layer ---
export const NODES_SOURCE_ID = "nodes";
export const NODES_CLUSTER_HALO_LAYER_ID = "nodes-clusters-halo"; // soft shadow behind the neutral bubble
export const NODES_CLUSTER_FALLBACK_LAYER_ID = "nodes-clusters-fallback"; // neutral circular cluster bubble + hit target
export const NODES_CLUSTER_LAYER_ID = "nodes-clusters"; // centered total count; also the Spiderfy parent layer
export const NODES_CLUSTER_BREAKDOWN_LAYER_ID = "nodes-clusters-breakdown"; // compact R/C/M/S composition below total
export const NODES_DOT_LAYER_ID = "nodes-dots"; // compact low-zoom network overview
export const NODES_POINT_LAYER_ID = "nodes-unclustered";
export const NODES_SELECTED_LAYER_ID = "nodes-selected"; // circle ring under the selected node's icon
// Same ring for a node shown as a spiderfied leaf (it's inside a cluster, so the id-filtered
// NODES_SELECTED_LAYER_ID can't reach it). Fed by its own geojson source, pointed at the leaf.
export const NODES_SELECTED_LEAF_LAYER_ID = "nodes-selected-leaf";

// --- Neighbor edges layer ---
export const NEIGHBORS_SOURCE_ID = "neighbors";
export const NEIGHBORS_LINE_LAYER_ID = "neighbor-lines"; // line layer drawn beneath the node markers
export const FOCUSED_NEIGHBORS_SOURCE_ID = "focused-neighbors";
export const FOCUSED_SELECTED_BACKDROP_LAYER_ID = "focused-neighbors-selected-backdrop";
export const FOCUSED_NEIGHBORS_BASE_LAYER_ID = "focused-neighbors-base";
export const FOCUSED_NEIGHBORS_LAYER_ID = "focused-neighbors-markers";
export const MAP_NEIGHBOR_LINES_STORAGE_KEY = "beacon-map-neighbor-lines";
export type NeighborLinesMode = "on" | "selected" | "off";

// --- IATA border layer ---
export const IATA_BORDERS_SOURCE_ID = "iata-borders";
export const IATA_BORDERS_LINE_LAYER_ID = "iata-borders-line"; // outline stroke beneath the markers
export const MAP_BORDERS_STORAGE_KEY = "beacon-map-borders";

// --- Live packet-flow: useMapNodes renders the network as uniform uncluttered dots, then each
// observed packet shoots an orange dot along its real hop path with a fading dashed trail/glow. ---
export const PACKET_FLOW_TRAIL_SOURCE_ID = "packet-flow-trail";
export const PACKET_FLOW_TRAIL_LAYER_ID = "packet-flow-trail"; // dashed line tracing behind the dot
export const PACKET_FLOW_DOT_SOURCE_ID = "packet-flow-dot";
export const PACKET_FLOW_DOT_HALO_LAYER_ID = "packet-flow-dot-halo"; // dark halo behind the dot
export const PACKET_FLOW_DOT_LAYER_ID = "packet-flow-dot"; // the moving packet dot
export const PACKET_FLOW_PULSE_SOURCE_ID = "packet-flow-pulse";
export const PACKET_FLOW_PULSE_GLOW_LAYER_ID = "packet-flow-pulse-glow";
export const PACKET_FLOW_PULSE_RING_LAYER_ID = "packet-flow-pulse-ring";
export const PACKET_FLOW_COLOR = "#ff6b35"; // fallback activity accent; individual packets use stable hash colors
export const PACKET_FLOW_HOP_MS = 480; // ms the dot takes to cross one hop segment
export const PACKET_FLOW_FLASH_MS = 900; // a crossed node's flash decays back to dim over this
export const PACKET_FLOW_TRAIL_FADE_MS = 1000; // the dashed trail fades once the dot reaches the end
export const PACKET_FLOW_MAX = 120; // cap on concurrent packet animations (busy-feed guard)
// Live activity halo. The base network switches to small uniform dots; crossed nodes bloom via this
// feature-state layer without changing the dot size itself.
export const NODES_GLOW_LAYER_ID = "nodes-glow";
// Country/city overviews still cluster, but ordinary nearby nodes are released by neighbourhood
// zoom. Terminal spiderfy handles the rare co-located remainder at this practical ceiling.
export const CLUSTER_RADIUS = 58; // px, close to the legible city-level grouping users prefer in CoreScope
export const CLUSTER_MIN_POINTS = 2; // any two nearby nodes are eligible to form a cluster
export const CLUSTER_MAX_ZOOM = 16;
export const NODES_SOURCE_MAXZOOM = 17; // must exceed CLUSTER_MAX_ZOOM
// Node name labels fade in at/above this zoom (hidden when zoomed out / clustered).
export const NODE_LABEL_MIN_ZOOM = 12;

// Device types live in lib/node-types; re-exported here for the map feature's consumers.
export {
  NODE_TYPE_NAMES,
  NODE_TYPE_OPTIONS as NODE_TYPE_FILTER_OPTIONS,
} from "../../lib/node-types";
export type { NodeTypeName } from "../../lib/node-types";
export const NODE_ICON_UNKNOWN = "node-unknown";
export const nodeIconId = (typeName: string): string => `node-${typeName}`;
