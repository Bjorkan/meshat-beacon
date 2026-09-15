import type { FeatureCollection, Point } from 'geojson';
import type { FocusedNeighborPointProps } from './node-geojson';
import { useEffect } from 'react';
import type { ExpressionSpecification, Map as MapLibreMap } from 'maplibre-gl';
import { FOCUSED_NEIGHBORS_LAYER_ID, NEIGHBORS_LINE_LAYER_ID } from './types';

// Paint-only interaction: neither the topology sources nor the permanent selection change.
export function useMapNeighborHighlight(
  mapRef: React.RefObject<MapLibreMap | null>,
  isReady: boolean,
  neighborId: string | null,
  liveMode: boolean,
  themeKey: string,
  focusedPoints: FeatureCollection<Point, FocusedNeighborPointProps>,
) {
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isReady) return;
    const target = neighborId ?? '';
    const edgeMatch: ExpressionSpecification = [
      'all',
      ['==', ['get', 'selected'], true],
      ['==', ['get', 'neighborId'], target],
    ];
    const nodeMatch: ExpressionSpecification = [
      'all',
      ['!=', ['get', 'selected'], true],
      ['==', ['get', 'id'], target],
    ];
    if (map.getLayer(NEIGHBORS_LINE_LAYER_ID)) {
      map.setPaintProperty(NEIGHBORS_LINE_LAYER_ID, 'line-width', [
        'case',
        edgeMatch,
        4,
        ['case', ['get', 'selected'], 2, 1],
      ]);
    }
    if (map.getLayer(FOCUSED_NEIGHBORS_LAYER_ID)) {
      map.setPaintProperty(FOCUSED_NEIGHBORS_LAYER_ID, 'circle-radius', [
        'case',
        nodeMatch,
        liveMode ? 9 : 16,
        liveMode ? 6.5 : 13.5,
      ]);
      map.setPaintProperty(FOCUSED_NEIGHBORS_LAYER_ID, 'circle-stroke-width', [
        'case',
        nodeMatch,
        3,
        liveMode ? 1 : 1.25,
      ]);
      map.setPaintProperty(FOCUSED_NEIGHBORS_LAYER_ID, 'circle-stroke-opacity', [
        'case',
        nodeMatch,
        1,
        0.72,
      ]);
    }
    // Theme/style reloads and focused-point changes may restore the base paints; reapply afterwards.
  }, [mapRef, isReady, neighborId, liveMode, themeKey, focusedPoints]);
}
