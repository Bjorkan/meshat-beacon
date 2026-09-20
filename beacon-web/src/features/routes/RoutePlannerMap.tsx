// RoutePlannerMap: dedicated MapLibre instance drawing computed best routes
// (TracePathMap pattern: own instance, setData + fitBounds). The active route
// keeps per-leg SNR colors on the shared neighbor-link scale (blue =
// unmeasured); every inactive route draws grey so the selection reads like
// Google Maps. The active route additionally replays a live-style hop flow —
// a dot riding the hops with transmit/receive pulses, always on — in a
// dedicated accent color distinct from the SNR/blue scale. Clicking an
// inactive route line selects it. Never dashed — every leg shown was
// computed, none is uncertain.
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useTranslation } from 'react-i18next';
import maplibregl from 'maplibre-gl';
import type {
  Map as MapLibreMap,
  GeoJSONSource,
  LineLayerSpecification,
  CircleLayerSpecification,
  SymbolLayerSpecification,
} from 'maplibre-gl';
import type { Feature, FeatureCollection, LineString, Point } from 'geojson';
import type { PlannedRoute } from '../../types/api';
import { traceSnrPalette } from '../traces/trace-path';
import {
  closestRoute,
  plannedRouteCoords,
  routesToFeatures,
  type RouteEndpoint,
} from './route-features';
import { posAtHop, trailCoords } from '../map/packet-flow';
import {
  PACKET_RELAY_FORWARD_DELAY_MS,
  packetPulseFrame,
  type PacketPulseDirection,
} from '../map/packet-flow-pulses';
import { resolveMapStyle, DEFAULT_CENTER, DEFAULT_ZOOM } from '../map/types';

const ROUTE_LINE_SOURCE = 'route-legs';
const ROUTE_LINE_LAYER = 'route-legs';
const ROUTE_HIT_LAYER = 'route-hit-area';
const ROUTE_NODE_SOURCE = 'route-nodes';
const ROUTE_NODE_LAYER = 'route-nodes';
const ROUTE_NODE_LABEL_LAYER = 'route-node-labels';
// Always-on hop-flow overlay for the active route (own sources so the static
// route paint never churns per frame).
const ROUTE_FLOW_TRAIL_SOURCE = 'route-flow-trail';
const ROUTE_FLOW_TRAIL_LAYER = 'route-flow-trail';
const ROUTE_FLOW_DOT_SOURCE = 'route-flow-dot';
const ROUTE_FLOW_DOT_HALO_LAYER = 'route-flow-dot-halo';
const ROUTE_FLOW_DOT_LAYER = 'route-flow-dot';
const ROUTE_FLOW_PULSE_SOURCE = 'route-flow-pulse';
const ROUTE_FLOW_PULSE_GLOW_LAYER = 'route-flow-pulse-glow';
const ROUTE_FLOW_PULSE_RING_LAYER = 'route-flow-pulse-ring';
// Pink: distinct from the SNR red/yellow/green scale, unmeasured blue, and
// the orange node markers — legible on both dark and light basemaps.
const ROUTE_FLOW_COLOR = '#e879f9';
const ROUTE_FLOW_HOP_MS = 650;
const ROUTE_FLOW_END_HOLD_MS = 700;
const ROUTE_FLOW_FADE_MS = 800;
const ROUTE_FLOW_RESTART_DELAY_MS = 250;
const ROUTE_FLOW_START_DELAY_MS = 300;

const EMPTY_FC: FeatureCollection = { type: 'FeatureCollection', features: [] };

function paletteVar(name: string, fallback: string): string {
  try {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  } catch {
    return fallback;
  }
}

