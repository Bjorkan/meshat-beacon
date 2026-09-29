import { useCallback, useEffect, useRef, useState } from 'react';
import './maplibre-worker';
import * as maplibregl from 'maplibre-gl';
import i18n from '../../i18n';
import { mapOverlayInsets } from './map-insets';
import type {
  Map as MapLibreMap,
  RasterDEMSourceSpecification,
  MapStyleImageMissingEvent,
  ErrorEvent,
  SymbolLayerSpecification,
} from 'maplibre-gl';
import {
  DEM_TILES,
  DEM_ATTRIBUTION,
  TERRAIN_EXAGGERATION,
  DEFAULT_CENTER,
  DEFAULT_ZOOM,
  DEFAULT_PITCH,
  DEFAULT_BEARING,
  MAX_PITCH,
  IATA_ZOOM,
  IATA_PITCH,
  resolveMapStyle,
} from './types';

// serialized fit target, so the fit effect can skip redundant re-fits
const fitKey = (points: [number, number][] | null) =>
  points && points.length ? points.map((p) => `${p[0]},${p[1]}`).join(';') : null;

// Keeps the imperative MapLibre lifecycle out of MapView; exposes mapRef + isReady for overlays.

const TERRAIN_SOURCE_ID = 'terrain-dem';
const HILLSHADE_SOURCE_ID = 'hillshade-dem';
const HILLSHADE_LAYER_ID = 'hillshade';

// Terrain and the hillshade layer pull the same terrarium tiles, but maplibre warns when they share
// a single source (it costs render quality), so we describe the source once and add it twice.
const demSource = (): RasterDEMSourceSpecification => ({
  type: 'raster-dem',
  tiles: DEM_TILES,
  encoding: 'terrarium',
  tileSize: 256, // terrarium tiles are 256px, not the raster-dem default of 512
  maxzoom: 15,
  attribution: DEM_ATTRIBUTION, // same string on both sources; the attribution control de-dupes it
});

// Idempotent (guarded by getSource/getLayer) so it is safe to run on both 'load' and every
// 'style.load' — setStyle() drops imperatively-added sources/layers, so terrain must be re-added.
function addTerrain(map: MapLibreMap, isDark: boolean) {
  if (!map.getSource(TERRAIN_SOURCE_ID)) map.addSource(TERRAIN_SOURCE_ID, demSource());
  if (!map.getSource(HILLSHADE_SOURCE_ID)) map.addSource(HILLSHADE_SOURCE_ID, demSource());
  if (!map.getLayer(HILLSHADE_LAYER_ID)) {
    // insert beneath labels/roads so they stay legible over the relief
    const firstSymbolId = map.getStyle().layers?.find((l) => l.type === 'symbol')?.id;
    map.addLayer(
      {
        id: HILLSHADE_LAYER_ID,
        type: 'hillshade',
        source: HILLSHADE_SOURCE_ID,
        paint: {
          'hillshade-exaggeration': 0.5,
          'hillshade-shadow-color': isDark ? '#000000' : '#1a1a1a',
          'hillshade-highlight-color': isDark ? '#333333' : '#ffffff',
          'hillshade-illumination-direction': 315,
        },
      },
      firstSymbolId,
    );
  }
  map.setTerrain({ source: TERRAIN_SOURCE_ID, exaggeration: TERRAIN_EXAGGERATION });
}

// Camera framing shared by the selection fit effect and the Home control. keepDeepLinkView lets the
// first fit after a deep-link camera keep the URL-supplied view instead of framing the region.
function performFit(
  map: MapLibreMap,
  points: [number, number][] | null,
  keepDeepLinkView: boolean,
) {
  if (!points || points.length === 0) {
    map.flyTo({
      center: DEFAULT_CENTER,
      padding: map.getPadding(),
      zoom: DEFAULT_ZOOM,
      pitch: DEFAULT_PITCH,
      bearing: DEFAULT_BEARING,
    });
    return;
  }
  if (keepDeepLinkView) return;
  const bounds = points.reduce(
    (b, p) => b.extend(p),
    new maplibregl.LngLatBounds(points[0], points[0]),
  );
  map.fitBounds(bounds, {
    // Use the same safe rectangle as node focus and cluster navigation.
    padding: map.getPadding(),
    maxZoom: IATA_ZOOM,
    pitch: points.length === 1 ? IATA_PITCH : DEFAULT_PITCH,
    bearing: DEFAULT_BEARING,
  });
}

// House glyph in MapLibre's control-icon style (29x29, baked #333 like the built-in icons; the
// data-dark CSS in index.css inverts it alongside the zoom/compass glyphs).
const HOME_ICON = encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="29" height="29" fill="#333" viewBox="0 0 29 29"><path fill-rule="evenodd" d="M14.5 4.5 3.5 13.5h3V24h16V13.5h3zM12.5 24v-6a2 2 0 0 1 4 0v6z"/></svg>',
);

