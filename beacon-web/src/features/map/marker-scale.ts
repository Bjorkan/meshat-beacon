// Overview zooms present ungrouped nodes as compact category-coloured dots — the standard
// low-zoom presentation — then crossfade into capsule node IDs past z8. The capsule layer is
// zoom-gated in useMapNodes, so tiles below that zoom never request capsule images at all and
// hundreds of unique icons can no longer pile up. Live mode keeps the quiet dot presentation
// for animated packet paths.
import type { ExpressionSpecification } from 'maplibre-gl';

export type NumericStop = readonly [input: number, output: number];

export const NODE_ICON_SCALE_STOPS: readonly NumericStop[] = [
  [8, 0.85],
  [13, 1],
];

export const NODE_ICON_OPACITY_STOPS: readonly NumericStop[] = [
  [0, 0],
  [8, 0],
  [9, 1],
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
  [8.5, 0.55],
  [9, 0],
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

export function zoomInterpolate(stops: readonly NumericStop[]): ExpressionSpecification {
  return ['interpolate', ['linear'], ['zoom'], ...stops.flatMap(([zoom, value]) => [zoom, value])];
}

export function propertyInterpolate(
  property: string,
  stops: readonly NumericStop[],
): ExpressionSpecification {
  return [
    'interpolate',
    ['linear'],
    ['get', property],
    ...stops.flatMap(([value, output]) => [value, output]),
  ];
}

export function nodeIconSizeExpression(): ExpressionSpecification {
  return zoomInterpolate(NODE_ICON_SCALE_STOPS);
}

export function nodeIconOpacityExpression(liveMode = false): number | ExpressionSpecification {
  return liveMode ? 0 : zoomInterpolate(NODE_ICON_OPACITY_STOPS);
}

export function nodeDotRadiusExpression(liveMode = false): number | ExpressionSpecification {
  return liveMode ? LIVE_NODE_RADIUS_PX : zoomInterpolate(NODE_DOT_RADIUS_STOPS);
}

export function nodeDotOpacityExpression(liveMode = false): number | ExpressionSpecification {
  return liveMode ? LIVE_NODE_OPACITY : zoomInterpolate(NODE_DOT_OPACITY_STOPS);
}

export function selectionRadiusExpression(liveMode = false): number | ExpressionSpecification {
  return liveMode ? LIVE_SELECTION_RADIUS_PX : zoomInterpolate(SELECTION_RADIUS_STOPS);
}

export function shouldClusterNodes(clustered: boolean, liveMode: boolean): boolean {
  return clustered && !liveMode;
}

export function selectionStrokeExpression(): ExpressionSpecification {
  return zoomInterpolate(SELECTION_STROKE_STOPS);
}

export function clusterRadiusExpression(): ExpressionSpecification {
  return propertyInterpolate('point_count', CLUSTER_RADIUS_STOPS);
}

// Glow radius = zoom-scaled base plus a feature-state-driven bloom. The plus expression is
// hoisted so the flatMap pairs stay (number | ExpressionSpecification)[] and the whole array
// satisfies the interpolate arm of ExpressionSpecification.
export function glowRadiusExpression(): ExpressionSpecification {
  const plusGlow = (base: number, extra: number): ExpressionSpecification => [
    '+',
    base,
    ['*', extra, ['coalesce', ['feature-state', 'glow'], 0]],
  ];
  return [
    'interpolate',
    ['linear'],
    ['zoom'],
    ...GLOW_BASE_RADIUS_STOPS.flatMap(([zoom, base], index) => [
      zoom,
      plusGlow(base, GLOW_EXTRA_RADIUS_STOPS[index]![1]),
    ]),
  ];
}
