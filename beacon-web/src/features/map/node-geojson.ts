import type { Feature, FeatureCollection, LineString, Point } from "geojson";
import type { NodeSummary, NodeNeighbor } from "../nodes/types";
import type { NeighborLinesMode } from "./types";

// Build the maplibre GeoJSON source from the nodes API response. Properties stay primitive because
// clustering serializes them, and there's no maplibre import, so this stays unit-testable.

export interface NodeFeatureProps {
  id: string;
  name: string | null;
  nodeTypeName: string;
  isObserver: boolean; // role flag; selects the observer-pip marker variant (default false)
}

export function nodesToFeatureCollection(
  nodes: NodeSummary[],
): FeatureCollection<Point, NodeFeatureProps> {
  const features: Feature<Point, NodeFeatureProps>[] = [];
  for (const n of nodes) {
    // != null keeps 0 (a valid coordinate) while dropping null/undefined
    if (n.lat == null || n.lng == null) continue;
    features.push({
      type: "Feature",
      // GeoJSON/maplibre order is [lng, lat]; the API sends decimal degrees as-is
      geometry: { type: "Point", coordinates: [n.lng, n.lat] },
      properties: {
        id: n.id,
        name: n.name,
        nodeTypeName: n.nodeTypeName,
        isObserver: !!n.isObserver,
      },
    });
  }
  return { type: "FeatureCollection", features };
}

export interface NeighborEdgeProps {
  selected: boolean; // incident to the currently selected node — styled brighter
  // Present only on the selected node's edges (buildFocusedNeighborEdges): total observations of the
  // link and its age in days. Drive the obs→color gradient and the freshness fade; absent edges (the
  // ambient "on" mesh) render uniform.
  obs?: number;
  ageDays?: number;
}

export interface FocusedNeighborPointProps {
  id: string;
  name: string | null;
  nodeTypeName: string;
  selected?: boolean;
}

export type NeighborRenderMode = "ambient" | "focused" | "off";

// Selection is an explicit inspection task: once a node is selected, both visible neighbor modes
// collapse to that node's detailed edge set. Live suppresses the ambient mesh so packet paths stay
// legible, but a selected node can still be inspected without leaving Live.
export function neighborRenderMode(
  mode: NeighborLinesMode,
  selectedId: string | null,
  liveMode: boolean,
): NeighborRenderMode {
  if (mode === "off") return "off";
  if (selectedId) return "focused";
  if (mode === "selected" || liveMode) return "off";
  return "ambient";
}

// LineString edges between located nodes and their neighbors (from each node's neighborIds). Each
// undirected pair is emitted once, and only when both ends are located nodes in this set. "selected"
// keeps just the selected node's edges; "on" emits all and flags its edges with the `selected` prop.
export function buildNeighborEdges(
  nodes: NodeSummary[],
  mode: "on" | "selected",
  selectedId: string | null,
): FeatureCollection<LineString, NeighborEdgeProps> {
  const located = new Map<string, NodeSummary>();
  for (const n of nodes) {
    if (n.lat != null && n.lng != null) located.set(n.id, n);
  }

  const seen = new Set<string>();
  const features: Feature<LineString, NeighborEdgeProps>[] = [];
  for (const n of nodes) {
    if (n.lat == null || n.lng == null || !n.neighborIds) continue;
    for (const otherId of n.neighborIds) {
      if (otherId === n.id) continue; // a node listing itself would draw a zero-length edge
      const other = located.get(otherId);
      if (!other) continue;
      const key = n.id < otherId ? `${n.id}|${otherId}` : `${otherId}|${n.id}`;
      if (seen.has(key)) continue;
      const incident = n.id === selectedId || otherId === selectedId;
      if (mode === "selected" && !incident) continue;
      seen.add(key);
      features.push({
        type: "Feature",
        geometry: { type: "LineString", coordinates: [[n.lng, n.lat], [other.lng!, other.lat!]] },
        properties: { selected: incident },
      });
    }
  }
  return { type: "FeatureCollection", features };
}