// Home button joining the top-right control stack under the zoom/compass group: replays the camera
// the map opens with (the region fit, or the configured default overview). Deliberately ignores the
// deep-link suppression — pressing Home is an explicit request for that start view. The aria/title
// label tracks the app language via the i18n singleton (the control is built outside React).
class HomeControl implements maplibregl.IControl {
  private readonly goHome: (map: MapLibreMap) => void;
  private container: HTMLElement | null = null;
  private applyTitle: () => void = () => {};

  constructor(goHome: (map: MapLibreMap) => void) {
    this.goHome = goHome;
  }

  onAdd(map: MapLibreMap): HTMLElement {
    const container = document.createElement('div');
    container.className = 'maplibregl-ctrl maplibregl-ctrl-group';
    const button = document.createElement('button');
    button.type = 'button';
    const icon = document.createElement('span');
    icon.className = 'maplibregl-ctrl-icon';
    icon.style.backgroundImage = `url("data:image/svg+xml;charset=utf-8,${HOME_ICON}")`;
    button.appendChild(icon);
    this.applyTitle = () => {
      const label = String(i18n.t('map.home'));
      button.setAttribute('aria-label', label);
      button.title = label;
    };
    this.applyTitle();
    i18n.on('languageChanged', this.applyTitle);
    button.addEventListener('click', () => this.goHome(map));
    container.appendChild(button);
    this.container = container;
    return container;
  }

  onRemove() {
    i18n.off('languageChanged', this.applyTitle);
    this.container?.remove();
    this.container = null;
  }
}

// Basemap label language. The OpenFreeMap styles bake their label expressions into every symbol
// layer as "name:latin [+ name:nonlatin], else name_en/name". For Swedish, each of those name
// leaves is rewritten to prefer the OSM Swedish name (tile key "name:sv"; the tiles carry every
// OSM language and Swedish exonyms like Tyskland/Norge exist), falling back to the style's own
// expression when a feature has no Swedish name. Any other language restores the style's own
// expression. Road refs ("to-string", ref) contain no name leaves and stay untouched. Idempotent:
// layers whose serialized field is unchanged are skipped, so redundant calls are free.
function rewriteLabelToSwedish(expr: unknown): unknown {
  return Array.isArray(expr)
    ? expr[0] === 'get' && (expr[1] === 'name:latin' || expr[1] === 'name_en')
      ? ['coalesce', ['get', 'name:sv'], expr]
      : expr.map(rewriteLabelToSwedish)
    : expr;
}

function symbolTextFields(map: MapLibreMap): [string, unknown][] {
  return (map.getStyle().layers ?? []).flatMap((layer) =>
    layer.type === 'symbol'
      ? ([[layer.id, (layer as SymbolLayerSpecification).layout?.['text-field']]] as [
          string,
          unknown,
        ][])
      : [],
  );
}

// captureLabelFields snapshots the freshly loaded style's label expressions (before any mutation)
// so localize can both apply Swedish and restore the originals for other languages. Called from
// onStyleReady, where the style is always pristine. Overlay layers added later (clusters, focused
// neighbors) are absent from the snapshot; localize falls back to their live field, and since
// those carry no name leaves the rewrite leaves them unchanged anyway.
function captureLabelFields(map: MapLibreMap, originals: Map<string, unknown>) {
  originals.clear();
  for (const [id, field] of symbolTextFields(map)) if (field) originals.set(id, field);
}

function localizeMapLabels(map: MapLibreMap, language: string, originals: Map<string, unknown>) {
  for (const [id, current] of symbolTextFields(map)) {
    if (current == null) continue;
    const original = originals.get(id) ?? current;
    const target = language === 'sv' ? rewriteLabelToSwedish(original) : original;
    if (JSON.stringify(target) === JSON.stringify(current)) continue;
    map.setLayoutProperty(
      id,
      'text-field',
      target as NonNullable<SymbolLayerSpecification['layout']>['text-field'],
    );
  }
}

