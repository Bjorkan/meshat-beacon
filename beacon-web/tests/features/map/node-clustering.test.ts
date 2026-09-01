import { describe, expect, it, vi } from "vitest";
import type { GeoJSONSource } from "maplibre-gl";
import { applyNodeClusterMode, nodeClusterOptions, NODE_CLUSTER_MIN_POINTS } from "../../../src/features/map/node-clustering";
import { CLUSTER_MAX_ZOOM, CLUSTER_MIN_POINTS, CLUSTER_RADIUS } from "../../../src/features/map/types";

describe("node clustering source contract", () => {
  it("uses the same explicit clustering parameters for source creation and runtime toggles", () => {
    expect(nodeClusterOptions(true)).toEqual({
      cluster: true,
      clusterRadius: CLUSTER_RADIUS,
      clusterMaxZoom: CLUSTER_MAX_ZOOM,
    });
    expect(nodeClusterOptions(false)).toEqual({
      cluster: false,
      clusterRadius: CLUSTER_RADIUS,
      clusterMaxZoom: CLUSTER_MAX_ZOOM,
    });
    expect(NODE_CLUSTER_MIN_POINTS).toBe(CLUSTER_MIN_POINTS);
    expect(CLUSTER_MIN_POINTS).toBe(2);
  });

  it("synchronizes the actual MapLibre source instead of trusting React-only state", () => {
    const setClusterOptions = vi.fn();
    const source = { setClusterOptions } as unknown as GeoJSONSource;

    applyNodeClusterMode(source, true);
    expect(setClusterOptions).toHaveBeenCalledWith({
      cluster: true,
      clusterRadius: CLUSTER_RADIUS,
      clusterMaxZoom: CLUSTER_MAX_ZOOM,
    });

    applyNodeClusterMode(source, false);
    expect(setClusterOptions).toHaveBeenLastCalledWith({
      cluster: false,
      clusterRadius: CLUSTER_RADIUS,
      clusterMaxZoom: CLUSTER_MAX_ZOOM,
    });
  });
});
