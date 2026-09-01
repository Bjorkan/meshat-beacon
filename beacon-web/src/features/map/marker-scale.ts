// Zoom-aware marker sizing for the network map. Kept maplibre-free so the visual contract can be
// unit-tested without WebGL. The low-zoom dot → icon crossfade is intentionally gradual: a country/
// region overview should read like a network distribution map, while close zoom keeps the full
// Beacon glyphs and their observer pip.

export type NumericStop = readonly [input: number, output: number];

export const NODE_ICON_SCALE_STOPS: readonly NumericStop[] = [
  [0, 0.2],
  [7.5, 0.3],
  [8.5, 0.45],
  [10, 0.62],
  [11.5, 0.8],
  [13, 1],
];

export const NODE_ICON_OPACITY_STOPS: readonly NumericStop[] = [
  [0, 0],
  [7.6, 0],
  [8.5, 0.45],
  [9.5, 1],
];

export const NODE_DOT_RADIUS_STOPS: readonly NumericStop[] = [
  [0, 1.6],
  [5, 2],
  [7.5, 2.4],
  [8.8, 2.9],
  [10, 3.2],
];

export const NODE_DOT_OPACITY_STOPS: readonly NumericStop[] = [
  [0, 0.94],
  [7.5, 0.94],
  [8.7, 0.72],
  [9.6, 0],
];

export const SELECTION_RADIUS_STOPS: readonly NumericStop[] = [
  [0, 5.5],
  [6, 6],
  [8, 7.5],
  [9.5, 10],
  [11.5, 12.5],
  [13, 14.5],
];

export const SELECTION_STROKE_STOPS: readonly NumericStop[] = [
  [0, 1],
  [8, 1.2],
  [10, 1.4],
  [13, 1.6],
];

export const NODE_INTERACTION_RADIUS_PX = 10;

// Live presentation: every node is the same compact dot at every zoom. Colour can still encode
// role, but size and visual weight stay uniform so packet paths/trails become the dominant signal.
export const LIVE_NODE_RADIUS_PX = 2.6;
export const LIVE_NODE_OPACITY = 0.88;
export const LIVE_NODE_STROKE_WIDTH_PX = 0.8;
export const LIVE_SELECTION_RADIUS_PX = 5.5;

export const CLUSTER_RADIUS_STOPS: readonly NumericStop[] = [
  [2, 20],
  [30, 24],
  [100, 28],
  [500, 30],
];

export const CLUSTER_TEXT_SIZE_STOPS: readonly NumericStop[] = [
  [2, 13],
  [30, 14],
  [100, 16],
  [500, 17],
];

export const GLOW_BASE_RADIUS_STOPS: readonly NumericStop[] = [
  [0, 4],
  [7, 5],
  [9, 6.5],
  [11, 8],
  [13, 9],
];

export const GLOW_EXTRA_RADIUS_STOPS: readonly NumericStop[] = [
  [0, 7],
  [7, 8],
  [9, 10],
  [11, 13],
  [13, 15],
];

export function zoomInterpolate(stops: readonly NumericStop[]): unknown[] {
  return ["interpolate", ["linear"], ["zoom"], ...stops.flatMap(([zoom, value]) => [zoom, value])];
}

export function propertyInterpolate(property: string, stops: readonly NumericStop[]): unknown[] {
  return ["interpolate", ["linear"], ["get", property], ...stops.flatMap(([value, output]) => [value, output])];
}

export function nodeIconSizeExpression(): unknown[] {
  return zoomInterpolate(NODE_ICON_SCALE_STOPS);
}

export function nodeIconOpacityExpression(liveMode = false): unknown[] | number {
  return liveMode ? 0 : zoomInterpolate(NODE_ICON_OPACITY_STOPS);
}

export function nodeDotRadiusExpression(liveMode = false): unknown[] | number {
  return liveMode ? LIVE_NODE_RADIUS_PX : zoomInterpolate(NODE_DOT_RADIUS_STOPS);
}

export function nodeDotOpacityExpression(liveMode = false): unknown[] | number {
  return liveMode ? LIVE_NODE_OPACITY : zoomInterpolate(NODE_DOT_OPACITY_STOPS);
}

export function selectionRadiusExpression(liveMode = false): unknown[] | number {
  return liveMode ? LIVE_SELECTION_RADIUS_PX : zoomInterpolate(SELECTION_RADIUS_STOPS);
}

export function shouldClusterNodes(clustered: boolean, liveMode: boolean): boolean {
  return clustered && !liveMode;
}

export function selectionStrokeExpression(): unknown[] {
  return zoomInterpolate(SELECTION_STROKE_STOPS);
}

export function clusterRadiusExpression(): unknown[] {
  return propertyInterpolate("point_count", CLUSTER_RADIUS_STOPS);
}

export function clusterTextSizeExpression(): unknown[] {
  return propertyInterpolate("point_count", CLUSTER_TEXT_SIZE_STOPS);
}

export function glowRadiusExpression(): unknown[] {
  return [
    "interpolate",
    ["linear"],
    ["zoom"],
    ...GLOW_BASE_RADIUS_STOPS.flatMap(([zoom, base], index) => [
      zoom,
      [
        "+",
        base,
        ["*", GLOW_EXTRA_RADIUS_STOPS[index]![1], ["coalesce", ["feature-state", "glow"], 0]],
      ],
    ]),
  ];
}