// The selected node's edges, coloured by observation count and freshness. Data comes from the node
// detail endpoint (GET /nodes/{id}/neighbors), which unlike the list's bare neighborIds carries
// observationCount + lastSeen + coords. That endpoint returns one row per (neighbor, iata), so rows
// are folded per neighbor: obs summed, lastSeen taken at its freshest. `now` defaults to the current
// time; tests pass it explicitly so the age stays deterministic.
export function buildFocusedNeighborEdges(
  selected: Pick<NodeSummary, "id" | "lat" | "lng"> | null | undefined,
  neighbors: NodeNeighbor[],
  now: number = Date.now(),
): FeatureCollection<LineString, NeighborEdgeProps> {
  const empty: FeatureCollection<LineString, NeighborEdgeProps> = { type: "FeatureCollection", features: [] };
  if (!selected || selected.lat == null || selected.lng == null) return empty;
  const from: [number, number] = [selected.lng, selected.lat];

  const byId = new Map<string, { lng: number; lat: number; obs: number; lastSeen: number }>();
  for (const nb of neighbors) {
    if (nb.id === selected.id || nb.lat == null || nb.lng == null) continue;
    const prev = byId.get(nb.id);
    if (prev) {
      prev.obs += nb.observationCount;
      prev.lastSeen = Math.max(prev.lastSeen, nb.lastSeen);
    } else {
      byId.set(nb.id, { lng: nb.lng, lat: nb.lat, obs: nb.observationCount, lastSeen: nb.lastSeen });
    }
  }

  const features: Feature<LineString, NeighborEdgeProps>[] = [];
  for (const n of byId.values()) {
    features.push({
      type: "Feature",
      geometry: { type: "LineString", coordinates: [from, [n.lng, n.lat]] },
      properties: { selected: true, obs: n.obs, ageDays: Math.max(0, (now - n.lastSeen) / 86400000) },
    });
  }
  return { type: "FeatureCollection", features };
}

// Detailed neighbor rows may repeat the same node for several IATAs. Keep one stable, unclustered
// overlay endpoint per id so focused lines never terminate in empty map space.
export function buildFocusedNeighborPoints(
  selectedId: string | null,
  neighbors: NodeNeighbor[],
): FeatureCollection<Point, FocusedNeighborPointProps> {
  const byId = new Map<string, Feature<Point, FocusedNeighborPointProps>>();
  for (const neighbor of neighbors) {
    if (neighbor.id === selectedId || neighbor.lat == null || neighbor.lng == null || byId.has(neighbor.id)) continue;
    byId.set(neighbor.id, {
      type: "Feature",
      geometry: { type: "Point", coordinates: [neighbor.lng, neighbor.lat] },
      properties: { id: neighbor.id, name: neighbor.name ?? null, nodeTypeName: neighbor.nodeTypeName },
    });
  }
  return { type: "FeatureCollection", features: [...byId.values()] };
}

export function buildFocusedSelectedPoint(
  selected: Pick<NodeSummary, "id" | "name" | "nodeTypeName" | "lat" | "lng"> | undefined,
): FeatureCollection<Point, FocusedNeighborPointProps> {
  if (!selected || selected.lat == null || selected.lng == null) return { type: "FeatureCollection", features: [] };
  return {
    type: "FeatureCollection",
    features: [{
      type: "Feature",
      geometry: { type: "Point", coordinates: [selected.lng, selected.lat] },
      properties: { id: selected.id, name: selected.name, nodeTypeName: selected.nodeTypeName, selected: true },
    }],
  };
}

// Filter to a single device type ("" = All). Filtering the data (not a layer filter) lets the
// clustered source re-count only the visible type.
export function filterByNodeType(
  fc: FeatureCollection<Point, NodeFeatureProps>,
  typeName: string,
): FeatureCollection<Point, NodeFeatureProps> {
  if (typeName === "") return fc;
  return { ...fc, features: fc.features.filter((f) => f.properties.nodeTypeName === typeName) };
}