function RouteCanvas({
  paths,
  endpoints,
  activeIndex,
  styleId,
  onRetry,
  onSelectRoute,
  bottomPadding = 0,
}: {
  paths: PlannedRoute[];
  endpoints: (RouteEndpoint | null)[];
  activeIndex: number;
  styleId: string;
  onRetry: () => void;
  onSelectRoute: (index: number) => void;
  bottomPadding?: number;
}) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [ready, setReady] = useState(false);
  // Click handlers subscribe once (map instance lifetime); the ref carries
  // the latest selection callback so route changes never re-subscribe.
  const onSelectRouteRef = useRef(onSelectRoute);
  useEffect(() => {
    onSelectRouteRef.current = onSelectRoute;
  }, [onSelectRoute]);
  // Latest drawable inputs for the animation loop (single rAF lifetime):
  // active path coords + a paint token (style attempt) to reset on switch.
  const flowInputRef = useRef<{ coords: [number, number][]; key: string }>({ coords: [], key: '' });
  const reducedMotion =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  useEffect(() => {
    if (mapRef.current || !containerRef.current) return;
    // Synchronous construction failure (no WebGL, broken container, …) must
    // surface the existing map error UI instead of throwing into React,
    // which would unmount the whole planner via the AppShell boundary.
    // The IIFE keeps the effect body free of synchronous setState.
    const m: MapLibreMap | null = (() => {
      try {
        return new maplibregl.Map({
          container: containerRef.current as HTMLDivElement,
          style: resolveMapStyle(styleId).url,
          center: DEFAULT_CENTER,
          zoom: DEFAULT_ZOOM,
          attributionControl: false,
        });
      } catch {
        window.setTimeout(() => setStatus('error'), 0);
        return null;
      }
    })();
    if (m == null) return;
    mapRef.current = m;
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    m.addControl(new maplibregl.AttributionControl({ compact: true }));
    const attrib = m.getContainer().querySelector('.maplibregl-ctrl-attrib');
    attrib?.classList.add('maplibregl-compact');
    attrib?.classList.remove('maplibregl-compact-show');
    m.on('click', ROUTE_HIT_LAYER, (e) => {
      const candidates = (e.features ?? []).flatMap((feature) => {
        const routeIndex = feature.properties?.routeIndex;
        if (
          typeof routeIndex !== 'number' ||
          !Number.isInteger(routeIndex) ||
          feature.geometry.type !== 'LineString'
        )
          return [];
        return [
          {
            routeIndex,
            active: feature.properties?.active === true,
            points: feature.geometry.coordinates.map((coordinate) =>
              m.project(coordinate as [number, number]),
            ),
          },
        ];
      });
      const index = closestRoute(e.point, candidates);
      if (index != null) onSelectRouteRef.current(index);
    });
    const onEnter = () => {
      m.getCanvas().style.cursor = 'pointer';
    };
    const onLeave = () => {
      m.getCanvas().style.cursor = '';
    };
    m.on('mouseenter', ROUTE_HIT_LAYER, onEnter);
    m.on('mouseleave', ROUTE_HIT_LAYER, onLeave);
    let failed = false;
    let hasLoaded = false;
    const onError = (e?: { error?: Error; sourceId?: string; tile?: unknown }) => {
      // Transient tile/source failures (one basemap tile timing out, a
      // momentary network blip) are non-fatal: the rest of the map stays
      // usable, so never blank it for those. MapLibre tags tile/source
      // errors with a tile/sourceId; style-level errors have neither.
      // Same rule as the main map (useMapLibre): only a style-level error
      // before anything ever loaded is fatal.
      if (e != null && (e.sourceId != null || e.tile != null)) return;
      if (hasLoaded) return;
      failed = true;
      setStatus('error');
    };
    const onLoad = () => {
      hasLoaded = true;
      setReady(true);
      if (!failed) setStatus('ready');
    };
    m.on('load', onLoad);
    m.on('error', onError);
    const timeout = window.setTimeout(() => {
      if (!m.loaded()) onError();
    }, 15000);
    return () => {
      window.clearTimeout(timeout);
      m.remove();
      mapRef.current = null;
      setReady(false);
    };
  }, [styleId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const palette = traceSnrPalette();
    const { lines, points, bounds } = routesToFeatures(paths, activeIndex, palette, endpoints);

    if (!map.getSource(ROUTE_LINE_SOURCE))
      map.addSource(ROUTE_LINE_SOURCE, { type: 'geojson', data: lines });
    if (!map.getLayer(ROUTE_LINE_LAYER)) {
      map.addLayer({
        id: ROUTE_LINE_LAYER,
        type: 'line',
        source: ROUTE_LINE_SOURCE,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          // active route: per-leg SNR colors; inactive routes: uniform grey
          // (Google-Maps-style selection reads, not a rainbow of options).
          'line-color': ['case', ['get', 'active'], ['get', 'snrColor'], '#6b7280'],
          'line-width': ['case', ['get', 'active'], 2.5, 2],
          // alternatives dimmed so the active route reads as "the" route
          'line-opacity': ['case', ['get', 'active'], 0.95, 0.45],
        },
      } as LineLayerSpecification);
    }
    if (!map.getLayer(ROUTE_HIT_LAYER)) {
      map.addLayer({
        id: ROUTE_HIT_LAYER,
        type: 'line',
        source: ROUTE_LINE_SOURCE,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-width': 28, 'line-opacity': 0 },
      });
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
          // active route nodes orange; inactive route nodes grey to match
          'circle-color': ['case', ['get', 'active'], '#ff6b35', '#6b7280'],
          'circle-opacity': ['case', ['get', 'active'], 1, 0.55],
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
      const w = map.getContainer().clientWidth;
      const isNarrow = w < 1024;
      const panelReserve = isNarrow ? 0 : Math.min(400, Math.max(0, w - 160));
      const h = map.getContainer().clientHeight;
      const top = isNarrow ? Math.min(160, h * 0.3) : 60;
      map.fitBounds(b, {
        padding: {
          top,
          bottom: isNarrow ? Math.min(24 + bottomPadding, Math.max(0, h - top - 80)) : 60,
          left: panelReserve + (isNarrow ? 24 : 60),
          right: isNarrow ? 24 : 60,
        },
        // Fit the route rather than capping at the region overview zoom.
        // Only limit extreme zoom for colocated or very close repeaters.
        maxZoom: paths.length > 0 || bounds.length > 1 ? 16 : 14,
      });
    }
  }, [ready, paths, endpoints, activeIndex, bottomPadding]);

  // Always-on hop-flow overlay for the active route: a dot riding start →
  // end (same language as live mode: transmit = expanding ring, receive =
  // the same visual in reverse) in a dedicated accent color. Single rAF
  // loop for the map lifetime; the loop reads the latest drawable inputs
  // from a ref so route switches never re-subscribe. Reduced-motion users
  // see only the static route paint.
  useEffect(() => {
    const route = paths[activeIndex];
    flowInputRef.current = {
      coords: route ? plannedRouteCoords(route) : [],
      key: `${activeIndex}:${paths.length}`,
    };
  }, [paths, activeIndex]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || reducedMotion) return;

    const ensureLayers = () => {
      if (!map.getSource(ROUTE_FLOW_TRAIL_SOURCE))
        map.addSource(ROUTE_FLOW_TRAIL_SOURCE, { type: 'geojson', data: EMPTY_FC });
      if (!map.getLayer(ROUTE_FLOW_TRAIL_LAYER)) {
        map.addLayer({
          id: ROUTE_FLOW_TRAIL_LAYER,
          type: 'line',
          source: ROUTE_FLOW_TRAIL_SOURCE,
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': ROUTE_FLOW_COLOR,
            'line-width': 2.6,
            'line-dasharray': [2, 2],
            'line-opacity': ['get', 'a'],
          },
        } as LineLayerSpecification);
      }
      if (!map.getSource(ROUTE_FLOW_PULSE_SOURCE))
        map.addSource(ROUTE_FLOW_PULSE_SOURCE, { type: 'geojson', data: EMPTY_FC });
      if (!map.getLayer(ROUTE_FLOW_PULSE_GLOW_LAYER)) {
        map.addLayer({
          id: ROUTE_FLOW_PULSE_GLOW_LAYER,
          type: 'circle',
          source: ROUTE_FLOW_PULSE_SOURCE,
          paint: {
            'circle-radius': ['get', 'gr'],
            'circle-color': ROUTE_FLOW_COLOR,
            'circle-opacity': ['get', 'ga'],
            'circle-blur': 0.78,
          },
        } as CircleLayerSpecification);
      }
      if (!map.getLayer(ROUTE_FLOW_PULSE_RING_LAYER)) {
        map.addLayer({
          id: ROUTE_FLOW_PULSE_RING_LAYER,
          type: 'circle',
          source: ROUTE_FLOW_PULSE_SOURCE,
          paint: {
            'circle-radius': ['get', 'r'],
            'circle-color': 'rgba(0,0,0,0)',
            'circle-opacity': 0,
            'circle-stroke-color': ROUTE_FLOW_COLOR,
            'circle-stroke-width': ['get', 'w'],
            'circle-stroke-opacity': ['get', 'a'],
          },
        } as CircleLayerSpecification);
      }
      if (!map.getSource(ROUTE_FLOW_DOT_SOURCE))
        map.addSource(ROUTE_FLOW_DOT_SOURCE, { type: 'geojson', data: EMPTY_FC });
      if (!map.getLayer(ROUTE_FLOW_DOT_HALO_LAYER)) {
        map.addLayer({
          id: ROUTE_FLOW_DOT_HALO_LAYER,
          type: 'circle',
          source: ROUTE_FLOW_DOT_SOURCE,
          paint: {
            'circle-radius': 7.4,
            'circle-color': 'rgba(0,0,0,0.5)',
            'circle-opacity': ['*', ['get', 'a'], 0.5],
            'circle-blur': 0.5,
          },
        } as CircleLayerSpecification);
      }
      if (!map.getLayer(ROUTE_FLOW_DOT_LAYER)) {
        map.addLayer({
          id: ROUTE_FLOW_DOT_LAYER,
          type: 'circle',
          source: ROUTE_FLOW_DOT_SOURCE,
          paint: {
            'circle-radius': 5,
            'circle-color': ROUTE_FLOW_COLOR,
            'circle-opacity': ['get', 'a'],
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': ['*', ['get', 'a'], 1.1],
          },
        } as CircleLayerSpecification);
      }
    };
    ensureLayers();

    interface FlowPulse {
      coord: [number, number];
      direction: PacketPulseDirection;
      start: number;
    }

    let raf: number | null = null;
    let cycleStart = performance.now() + ROUTE_FLOW_START_DELAY_MS;
    let paintedKey: string | null = null;
    let lastNode = 0;
    let pulses: FlowPulse[] = [];
    let cancelled = false;

    const setSources = (
      lines: Feature<LineString>[],
      dots: Feature<Point>[],
      pulseFeatures: Feature<Point>[],
    ) => {
      try {
        (map.getSource(ROUTE_FLOW_TRAIL_SOURCE) as GeoJSONSource | undefined)?.setData({
          type: 'FeatureCollection',
          features: lines,
        });
        (map.getSource(ROUTE_FLOW_DOT_SOURCE) as GeoJSONSource | undefined)?.setData({
          type: 'FeatureCollection',
          features: dots,
        });
        (map.getSource(ROUTE_FLOW_PULSE_SOURCE) as GeoJSONSource | undefined)?.setData({
          type: 'FeatureCollection',
          features: pulseFeatures,
        });
      } catch {
        // style switching recreates sources mid-frame; next frame re-ensures
      }
    };
    const clearSources = () => setSources([], [], []);

    const frame = () => {
      if (cancelled) return;
      const { coords, key } = flowInputRef.current;
      const now = performance.now();
      const nSeg = coords.length - 1;
      if (nSeg < 1) {
        if (paintedKey !== null) {
          clearSources();
          paintedKey = null;
        }
        raf = requestAnimationFrame(frame);
        return;
      }
      if (key !== paintedKey) {
        // New active route (or first paint): restart the loop from the start
        // node with a fresh outbound pulse. No fitBounds here — the static
        // effect above already frames the route; this loop only animates.
        paintedKey = key;
        cycleStart = now;
        lastNode = 0;
        pulses = [{ coord: coords[0]!, direction: 'outbound', start: now }];
      }
      const rideMs = nSeg * ROUTE_FLOW_HOP_MS;
      const cycleMs =
        rideMs + ROUTE_FLOW_END_HOLD_MS + ROUTE_FLOW_FADE_MS + ROUTE_FLOW_RESTART_DELAY_MS;
      let elapsed = (now - cycleStart) % cycleMs;
      if (elapsed < 0) elapsed = 0;
      const reachedNode = Math.min(nSeg, Math.max(0, Math.floor(elapsed / ROUTE_FLOW_HOP_MS)));
      // Pulse clock follows the ride clock: a delayed frame emits every
      // missed hop event at its packet-clock time instead of replaying late.
      if (reachedNode > lastNode) {
        for (let nodeIndex = lastNode + 1; nodeIndex <= reachedNode; nodeIndex += 1) {
          const arrival = cycleStart + nodeIndex * ROUTE_FLOW_HOP_MS;
          pulses.push({ coord: coords[nodeIndex]!, direction: 'inbound', start: arrival });
          if (nodeIndex < nSeg) {
            pulses.push({
              coord: coords[nodeIndex]!,
              direction: 'outbound',
              start: arrival + PACKET_RELAY_FORWARD_DELAY_MS,
            });
          }
        }
        lastNode = reachedNode;
      }
      while (pulses.length > 240) pulses.shift();

      const headT = Math.min(Math.max(elapsed / ROUTE_FLOW_HOP_MS, 0), nSeg);
      const sinceEnd = elapsed - rideMs;
      const fade =
        sinceEnd <= ROUTE_FLOW_END_HOLD_MS
          ? 1
          : Math.max(0, 1 - (sinceEnd - ROUTE_FLOW_END_HOLD_MS) / ROUTE_FLOW_FADE_MS);
      const dotVisible = elapsed <= rideMs + ROUTE_FLOW_END_HOLD_MS;

      const lineFeatures: Feature<LineString>[] = [];
      const trail = trailCoords(coords, headT);
      if (trail.length >= 2 && fade > 0) {
        lineFeatures.push({
          type: 'Feature',
          properties: { a: 0.66 * fade },
          geometry: { type: 'LineString', coordinates: trail },
        });
      }
      const dotFeatures: Feature<Point>[] = [];
      if (dotVisible) {
        dotFeatures.push({
          type: 'Feature',
          properties: { a: fade },
          geometry: { type: 'Point', coordinates: posAtHop(coords, headT) },
        });
      }
      const pulseFeatures: Feature<Point>[] = [];
      pulses = pulses.filter((p) => {
        const visual = packetPulseFrame(p.direction, now - p.start);
        if (!visual) return now < p.start;
        pulseFeatures.push({
          type: 'Feature',
          properties: {
            r: visual.radius,
            a: visual.opacity * fade,
            w: visual.strokeWidth,
            gr: visual.glowRadius,
            ga: visual.glowOpacity * fade,
          },
          geometry: { type: 'Point', coordinates: p.coord },
        });
        return true;
      });

      setSources(lineFeatures, dotFeatures, pulseFeatures);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelled = true;
      if (raf != null) cancelAnimationFrame(raf);
      try {
        (map.getSource(ROUTE_FLOW_TRAIL_SOURCE) as GeoJSONSource | undefined)?.setData(EMPTY_FC);
        (map.getSource(ROUTE_FLOW_DOT_SOURCE) as GeoJSONSource | undefined)?.setData(EMPTY_FC);
        (map.getSource(ROUTE_FLOW_PULSE_SOURCE) as GeoJSONSource | undefined)?.setData(EMPTY_FC);
      } catch {
        // map already torn down
      }
    };
  }, [ready, reducedMotion]);

  return (
    <div
      className="relative h-full w-full"
      style={{ '--route-sheet-height': `${bottomPadding}px` } as CSSProperties}
    >
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
  endpoints,
  activeIndex,
  styleId,
  onSelectRoute,
  bottomPadding,
}: {
  paths: PlannedRoute[];
  endpoints: (RouteEndpoint | null)[];
  activeIndex: number;
  styleId: string;
  onSelectRoute: (index: number) => void;
  bottomPadding?: number;
}) {
  const [attempt, setAttempt] = useState(0);
  return (
    <RouteCanvas
      key={`${styleId}:${attempt}`}
      paths={paths}
      endpoints={endpoints}
      activeIndex={activeIndex}
      styleId={styleId}
      onRetry={() => setAttempt((n) => n + 1)}
      onSelectRoute={onSelectRoute}
      bottomPadding={bottomPadding}
    />
  );
}