export function useMapLibre(
  styleId: string,
  // lng/lat pairs to fitBounds over; null/empty falls back to the configured default view
  fitPoints: [number, number][] | null,
  onStyleError?: (lastGoodStyleId: string) => void,
  // a deep-link camera ([lng, lat] + zoom + optional tilt/rotation); when set it opens the map here
  // and wins over the initial region fitBounds. Later region changes still auto-fit.
  initialCamera?: { center: [number, number]; zoom: number; pitch?: number; bearing?: number },
  live = false,
  // basemap label language; 'sv' prefers OSM Swedish names, anything else keeps the style default
  mapLanguage = 'sv',
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const styleIdRef = useRef(styleId);
  const lastStyleIdRef = useRef(styleId);
  const lastGoodStyleIdRef = useRef(styleId); // last style that loaded; the revert target on a failed swap
  const hasLoadedRef = useRef(false); // a style has loaded at least once (distinguishes initial-load failure)
  const swapPendingRef = useRef(false); // a setStyle() basemap swap is in flight (awaiting style.load)
  const onStyleErrorRef = useRef(onStyleError);
  const lastFitKeyRef = useRef<string | null>(null); // last applied fit target; skips redundant re-fits
  const labelFieldsRef = useRef(new Map<string, unknown>()); // pristine text-fields of the loaded style
  const fitPointsRef = useRef(fitPoints); // current fit target, read by the Home control at click time
  const skipInitialFitRef = useRef(!!initialCamera); // let a deep-link camera win over the first fit
  const initialCameraRef = useRef(initialCamera); // read once at map creation (deep link is load-time only)
  const [isReady, setIsReady] = useState(false);
  const [styleRevision, setStyleRevision] = useState(0);
  const [loadedStyleId, setLoadedStyleId] = useState<string | null>(null);
  const [error, setError] = useState<Error | null>(null);

  // Home: replay the camera the map opens with — the region fit, or the configured default overview.
  // Ignores the deep-link suppression: pressing Home is an explicit request for that start view.
  const goHome = useCallback((map: MapLibreMap) => {
    performFit(map, fitPointsRef.current, false);
  }, []);

  // keep styleId / callback readable inside the async map handlers without writing a ref during render
  useEffect(() => {
    styleIdRef.current = styleId;
  }, [styleId]);
  useEffect(() => {
    onStyleErrorRef.current = onStyleError;
  }, [onStyleError]);
  useEffect(() => {
    fitPointsRef.current = fitPoints;
  }, [fitPoints]);

  // Init once. StrictMode-safe: the guard prevents a duplicate map, and cleanup fully tears the
  // map down (map.remove() disposes the GL context + all map.on listeners) and nulls the ref so a
  // remount (StrictMode in dev, or returning to the Map tab) rebuilds cleanly.
  useEffect(() => {
    if (mapRef.current) return;
    const container = containerRef.current;
    if (!container) return;

    // open at the deep-link camera if one was given, else the default view; the fit effect frames the
    // selection once the style is ready (unless a deep-link camera suppresses that first fit)
    const map = new maplibregl.Map({
      container,
      style: resolveMapStyle(styleIdRef.current).url,
      center: initialCameraRef.current?.center ?? DEFAULT_CENTER,
      zoom: initialCameraRef.current?.zoom ?? DEFAULT_ZOOM,
      pitch: initialCameraRef.current?.pitch ?? DEFAULT_PITCH,
      bearing: initialCameraRef.current?.bearing ?? DEFAULT_BEARING,
      maxPitch: MAX_PITCH,
      attributionControl: false, // replaced below with a compact (always-collapsed) control
    });
    mapRef.current = map;
    lastStyleIdRef.current = styleIdRef.current;

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
    map.addControl(new HomeControl(goHome), 'top-right'); // under the zoom/compass group
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');
    map.addControl(new maplibregl.AttributionControl({ compact: true })); // bottom-right
    // maplibre pops the compact attribution open the first time the basemap credit loads (it tacks
    // on .maplibregl-compact-show). Mark it .maplibregl-compact up front so it skips that and stays
    // a bare (i) on load — clicking it still opens the credit.
    const attrib = map.getContainer().querySelector('.maplibregl-ctrl-attrib');
    attrib?.classList.add('maplibregl-compact');
    attrib?.classList.remove('maplibregl-compact-show');

    const onStyleReady = () => {
      addTerrain(map, resolveMapStyle(styleIdRef.current).dark);
      // snapshot the pristine label expressions before anything mutates them (see localizeMapLabels)
      captureLabelFields(map, labelFieldsRef.current);
      hasLoadedRef.current = true;
      swapPendingRef.current = false;
      lastGoodStyleIdRef.current = styleIdRef.current;
      setLoadedStyleId(styleIdRef.current);
      setIsReady(true);
      // A boolean false -> true cycle can be batched by React when setStyle resolves quickly. A
      // monotonic revision guarantees every imperative overlay hook reruns after the new style has
      // actually loaded, preventing a dark/light switch from leaving the map without node layers.
      setStyleRevision((revision) => revision + 1);
      setError(null); // a successful (re)load clears any earlier transient/initial error
    };
    map.on('load', onStyleReady); // first paint (style.load does not reliably fire on initial load)
    map.on('style.load', onStyleReady); // re-add terrain after every setStyle

    // The OpenFreeMap base styles ask for a handful of sprite icons their sprite doesn't ship (e.g.
    // "circle-11"), so maplibre warns on every load. Hand it a transparent 1x1 for anything that
    // isn't ours and the noise goes away — a missing icon already draws nothing, so the map looks
    // identical. Our own markers all start with "node-" and are rasterized by useMapNodes, so we
    // leave those alone. This lives here (not in useMapNodes) so it's listening before the base
    // style's first paint, when those icons are first requested.
    map.on('styleimagemissing', (e: MapStyleImageMissingEvent) => {
      if (!e.id.startsWith('node-') && !map.hasImage(e.id)) map.addImage(e.id, new ImageData(1, 1));
    });

    map.on('error', (e: ErrorEvent) => {
      // v6's ErrorEvent only types `error`, but tile errors still carry the tile (and some
      // source errors a sourceId) on the event object at runtime — read them defensively.
      const { sourceId, tile } = e as ErrorEvent & { sourceId?: string; tile?: unknown };
      // A single tile/source failure (one basemap or DEM tile timing out / 403 / a momentary network
      // blip) is transient and non-fatal — the rest of the map stays usable — so never blank the map
      // for it. maplibre tags tile/source errors with a tile/sourceId; style-level errors have neither.
      if (sourceId != null || tile != null) return;
      // The new basemap failed mid-swap. setStyle keeps the old style (and our node layers)
      // rendered, so roll back to the last good style and tell MapView to revert the picker rather
      // than blanking the map under a fatal overlay.
      if (swapPendingRef.current) {
        swapPendingRef.current = false;
        lastStyleIdRef.current = lastGoodStyleIdRef.current;
        setIsReady(true);
        onStyleErrorRef.current?.(lastGoodStyleIdRef.current);
        return;
      }
      // Initial map/style load failed (no basemap ever shown): surface the overlay. It self-heals if a
      // later load succeeds (onStyleReady clears it). Other post-load style errors are left non-fatal.
      if (!hasLoadedRef.current)
        setError(
          e.error instanceof Error ? e.error : new Error(e.error?.message ?? 'Map failed to load'),
        );
    });

    return () => {
      map.remove();
      mapRef.current = null;
      setIsReady(false);
    };
    // styleId / fitPoints / goHome are read via refs + the stable goHome callback so the map is
    // built once; style swaps go through the effect below.
  }, [goHome]);

  // Swap the basemap only when the style really changes. Skip the initial render (the map's already
  // built with the right style) and redundant swaps, which would cause a wasteful re-fetch and an
  // extra style.load while the first style is still loading. style.load then re-adds terrain.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || styleId === lastStyleIdRef.current) return;
    lastStyleIdRef.current = styleId;
    swapPendingRef.current = true; // cleared by style.load on success, or by the error handler on failure
    setIsReady(false);
    map.setStyle(resolveMapStyle(styleId).url);
  }, [styleId]);

  // Persistent padding also governs cluster zoom and node focus. Recalculate on container
  // resize (including panel changes), not just a window breakpoint crossing.
  useEffect(() => {
    const map = mapRef.current;
    const container = containerRef.current;
    if (!map || !container) return;
    const update = () => {
      map.resize();
      map.setPadding(mapOverlayInsets(container.clientWidth, container.clientHeight, live));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(container);
    return () => observer.disconnect();
  }, [live]);

  // Frame the selection: fitBounds over its IATA points, or the default overview when there's none.
  // A single point gets the IATA_ZOOM terrain tilt; multiple get a flat overview. Waits for the
  // style, and the key check skips redundant re-fits (incl. isReady toggling on basemap swaps).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isReady) return;
    const key = fitKey(fitPoints);
    if (key === lastFitKeyRef.current) return;
    lastFitKeyRef.current = key;

    // First real fit after a deep-link camera: keep the URL-supplied view instead of framing the
    // region. Consumed once, so later region changes fit normally.
    const keepDeepLinkView = skipInitialFitRef.current;
    skipInitialFitRef.current = false;
    performFit(map, fitPoints, keepDeepLinkView);
  }, [fitPoints, isReady]);

  // Basemap label language: re-apply after every style (re)load and whenever the app language
  // changes (a language switch performs no setStyle, so onStyleReady never fires for it; sv applies
  // the Swedish rewrite, other languages restore the pristine fields). The stringify guard in
  // localizeMapLabels makes the overlapping runs no-ops when both flip together.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isReady || loadedStyleId !== styleId) return;
    localizeMapLabels(map, mapLanguage, labelFieldsRef.current);
  }, [mapLanguage, isReady, loadedStyleId, styleId]);

  // The style prop changes one render before the async style.load event. Comparing the confirmed
  // loaded id keeps overlay hooks out of that gap even if React batches isReady false -> true.
  return {
    containerRef,
    mapRef,
    isReady: isReady && loadedStyleId === styleId,
    styleRevision,
    error,
  };
}
