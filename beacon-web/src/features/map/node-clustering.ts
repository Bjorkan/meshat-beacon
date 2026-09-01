import type { GeoJSONSource } from "maplibre-gl";
import { CLUSTER_MAX_ZOOM, CLUSTER_MIN_POINTS, CLUSTER_RADIUS } from "./types";

export interface NodeClusterOptions {
  cluster: boolean;
  clusterRadius: number;
  clusterMaxZoom: number;
}

/**
 * The clustering contract for the node GeoJSON source. Keeping it in one place prevents the UI
 * toggle and source creation/update paths from silently drifting apart.
 */
export function nodeClusterOptions(enabled: boolean): NodeClusterOptions {
  return {
    cluster: enabled,
    clusterRadius: CLUSTER_RADIUS,
    clusterMaxZoom: CLUSTER_MAX_ZOOM,
  };
}

/**
 * MapLibre 5.x can update clustering in-place. This is more reliable than remove/re-add because a
 * React hook can remount while the MapLibre map (and its old source) is still alive. Always syncing
 * the actual source on a new source identity guarantees that "Clustering: On" cannot inherit a
 * stale cluster:false source from Live or a previous mount.
 */
export function applyNodeClusterMode(source: GeoJSONSource, enabled: boolean): void {
  source.setClusterOptions(nodeClusterOptions(enabled));
}

/** Explicit for source creation/documentation even though MapLibre's default is also two. */
export const NODE_CLUSTER_MIN_POINTS = CLUSTER_MIN_POINTS;
