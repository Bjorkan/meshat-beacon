import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import maplibregl from 'maplibre-gl';
import type { Map as MapLibreMap, GeoJSONSource } from 'maplibre-gl';
import { mapStyleForTheme, resolveMapStyle } from '../map/types';
import { useTheme } from '../../hooks/useTheme';
import type { Node } from './types';

// Self-contained single-node map for the node detail Location section. Dedicated MapLibre instance
// showing only this node: no /nodes list, no neighbors, no borders, no packet flow, no clustering.
export function NodeLocationMap({ node }: { node: Node }) {
  const { themeId } = useTheme();
  const [attempt, setAttempt] = useState(0);
  return (
    <LocationCanvas
      key={`${themeId}:${attempt}`}
      node={node}
      onRetry={() => setAttempt((n) => n + 1)}
    />
  );
}

function LocationCanvas({ node, onRetry }: { node: Node; onRetry: () => void }) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
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
    // Tiny panel map: keep the credit as a bare (i) so it never covers the
    // node dot. MapLibre pops the compact control open on load (adds
    // .maplibregl-compact-show), so strip it up front; clicking still opens it.
    // (Same trick as useMapLibre/PacketPathMap.)
    const attrib = map.getContainer().querySelector('.maplibregl-ctrl-attrib');
    attrib?.classList.add('maplibregl-compact');
    attrib?.classList.remove('maplibregl-compact-show');
    let failed = false;
    const onError = () => {
      failed = true;
      setStatus('error');
    };
    const onLoad = () => {
      if (!failed) setStatus('ready');
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
    map.on('error', onError);
    const timeout = window.setTimeout(() => {
      if (!map.loaded()) onError();
    }, 15000);
    return () => {
      window.clearTimeout(timeout);
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
    <div className="space-y-1">
      <div className="relative h-36 overflow-hidden rounded-md border border-border bg-bg-base">
        <div ref={containerRef} data-testid="node-location-map" className="h-full w-full" />
        {status !== 'ready' && (
          <div
            className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-bg-base/95 px-3 text-center font-mono text-xs text-text-muted"
            role="status"
          >
            <span>{t(status === 'loading' ? 'map.loadingLocation' : 'map.failedLocation')}</span>
            {status === 'error' && (
              <button
                type="button"
                className="rounded border border-border px-3 py-1.5 text-text-normal hover:bg-bg-raised"
                onClick={onRetry}
              >
                {t('common.retry')}
              </button>
            )}
          </div>
        )}
      </div>
      <p className="font-mono text-xs text-text-muted">
        {node.lat?.toFixed(5)}, {node.lng?.toFixed(5)}
      </p>
    </div>
  );
}
