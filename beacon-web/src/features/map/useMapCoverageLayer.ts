import { useEffect, useRef } from 'react';
import type { Map as MapLibreMap, GeoJSONSource, FillLayerSpecification } from 'maplibre-gl';
import type { FeatureCollection, Polygon } from 'geojson';
import { effectiveColor, pingAgeOpacity, type CoverageCell, type CoverageMode } from './coverage';
import { COVERAGE_FILL_LAYER_ID, COVERAGE_SOURCE_ID, NODES_CLUSTER_LAYER_ID } from './types';
import { syncMapOverlayLayerOrder } from './map-layer-order';

export interface CoverageFeatureProps {
  gridId: string;
  effective: number;
  coverageType: string;
  age: number;
  'fill-color': string;
  'fill-opacity': number;
}

// Build one polygon feature per cell. Fill color encodes the active mode:
// effective → quality ramp; age → freshness opacity on a neutral green.
export function coverageToFeatureCollection(
  cells: CoverageCell[],
  mode: CoverageMode,
  nowMs: number,
): FeatureCollection<Polygon, CoverageFeatureProps> {
  return {
    type: 'FeatureCollection',
    features: cells.map((c) => {
      const fill = mode === 'age' ? 'rgb(30,126,52)' : effectiveColor(c.effective);
      const opacity = mode === 'age' ? pingAgeOpacity(c.timestamp, nowMs) : 0.45;
      return {
        type: 'Feature',
        properties: {
          gridId: c.gridId,
          effective: c.effective,
          coverageType: c.coverageType,
          age: c.timestamp ?? 0,
          'fill-color': fill,
          'fill-opacity': opacity,
        },
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [c.bounds.west, c.bounds.south],
              [c.bounds.east, c.bounds.south],
              [c.bounds.east, c.bounds.north],
              [c.bounds.west, c.bounds.north],
              [c.bounds.west, c.bounds.south],
            ],
          ],
        },
      };
    }),
  };
}

// Draws the MeshMapper coverage grid as translucent fills beneath nodes/markers.
// Mirrors useMapBorders: source/layer re-add after style switches, data pushes
// via setData so toggling never rebuilds.
export function useMapCoverageLayer(
  mapRef: React.RefObject<MapLibreMap | null>,
  isReady: boolean,
  cells: CoverageCell[],
  mode: CoverageMode,
  themeKey: string,
) {
  const dataRef = useRef<FeatureCollection<Polygon, CoverageFeatureProps> | null>(null);
  // Build the collection in an effect (not during render): Date.now() is impure, and the
  // sibling useMapBorders hook follows the same ref-sync pattern.
  useEffect(() => {
    dataRef.current = coverageToFeatureCollection(cells, mode, Date.now());
  }, [cells, mode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isReady) return;
    if (mode === 'off') {
      try {
        if (map.getLayer(COVERAGE_FILL_LAYER_ID)) map.removeLayer(COVERAGE_FILL_LAYER_ID);
        if (map.getSource(COVERAGE_SOURCE_ID)) map.removeSource(COVERAGE_SOURCE_ID);
      } catch {
        // already torn down
      }
      return;
    }
    if (!map.getSource(COVERAGE_SOURCE_ID)) {
      map.addSource(COVERAGE_SOURCE_ID, {
        type: 'geojson',
        data: dataRef.current ?? { type: 'FeatureCollection', features: [] },
      });
    }
    // Insert below the node markers (same anchor as the other underlays) so the
    // translucent fills never cover dots, clusters, labels or packet flow.
    const beforeId = map.getLayer(NODES_CLUSTER_LAYER_ID) ? NODES_CLUSTER_LAYER_ID : undefined;
    if (!map.getLayer(COVERAGE_FILL_LAYER_ID)) {
      map.addLayer(
        {
          id: COVERAGE_FILL_LAYER_ID,
          type: 'fill',
          source: COVERAGE_SOURCE_ID,
          paint: {
            'fill-color': ['get', 'fill-color'],
            'fill-opacity': ['coalesce', ['get', 'fill-opacity'], 0.5],
          },
        } as FillLayerSpecification,
        beforeId,
      );
    }
    syncMapOverlayLayerOrder(map);
    if (dataRef.current) {
      (map.getSource(COVERAGE_SOURCE_ID) as GeoJSONSource).setData(dataRef.current);
    }
    // Force a repaint: with 20k fresh polygons the fill can otherwise sit one
    // frame behind the camera on slow devices.
    try {
      map.triggerRepaint();
    } catch {
      // older maplibre without triggerRepaint
    }
  }, [mapRef, isReady, themeKey, mode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isReady || mode === 'off') return;
    const src = map.getSource(COVERAGE_SOURCE_ID) as GeoJSONSource | undefined;
    if (src && dataRef.current) src.setData(dataRef.current);
  }, [mapRef, isReady, mode, cells]);
}
