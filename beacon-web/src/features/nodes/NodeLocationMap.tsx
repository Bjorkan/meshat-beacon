import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import type { Map as MapLibreMap, GeoJSONSource } from 'maplibre-gl';
import { mapStyleForTheme, resolveMapStyle } from '../map/types';
import { useTheme } from '../../hooks/useTheme';
import type { Node } from './types';

// Self-contained single-node map for the node detail Location section. Dedicated MapLibre instance
// showing only this node: no /nodes list, no neighbors, no borders, no packet flow, no clustering.
export function NodeLocationMap({ node }: { node: Node }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const { themeId } = useTheme();
  const styleId = mapStyleForTheme(themeId);

  useEffect(() => {
    if (!containerRef.current || node.lat == null || node.lng == null) return;
    const lat = node.lat;
    const lng = node.lng;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: resolveMapStyle(styleId).url,
      center: [lng, lat],
      zoom: 12,
      attributionControl: false,
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.addControl(new maplibregl.AttributionControl({ compact: true }));
    const onLoad = () => {
      if (!map.getSource('node-location')) {
        map.addSource('node-location', {
          type: 'geojson',
          data: {
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                properties: {},
                geometry: { type: 'Point', coordinates: [lng, lat] as [number, number] },
              },
            ],
          },
        });
      }
      if (!map.getLayer('node-location-dot')) {
        map.addLayer({
          id: 'node-location-dot',
          type: 'circle',
          source: 'node-location',
          paint: {
            'circle-radius': 7,
            'circle-color': '#f97316',
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 2,
          },
        });
      }
    };
    map.on('load', onLoad);
    return () => {
      map.remove();
      mapRef.current = null;
    };
    // styleId intentionally read at creation; theme switches remount via key in the caller.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [styleId]);

  // Recenter when the selected node's coordinates change while the panel stays open.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || node.lat == null || node.lng == null) return;
    const lat = node.lat;
    const lng = node.lng;
    try {
      map.setCenter([lng, lat]);
      (map.getSource('node-location') as GeoJSONSource | undefined)?.setData({
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: {},
            geometry: { type: 'Point', coordinates: [lng, lat] as [number, number] },
          },
        ],
      });
    } catch {
      // map tearing down
    }
  }, [node.lat, node.lng]);

  return (
    <div
      ref={containerRef}
      data-testid="node-location-map"
      className="h-36 w-full overflow-hidden rounded-md border border-border"
    />
  );
}
