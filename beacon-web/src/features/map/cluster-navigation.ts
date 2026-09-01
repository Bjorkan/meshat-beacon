// Pure cluster-click policy. MapLibre tells us the zoom at which a cluster naturally expands; we
// always prefer that camera move. Spiderfy is reserved for the terminal case where even the deepest
// clustered zoom cannot separate the members (typically identical/near-identical coordinates).

export type ClusterClickDecision =
  | { type: "zoom"; zoom: number }
  | { type: "spiderfy" };

export const CLUSTER_ZOOM_DURATION_MS = 420;
export const CLUSTER_FALLBACK_ZOOM_STEP = 2;
const ZOOM_EPSILON = 0.01;

export function clusterClickDecision(
  currentZoom: number,
  expansionZoom: number,
  maxExpansionZoom: number,
): ClusterClickDecision {
  const targetZoom = Math.min(expansionZoom, maxExpansionZoom);
  if (targetZoom > currentZoom + ZOOM_EPSILON) return { type: "zoom", zoom: targetZoom };
  return { type: "spiderfy" };
}

// If MapLibre cannot resolve the expansion zoom because the source/style changed mid-click, move a
// conservative step deeper instead of making the cluster feel dead. Null means we're already at the
// terminal clustered zoom and should use spiderfy.
export function fallbackClusterZoom(currentZoom: number, maxExpansionZoom: number): number | null {
  const targetZoom = Math.min(currentZoom + CLUSTER_FALLBACK_ZOOM_STEP, maxExpansionZoom);
  return targetZoom > currentZoom + ZOOM_EPSILON ? targetZoom : null;
}
