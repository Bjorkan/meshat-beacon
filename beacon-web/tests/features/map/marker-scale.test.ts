import { describe, expect, it } from "vitest";
import {
  CLUSTER_RADIUS_STOPS,
  CLUSTER_TEXT_SIZE_STOPS,
  GLOW_BASE_RADIUS_STOPS,
  GLOW_EXTRA_RADIUS_STOPS,
  NODE_DOT_OPACITY_STOPS,
  NODE_ICON_OPACITY_STOPS,
  NODE_ICON_SCALE_STOPS,
  NODE_INTERACTION_RADIUS_PX,
  LIVE_NODE_OPACITY,
  LIVE_NODE_RADIUS_PX,
  LIVE_SELECTION_RADIUS_PX,
  SELECTION_RADIUS_STOPS,
  clusterRadiusExpression,
  clusterTextSizeExpression,
  glowRadiusExpression,
  nodeDotOpacityExpression,
  nodeDotRadiusExpression,
  nodeIconOpacityExpression,
  nodeIconSizeExpression,
  selectionRadiusExpression,
  shouldClusterNodes,
} from "../../../src/features/map/marker-scale";
import { CLUSTER_MAX_ZOOM, CLUSTER_RADIUS } from "../../../src/features/map/types";

function values(stops: readonly (readonly [number, number])[]): number[] {
  return stops.map(([, value]) => value);
}

function inputs(stops: readonly (readonly [number, number])[]): number[] {
  return stops.map(([input]) => input);
}

describe("zoom-aware map marker sizing", () => {
  it("keeps node icon scale monotonic and bounded", () => {
    expect(inputs(NODE_ICON_SCALE_STOPS)).toEqual([...inputs(NODE_ICON_SCALE_STOPS)].sort((a, b) => a - b));
    const scale = values(NODE_ICON_SCALE_STOPS);
    expect(scale[0]).toBeGreaterThan(0);
    expect(scale[0]).toBeLessThan(0.3);
    expect(scale.at(-1)).toBe(1);
    for (let i = 1; i < scale.length; i += 1) expect(scale[i]!).toBeGreaterThanOrEqual(scale[i - 1]!);
  });

  it("crossfades low-zoom dots into full node icons", () => {
    expect(NODE_ICON_OPACITY_STOPS[0]).toEqual([0, 0]);
    expect(NODE_ICON_OPACITY_STOPS.at(-1)?.[1]).toBe(1);
    expect(NODE_DOT_OPACITY_STOPS[0]?.[1]).toBeGreaterThan(0.9);
    expect(NODE_DOT_OPACITY_STOPS.at(-1)?.[1]).toBe(0);
  });

  it("uses uniform node dots and no detailed icons in Live mode", () => {
    expect(nodeDotRadiusExpression(true)).toBe(LIVE_NODE_RADIUS_PX);
    expect(nodeDotOpacityExpression(true)).toBe(LIVE_NODE_OPACITY);
    expect(nodeIconOpacityExpression(true)).toBe(0);
    expect(selectionRadiusExpression(true)).toBe(LIVE_SELECTION_RADIUS_PX);
  });

  it("temporarily disables visual clustering in Live mode", () => {
    expect(shouldClusterNodes(true, false)).toBe(true);
    expect(shouldClusterNodes(false, false)).toBe(false);
    expect(shouldClusterNodes(true, true)).toBe(false);
    expect(shouldClusterNodes(false, true)).toBe(false);
  });

  it("uses CoreScope-like cluster grouping at overview zoom while stopping before close inspection", () => {
    expect(CLUSTER_RADIUS).toBeGreaterThanOrEqual(50);
    expect(CLUSTER_RADIUS).toBeLessThanOrEqual(65);
    expect(CLUSTER_MAX_ZOOM).toBeGreaterThanOrEqual(15);
    expect(CLUSTER_MAX_ZOOM).toBeLessThanOrEqual(16);
  });

  it("grows neutral cluster bubbles and text with point count, not map zoom", () => {
    expect(inputs(CLUSTER_RADIUS_STOPS)).toEqual([...inputs(CLUSTER_RADIUS_STOPS)].sort((a, b) => a - b));
    expect(inputs(CLUSTER_TEXT_SIZE_STOPS)).toEqual([...inputs(CLUSTER_TEXT_SIZE_STOPS)].sort((a, b) => a - b));
    const radius = values(CLUSTER_RADIUS_STOPS);
    const text = values(CLUSTER_TEXT_SIZE_STOPS);
    for (let i = 1; i < radius.length; i += 1) expect(radius[i]!).toBeGreaterThanOrEqual(radius[i - 1]!);
    for (let i = 1; i < text.length; i += 1) expect(text[i]!).toBeGreaterThanOrEqual(text[i - 1]!);
    expect(radius[0]).toBe(20); // 40px bubble for tiny clusters
    expect(radius.at(-1)).toBeLessThanOrEqual(32);
  });

  it("keeps a practical click radius even when overview dots are tiny", () => {
    expect(NODE_INTERACTION_RADIUS_PX).toBeGreaterThanOrEqual(8);
    expect(NODE_INTERACTION_RADIUS_PX).toBeLessThanOrEqual(14);
  });

  it("keeps the selection treatment aligned with the marker scale", () => {
    const radius = values(SELECTION_RADIUS_STOPS);
    expect(radius[0]).toBeLessThan(radius.at(-1)!);
    expect(radius.at(-1)).toBe(14.5);
  });

  it("builds MapLibre expressions from the tested stops", () => {
    expect(nodeIconSizeExpression()).toEqual([
      "interpolate", ["linear"], ["zoom"],
      ...NODE_ICON_SCALE_STOPS.flatMap(([zoom, value]) => [zoom, value]),
    ]);
    expect(nodeDotOpacityExpression()).toEqual([
      "interpolate", ["linear"], ["zoom"],
      ...NODE_DOT_OPACITY_STOPS.flatMap(([zoom, value]) => [zoom, value]),
    ]);
    expect(selectionRadiusExpression()).toEqual([
      "interpolate", ["linear"], ["zoom"],
      ...SELECTION_RADIUS_STOPS.flatMap(([zoom, value]) => [zoom, value]),
    ]);
    expect(clusterRadiusExpression()).toEqual([
      "interpolate", ["linear"], ["get", "point_count"],
      ...CLUSTER_RADIUS_STOPS.flatMap(([count, value]) => [count, value]),
    ]);
    expect(clusterTextSizeExpression()).toEqual([
      "interpolate", ["linear"], ["get", "point_count"],
      ...CLUSTER_TEXT_SIZE_STOPS.flatMap(([count, value]) => [count, value]),
    ]);
    expect(glowRadiusExpression()).toEqual([
      "interpolate", ["linear"], ["zoom"],
      ...GLOW_BASE_RADIUS_STOPS.flatMap(([zoom, base], index) => [
        zoom,
        ["+", base, ["*", GLOW_EXTRA_RADIUS_STOPS[index]![1], ["coalesce", ["feature-state", "glow"], 0]]],
      ]),
    ]);
  });
});
