import { describe, expect, it } from "vitest";
import { CLUSTER_FALLBACK_ZOOM_STEP, clusterClickDecision, fallbackClusterZoom } from "../../../src/features/map/cluster-navigation";

describe("clusterClickDecision", () => {
  it("zooms to MapLibre's natural expansion zoom within the ceiling", () => {
    expect(clusterClickDecision(8, 10, 15)).toEqual({ type: "zoom", zoom: 10 });
  });

  it("zooms to the map ceiling before spiderfying a co-located cluster", () => {
    expect(clusterClickDecision(14, 18, 15)).toEqual({ type: "zoom", zoom: 15 });
  });

  it("spiderfies only when there is no useful zoom left", () => {
    expect(clusterClickDecision(15, 18, 15)).toEqual({ type: "spiderfy" });
    expect(clusterClickDecision(15, 15, 15)).toEqual({ type: "spiderfy" });
  });

  it("uses a bounded fallback step when MapLibre cannot resolve expansion zoom", () => {
    expect(fallbackClusterZoom(10, 22)).toBe(10 + CLUSTER_FALLBACK_ZOOM_STEP);
    expect(fallbackClusterZoom(21, 22)).toBe(22);
    expect(fallbackClusterZoom(22, 22)).toBeNull();
  });
});
