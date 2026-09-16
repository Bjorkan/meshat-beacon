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
import type { TraceLegProps, TracePath, TracePointProps } from './trace-path';
import { tracePathsToFeatures, traceSnrPalette } from './trace-path';
import { resolveMapStyle, DEFAULT_CENTER, DEFAULT_ZOOM, IATA_ZOOM } from '../map/types';

// Private ids — denna kartinstans är dedikerad till trace-detaljen och kan inte
// kollidera med Kart-flikens karta eller Paketsökvägens popup-karta.
const TRACE_LINE_SOURCE = 'trace-legs';
const TRACE_LINE_LAYER = 'trace-legs';
const TRACE_NODE_SOURCE = 'trace-nodes';
const TRACE_NODE_LAYER = 'trace-nodes';
const TRACE_NODE_LABEL_LAYER = 'trace-node-labels';

function paletteVar(name: string, fallback: string): string {
  try {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  } catch {
    return fallback;
  }
}

function TraceCanvas({
  paths,
  selectedKey,
  styleId,
  onRetry,
}: {
  paths: TracePath[];
  selectedKey: string | null;
  styleId: string;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [ready, setReady] = useState(false);

  // build the map once (styleId is read at creation; theme switches remount via key in the caller)
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
    // start the attribution as a bare (i) instead of the wide expanded bar it pops open on load —
    // on mobile that bar overlaps the packet list beneath the map (same trick as useMapLibre)
    const attrib = map.getContainer().querySelector('.maplibregl-ctrl-attrib');
    attrib?.classList.add('maplibregl-compact');
    attrib?.classList.remove('maplibregl-compact-show');
    // klick på en nod → popup med namn + råa decimalkoordinater; klick på ett ben → popup med
    // ändpunkter + SNR. Pekarcursor vid hover.
    map.on('click', TRACE_NODE_LAYER, (e) => {
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
      const packet = document.createElement('div');
      packet.className = 'pp-popup-coords';
      packet.textContent = (f.properties?.packetLabel as string) ?? '';
      el.append(name, coords, packet);
      new maplibregl.Popup({ closeButton: false, closeOnClick: true, offset: 10 })
        .setLngLat([lng, lat])
        .setDOMContent(el)
        .addTo(map);
    });
    const onEnter = () => {
      map.getCanvas().style.cursor = 'pointer';
    };
    const onLeave = () => {
      map.getCanvas().style.cursor = '';
    };
    map.on('click', TRACE_LINE_LAYER, (e) => {
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
    map.on('mouseenter', TRACE_NODE_LAYER, onEnter);
    map.on('mouseleave', TRACE_NODE_LAYER, onLeave);
    map.on('mouseenter', TRACE_LINE_LAYER, onEnter);
    map.on('mouseleave', TRACE_LINE_LAYER, onLeave);
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

  // (re)build layers, push data, and frame the shown paths whenever data or selection changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const palette = traceSnrPalette();
    const { lines, points, bounds } = tracePathsToFeatures(paths, selectedKey, palette);

    if (!map.getSource(TRACE_LINE_SOURCE))
      map.addSource(TRACE_LINE_SOURCE, { type: 'geojson', data: lines });
    if (!map.getLayer(TRACE_LINE_LAYER)) {
      map.addLayer({
        id: TRACE_LINE_LAYER,
        type: 'line',
        source: TRACE_LINE_SOURCE,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          // benets egen SNR-färg — samma stops som Kart-flikens grannlinjer
          'line-color': ['get', 'snrColor'],
          'line-width': 2.5,
          'line-opacity': 0.9,
        },
      } as LineLayerSpecification);
    }
    if (!map.getSource(TRACE_NODE_SOURCE))
      map.addSource(TRACE_NODE_SOURCE, { type: 'geojson', data: points });
    if (!map.getLayer(TRACE_NODE_LAYER)) {
      map.addLayer({
        id: TRACE_NODE_LAYER,
        type: 'circle',
        source: TRACE_NODE_SOURCE,
        paint: {
          'circle-radius': ['case', ['==', ['get', 'endpoint'], 'mid'], 4, 6],
          // paketfärg på noden (samma som väljaren) — benfärgen ägs av SNR-skalan
          'circle-color': ['get', 'color'],
          // white ring marks the trace-end node; every other node gets a dark ring
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
    if (!map.getLayer(TRACE_NODE_LABEL_LAYER)) {
      map.addLayer({
        id: TRACE_NODE_LABEL_LAYER,
        type: 'symbol',
        source: TRACE_NODE_SOURCE,
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

    (map.getSource(TRACE_LINE_SOURCE) as GeoJSONSource).setData(lines);
    (map.getSource(TRACE_NODE_SOURCE) as GeoJSONSource).setData(points);

    if (bounds.length) {
      const b = bounds.reduce(
        (acc, p) => acc.extend(p),
        new maplibregl.LngLatBounds(bounds[0], bounds[0]),
      );
      map.fitBounds(b, { padding: 60, maxZoom: IATA_ZOOM });
    }
  }, [ready, paths, selectedKey]);

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

// Egen MapLibre-karta som ritar en trace-taggs paket som verifierbara ben.
// Varje ben bär sin egen snrColor: samma SNR-skala som grannlinjerna på Kart-fliken
// (danger/warn/green + blå fallback utan mätvärde). Bara fail-closed verifierade ben
// når hit — tvetydiga hopp undanhåller hela paketet (samma spärr som Paketsökvägen).
// Äger sin egen instans och rör aldrig Kart-flikens karta. Laddas via
// TracePathMapLazy så startpaketet aldrig betalar MapLibre-kostnaden, och visar
// ladd/fel-tillstånd som Nod-detaljens platskarta medan tiles hämtas.
export function TracePathMapInner({
  paths,
  selectedKey,
  styleId,
}: {
  paths: TracePath[];
  selectedKey: string | null;
  styleId: string;
}) {
  const [attempt, setAttempt] = useState(0);
  return (
    <TraceCanvas
      key={`${styleId}:${attempt}`}
      paths={paths}
      selectedKey={selectedKey}
      styleId={styleId}
      onRetry={() => setAttempt((n) => n + 1)}
    />
  );
}

export type { TraceLegProps, TracePointProps };
