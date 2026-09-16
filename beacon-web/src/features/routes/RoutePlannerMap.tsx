// RoutePlannerMap: dedicated MapLibre instance drawing computed best routes
// (TracePathMap pattern: own instance, setData + fitBounds, per-leg snrColor
// on the shared neighbor-link scale, blue = unmeasured). The best path draws
// at full opacity; alternatives dimmed. Never dashed — every leg shown was
// computed, none is uncertain.
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import maplibregl from 'maplibre-gl';
import type {
  Map as MapLibreMap,
  GeoJSONSource,
  LineLayerSpecification,
  CircleLayerSpecification,
  SymbolLayerSpecification,
} from 'maplibre-gl';
import type { Point } from 'geojson';
import type { PlannedRoute } from '../../types/api';
import { traceSnrPalette } from '../traces/trace-path';
import { routesToFeatures } from './route-features';
import { resolveMapStyle, DEFAULT_CENTER, DEFAULT_ZOOM, IATA_ZOOM } from '../map/types';

const ROUTE_LINE_SOURCE = 'route-legs';
const ROUTE_LINE_LAYER = 'route-legs';
const ROUTE_NODE_SOURCE = 'route-nodes';
const ROUTE_NODE_LAYER = 'route-nodes';
const ROUTE_NODE_LABEL_LAYER = 'route-node-labels';

function paletteVar(name: string, fallback: string): string {
  try {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  } catch {
    return fallback;
  }
}

function RouteCanvas({
  paths,
  activeIndex,
  styleId,
  onRetry,
}: {
  paths: PlannedRoute[];
  activeIndex: number;
  styleId: string;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (mapRef.current || !containerRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: resolveMapStyle(styleId).url,
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      attributionControl: false,
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.addControl(new maplibregl.AttributionControl({ compact: true }));
    const attrib = map.getContainer().querySelector('.maplibregl-ctrl-attrib');
    attrib?.classList.add('maplibregl-compact');
    attrib?.classList.remove('maplibregl-compact-show');
    map.on('click', ROUTE_NODE_LAYER, (e) => {
      const f = e.features?.[0];
      if (!f) return;
      const [lng, lat] = (f.geometry as Point).coordinates as [number, number];
      const el = document.createElement('div');
      const name = document.createElement('div');
      name.className = 'pp-popup-name';
      name.textContent = (f.properties?.title as string) ?? '';
      const coords = document.createElement('div');
      coords.className = 'pp-popup-coords';
      coords.textContent = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
      el.append(name, coords);
      new maplibregl.Popup({ closeButton: false, closeOnClick: true, offset: 10 })
        .setLngLat([lng, lat])
        .setDOMContent(el)
        .addTo(map);
    });
    map.on('click', ROUTE_LINE_LAYER, (e) => {
      const f = e.features?.[0];
      if (!f) return;
      const el = document.createElement('div');
      const name = document.createElement('div');
      name.className = 'pp-popup-name';
      name.textContent = (f.properties?.label as string) ?? '';
      el.append(name);
      new maplibregl.Popup({ closeButton: false, closeOnClick: true, offset: 10 })
        .setLngLat([e.lngLat.lng, e.lngLat.lat])
        .setDOMContent(el)
        .addTo(map);
    });
    const onEnter = () => {
      map.getCanvas().style.cursor = 'pointer';
    };
    const onLeave = () => {
      map.getCanvas().style.cursor = '';
    };
    map.on('mouseenter', ROUTE_NODE_LAYER, onEnter);
    map.on('mouseleave', ROUTE_NODE_LAYER, onLeave);
    map.on('mouseenter', ROUTE_LINE_LAYER, onEnter);
    map.on('mouseleave', ROUTE_LINE_LAYER, onLeave);
    let failed = false;
    const onError = () => {
      failed = true;
      setStatus('error');
    };
    const onLoad = () => {
      setReady(true);
      if (!failed) setStatus('ready');
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
      setReady(false);
    };
  }, [styleId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const palette = traceSnrPalette();
    const { lines, points, bounds } = routesToFeatures(paths, activeIndex, palette);

    if (!map.getSource(ROUTE_LINE_SOURCE))
      map.addSource(ROUTE_LINE_SOURCE, { type: 'geojson', data: lines });
    if (!map.getLayer(ROUTE_LINE_LAYER)) {
      map.addLayer({
        id: ROUTE_LINE_LAYER,
        type: 'line',
        source: ROUTE_LINE_SOURCE,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ['get', 'snrColor'],
          'line-width': 2.5,
          // alternatives dimmed so the active route reads as "the" route
          'line-opacity': ['case', ['get', 'active'], 0.95, 0.35],
        },
      } as LineLayerSpecification);
    }
    if (!map.getSource(ROUTE_NODE_SOURCE))
      map.addSource(ROUTE_NODE_SOURCE, { type: 'geojson', data: points });
    if (!map.getLayer(ROUTE_NODE_LAYER)) {
      map.addLayer({
        id: ROUTE_NODE_LAYER,
        type: 'circle',
        source: ROUTE_NODE_SOURCE,
        paint: {
          'circle-radius': ['case', ['==', ['get', 'endpoint'], 'mid'], 4, 6],
          'circle-color': '#ff6b35',
          'circle-opacity': ['case', ['get', 'active'], 1, 0.45],
          'circle-stroke-width': 2,
          'circle-stroke-color': [
            'case',
            ['==', ['get', 'endpoint'], 'end'],
            '#ffffff',
            '#00000088',
          ],
        },
      } as CircleLayerSpecification);
    }
    if (!map.getLayer(ROUTE_NODE_LABEL_LAYER)) {
      map.addLayer({
        id: ROUTE_NODE_LABEL_LAYER,
        type: 'symbol',
        source: ROUTE_NODE_SOURCE,
        layout: {
          'text-field': ['get', 'label'],
          'text-size': 11,
          'text-offset': [0, 1.1],
          'text-anchor': 'top',
          'text-optional': true,
        },
        paint: {
          'text-color': paletteVar('--palette-text-bright', '#e5e7eb'),
          'text-halo-color': paletteVar('--palette-bg-base', '#0a0a0a'),
          'text-halo-width': 1.4,
        },
      } as SymbolLayerSpecification);
    }

    (map.getSource(ROUTE_LINE_SOURCE) as GeoJSONSource).setData(lines);
    (map.getSource(ROUTE_NODE_SOURCE) as GeoJSONSource).setData(points);

    if (bounds.length) {
      const b = bounds.reduce(
        (acc, p) => acc.extend(p),
        new maplibregl.LngLatBounds(bounds[0], bounds[0]),
      );
      map.fitBounds(b, { padding: 60, maxZoom: IATA_ZOOM });
    }
  }, [ready, paths, activeIndex]);

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} data-dark={resolveMapStyle(styleId).dark} className="h-full w-full" />
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
  );
}

export function RoutePlannerMapInner({
  paths,
  activeIndex,
  styleId,
}: {
  paths: PlannedRoute[];
  activeIndex: number;
  styleId: string;
}) {
  const [attempt, setAttempt] = useState(0);
  return (
    <RouteCanvas
      key={`${styleId}:${attempt}`}
      paths={paths}
      activeIndex={activeIndex}
      styleId={styleId}
      onRetry={() => setAttempt((n) => n + 1)}
    />
  );
}
