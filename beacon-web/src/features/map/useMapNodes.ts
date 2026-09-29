import { useEffect, useRef, useState } from 'react';
import type {
  Map as MapLibreMap,
  GeoJSONSource,
  ExpressionSpecification,
  SymbolLayerSpecification,
  CircleLayerSpecification,
  MapMouseEvent,
} from 'maplibre-gl';
import Spiderfy from '@nazka/map-gl-js-spiderfy';
import type { FeatureCollection, Point } from 'geojson';
import { NODE_TYPE_COLORS } from '../node-type-colors';
import { nodeMarkerExpression, rasterizeMapMarker, MARKER_FACE } from './marker-images';
import type { NodeFeatureProps } from './node-geojson';
import {
  NODES_SOURCE_ID,
  NODES_CLUSTER_LAYER_ID,
  NODES_CLUSTER_FALLBACK_LAYER_ID,
  NODES_CLUSTER_HALO_LAYER_ID,
  NODES_DOT_LAYER_ID,
  NODES_POINT_LAYER_ID,
  NODES_SELECTED_LAYER_ID,
  CLUSTER_RADIUS,
  CLUSTER_MIN_POINTS,
  CLUSTER_MAX_ZOOM,
  NODES_SOURCE_MAXZOOM,
  NODES_GLOW_LAYER_ID,
  FOCUSED_NEIGHBORS_LAYER_ID,
  PACKET_FLOW_COLOR,
} from './types';
import {
  CLUSTER_ZOOM_DURATION_MS,
  clusterClickDecision,
  fallbackClusterZoom,
} from './cluster-navigation';
import { prepareSpiderfyForDirectUse } from './spiderfy-adapter';
import {
  clusterRadiusExpression,
  glowRadiusExpression,
  nodeDotOpacityExpression,
  nodeDotRadiusExpression,
  nodeIconOpacityExpression,
  nodeIconSizeExpression,
  selectionRadiusExpression,
  selectionStrokeExpression,
  LIVE_NODE_STROKE_WIDTH_PX,
  NODE_INTERACTION_RADIUS_PX,
  shouldClusterNodes,
} from './marker-scale';
import { clusterRoleProperties, CLUSTER_ICON_IMAGE } from './cluster-style';
import { applyNodeClusterMode } from './node-clustering';
import { syncMapOverlayLayerOrder } from './map-layer-order';

type NodeFC = FeatureCollection<Point, NodeFeatureProps>;

function cssVar(name: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

// Text and contour share one image, including when Spiderfy offsets a leaf.
function syncNodeSelection(map: MapLibreMap, selectedId: string | null): void {
  for (const layer of map.getStyle().layers ?? []) {
    if (layer.id === NODES_POINT_LAYER_ID || layer.id.includes('-spiderfy-leaf')) {
      map.setLayoutProperty(layer.id, 'icon-image', nodeMarkerExpression(selectedId));
    }
  }
}

// Render compact node IDs and proportional cluster rings, with Spiderfy for co-located nodes.
// Like useMapLibre, the imperative work re-adds itself after every style switch.
export function useMapNodes(
  mapRef: React.RefObject<MapLibreMap | null>,
  isReady: boolean,
  geojson: NodeFC,
  isDark: boolean,
  themeKey: string,
  clustered: boolean,
  liveMode: boolean,
  onSelectNode: (id: string | null) => void,
  selectedNodeId: string | null,
  // identity of the dataset (region + type filter); an open spiderfy fan closes when it changes,
  // since its leaves were drawn from the previous dataset
  resetKey = '',
) {
  const geojsonRef = useRef(geojson);
  const spiderRef = useRef<Spiderfy | null>(null);
  const onSelectNodeRef = useRef(onSelectNode);
  const selectedNodeIdRef = useRef(selectedNodeId);
  const clusterActionRef = useRef(0);
  const effectiveClustered = shouldClusterNodes(clustered, liveMode);
  const appliedClusteredRef = useRef<boolean | null>(null);
  const appliedClusterSourceRef = useRef<GeoJSONSource | null>(null);

  // handlers below capture map at attach time; read live state through these refs
  useEffect(() => {
    geojsonRef.current = geojson;
    onSelectNodeRef.current = onSelectNode;
    selectedNodeIdRef.current = selectedNodeId;
  }, [geojson, onSelectNode, selectedNodeId]);

  // Track device-pixel-ratio so icons re-rasterize at full resolution across a DPR change (e.g.
  // dragging the window to another monitor). A matchMedia(dppx) query fires once then goes stale,
  // so re-arm it on every change.
  const [dpr, setDpr] = useState(() =>
    typeof window === 'undefined' ? 1 : window.devicePixelRatio,
  );
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    let mql = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    const onChange = () => {
      setDpr(window.devicePixelRatio);
      mql.removeEventListener('change', onChange);
      mql = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      mql.addEventListener('change', onChange);
    };
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  // Build the source + layers and keep their paint in step with the basemap and theme. Idempotent,
  // so it re-runs safely on first ready, after each style switch, and on theme changes. Marker
  // images are handled by the icons effect below.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isReady) return;

    // MapLibre 5.x supports changing cluster options in place. Do not infer the source mode from
    // React state: the map/source can outlive this hook across remounts, which previously allowed a
    // stale cluster:false source from Live to survive while the UI showed "Clustering: On".
    let nodesSource = map.getSource(NODES_SOURCE_ID) as GeoJSONSource | undefined;
    if (!nodesSource) {
      map.addSource(NODES_SOURCE_ID, {
        type: 'geojson',
        data: geojsonRef.current,
        maxzoom: NODES_SOURCE_MAXZOOM,
        cluster: effectiveClustered,
        clusterRadius: CLUSTER_RADIUS,
        clusterMaxZoom: CLUSTER_MAX_ZOOM,
        clusterMinPoints: CLUSTER_MIN_POINTS,
        clusterProperties: clusterRoleProperties(),
        // promote the node id so live packet-flow can flash individual nodes via feature-state
        promoteId: 'id',
      });
      nodesSource = map.getSource(NODES_SOURCE_ID) as GeoJSONSource;
      appliedClusteredRef.current = effectiveClustered;
      appliedClusterSourceRef.current = nodesSource;
    } else if (
      appliedClusterSourceRef.current !== nodesSource ||
      appliedClusteredRef.current !== effectiveClustered
    ) {
      applyNodeClusterMode(nodesSource, effectiveClustered);
      appliedClusterSourceRef.current = nodesSource;
      appliedClusteredRef.current = effectiveClustered;
    }

    // The hit target remains native. A synchronous canvas image above it carries the exact
    // category proportions and total, independent of remote glyphs or HTML overlays.
    const clusterFill = MARKER_FACE;
    if (!map.getLayer(NODES_CLUSTER_HALO_LAYER_ID)) {
      map.addLayer({
        id: NODES_CLUSTER_HALO_LAYER_ID,
        type: 'circle',
        source: NODES_SOURCE_ID,
        filter: ['has', 'point_count'],
        paint: {
          'circle-radius': [
            '+',
            clusterRadiusExpression(),
            3,
          ] as unknown as ExpressionSpecification,
          'circle-color': 'rgba(0,0,0,0.58)',
          'circle-opacity': 0.72,
          'circle-blur': 0.55,
          'circle-pitch-alignment': 'viewport',
          'circle-pitch-scale': 'viewport',
        },
      } as CircleLayerSpecification);
    }
    if (!map.getLayer(NODES_CLUSTER_FALLBACK_LAYER_ID)) {
      map.addLayer({
        id: NODES_CLUSTER_FALLBACK_LAYER_ID,
        type: 'circle',
        source: NODES_SOURCE_ID,
        filter: ['has', 'point_count'],
        paint: {
          'circle-radius': clusterRadiusExpression(),
          'circle-color': clusterFill,
          'circle-pitch-alignment': 'viewport',
          'circle-pitch-scale': 'viewport',
          'circle-opacity': 1,
        },
      } as CircleLayerSpecification);
    }
    map.setPaintProperty(NODES_CLUSTER_FALLBACK_LAYER_ID, 'circle-color', clusterFill);

    if (!map.getLayer(NODES_CLUSTER_LAYER_ID)) {
      map.addLayer({
        id: NODES_CLUSTER_LAYER_ID,
        type: 'symbol',
        source: NODES_SOURCE_ID,
        filter: ['has', 'point_count'],
        layout: {
          'icon-image': CLUSTER_ICON_IMAGE,
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
          'icon-pitch-alignment': 'viewport',
          'icon-rotation-alignment': 'viewport',
        },
      } as SymbolLayerSpecification);
    }
    // Cluster layers are meaningful only while the source is clustered. Hiding them immediately on
    // Live/Off transitions prevents stale worker tiles from flashing an old cluster during the
    // asynchronous setClusterOptions update; enabling them makes the normal-map contract explicit.
    const clusterVisibility = effectiveClustered ? 'visible' : 'none';
    for (const layerId of [
      NODES_CLUSTER_HALO_LAYER_ID,
      NODES_CLUSTER_FALLBACK_LAYER_ID,
      NODES_CLUSTER_LAYER_ID,
    ]) {
      if (map.getLayer(layerId)) map.setLayoutProperty(layerId, 'visibility', clusterVisibility);
    }

    // Compact category-coloured dots present ungrouped nodes at overview zooms (and Live mode);
    // the capsule layer takes over past z8.
    const dotColor: ExpressionSpecification = [
      'match',
      ['get', 'nodeTypeName'],
      'companion',
      NODE_TYPE_COLORS.companion,
      'repeater',
      NODE_TYPE_COLORS.repeater,
      'room_server',
      NODE_TYPE_COLORS.room_server,
      'sensor',
      NODE_TYPE_COLORS.sensor,
      NODE_TYPE_COLORS.unknown,
    ] as unknown as ExpressionSpecification;
    if (!map.getLayer(NODES_DOT_LAYER_ID)) {
      map.addLayer({
        id: NODES_DOT_LAYER_ID,
        type: 'circle',
        source: NODES_SOURCE_ID,
        filter: ['!', ['has', 'point_count']],
        paint: {
          'circle-radius': nodeDotRadiusExpression(liveMode),
          'circle-color': dotColor,
          'circle-opacity': nodeDotOpacityExpression(liveMode),
          'circle-stroke-color': MARKER_FACE,
          'circle-stroke-width': liveMode ? LIVE_NODE_STROKE_WIDTH_PX : 0.9,
        },
      } as CircleLayerSpecification);
    }

    // Zoom-gated: tiles below z8 never place this layer, so overview views never request the
    // hundreds of unique capsule images — the compact dot layer covers them instead.
    if (!map.getLayer(NODES_POINT_LAYER_ID)) {
      map.addLayer({
        id: NODES_POINT_LAYER_ID,
        type: 'symbol',
        source: NODES_SOURCE_ID,
        filter: ['!', ['has', 'point_count']],
        minzoom: 8,
        layout: {
          'icon-image': nodeMarkerExpression(selectedNodeIdRef.current),
          'icon-size': nodeIconSizeExpression(),
          'icon-allow-overlap': true,
          'icon-pitch-alignment': 'viewport',
          'icon-rotation-alignment': 'viewport',
        },
        paint: {
          'icon-opacity': nodeIconOpacityExpression(liveMode),
        },
      } as SymbolLayerSpecification);
    }

    // Live packet-flow pulse: a soft halo behind each node that blooms with the glow feature-state
    // (fed by useMapPacketFlow's rAF loop as a dot crosses the node) and eases back out after. This
    // is the only node-level live animation — nodes themselves are never dimmed.
    const flowColor = cssVar('--palette-warn', PACKET_FLOW_COLOR);
    if (!map.getLayer(NODES_GLOW_LAYER_ID)) {
      map.addLayer(
        {
          id: NODES_GLOW_LAYER_ID,
          type: 'circle',
          source: NODES_SOURCE_ID,
          filter: ['!', ['has', 'point_count']],
          paint: {
            'circle-radius': glowRadiusExpression(),
            'circle-color': flowColor,
            'circle-opacity': ['*', ['coalesce', ['feature-state', 'glow'], 0], 0.4],
            'circle-blur': 1,
          },
        } as CircleLayerSpecification,
        NODES_CLUSTER_FALLBACK_LAYER_ID, // beneath the cluster + point layers
      );
    }
    map.setPaintProperty(NODES_GLOW_LAYER_ID, 'circle-color', flowColor);

    // Ring under the selected node's icon. Only matches an unclustered point (clusters carry no id);
    // color tracks --palette-primary.
    const primary = cssVar('--palette-primary', '#3B82F6');
    if (!map.getLayer(NODES_SELECTED_LAYER_ID)) {
      map.addLayer(
        {
          id: NODES_SELECTED_LAYER_ID,
          type: 'circle',
          source: NODES_SOURCE_ID,
          filter: ['==', ['get', 'id'], selectedNodeIdRef.current ?? ''],
          paint: {
            'circle-radius': selectionRadiusExpression(liveMode),
            // A small opaque knockout prevents focused-neighbor lines from visually cutting through
            // the selected repeater while the symbol icon remains on top.
            'circle-color': isDark ? 'rgba(9,9,11,0.9)' : 'rgba(255,255,255,0.92)',
            'circle-stroke-width': selectionStrokeExpression(),
            'circle-stroke-color': primary,
            'circle-stroke-opacity': 0.95,
          },
        },
        NODES_CLUSTER_FALLBACK_LAYER_ID, // insert beneath the cluster + point symbol layers
      );
    }
    map.setPaintProperty(NODES_SELECTED_LAYER_ID, 'circle-stroke-color', primary);
    map.setPaintProperty(
      NODES_SELECTED_LAYER_ID,
      'circle-color',
      isDark ? 'rgba(9,9,11,0.9)' : 'rgba(255,255,255,0.92)',
    );

    syncNodeSelection(map, selectedNodeIdRef.current);
    // At close zoom the selected capsule has its own outline; only dots need a circular halo.
    map.setPaintProperty(
      NODES_SELECTED_LAYER_ID,
      'circle-opacity',
      nodeDotOpacityExpression(liveMode),
    );
    map.setPaintProperty(
      NODES_SELECTED_LAYER_ID,
      'circle-stroke-opacity',
      nodeDotOpacityExpression(liveMode),
    );
    map.setPaintProperty(NODES_DOT_LAYER_ID, 'circle-color', dotColor);
    map.setPaintProperty(NODES_DOT_LAYER_ID, 'circle-radius', nodeDotRadiusExpression(liveMode));
    map.setPaintProperty(NODES_DOT_LAYER_ID, 'circle-opacity', nodeDotOpacityExpression(liveMode));
    map.setPaintProperty(NODES_DOT_LAYER_ID, 'circle-stroke-color', MARKER_FACE);
    map.setPaintProperty(
      NODES_DOT_LAYER_ID,
      'circle-stroke-width',
      liveMode ? LIVE_NODE_STROKE_WIDTH_PX : 0.9,
    );
    map.setPaintProperty(NODES_POINT_LAYER_ID, 'icon-opacity', nodeIconOpacityExpression(liveMode));
    map.setPaintProperty(
      NODES_SELECTED_LAYER_ID,
      'circle-radius',
      selectionRadiusExpression(liveMode),
    );

    // seed the (possibly just-recreated) source; live updates flow through the geojson effect below
    (map.getSource(NODES_SOURCE_ID) as GeoJSONSource).setData(geojsonRef.current);
    syncMapOverlayLayerOrder(map);
  }, [mapRef, isReady, isDark, effectiveClustered, liveMode, themeKey]);

  // Register images synchronously when tile layout requests them. Distributions are part of
  // each key, so clusters with the same total but different contents never share the wrong ring.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isReady) return;
    const pixelRatio = Math.min(4, Math.max(2, Math.ceil(dpr || 1)));
    const provided = new Set<string>();
    const provide = ({ id }: { id: string }) => {
      if (map.hasImage(id)) return;
      const data = rasterizeMapMarker(id, pixelRatio);
      if (!data) return;
      map.addImage(id, data, { pixelRatio });
      provided.add(id);
    };
    // map.remove() fires 'remove' from the map-owning effect before this cleanup runs, so the
    // flag keeps cleanup off the destroyed instance without re-reading the ref.
    let destroyed = false;
    const onDestroy = () => {
      destroyed = true;
    };
    map.on('remove', onDestroy);
    map.on('styleimagemissing', provide);
    // Re-layout existing tiles after a style/DPR change, including already-known image names.
    const source = map.getSource(NODES_SOURCE_ID) as GeoJSONSource | undefined;
    source?.setData(geojsonRef.current);
    return () => {
      map.off('styleimagemissing', provide);
      map.off('remove', onDestroy);
      if (!destroyed) {
        for (const id of provided) if (map.hasImage(id)) map.removeImage(id);
      }
    };
  }, [mapRef, isReady, themeKey, dpr, resetKey]);

  // Reflect the shared selection as a ring (mirrors the table's row highlight). Its own effect so
  // changing the selection doesn't rebuild the source/layers.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isReady || !map.getLayer(NODES_SELECTED_LAYER_ID)) return;
    map.setFilter(NODES_SELECTED_LAYER_ID, ['==', ['get', 'id'], selectedNodeId ?? '']);
    syncNodeSelection(map, selectedNodeId);
  }, [mapRef, isReady, selectedNodeId]);

  // Restore the active presentation after a style/theme/source rebuild. Live intentionally
  // keeps every node as a compact dot so packet trails remain the strongest visual signal.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isReady) return;
    if (map.getLayer(NODES_POINT_LAYER_ID)) {
      map.setPaintProperty(
        NODES_POINT_LAYER_ID,
        'icon-opacity',
        nodeIconOpacityExpression(liveMode),
      );
    }
    if (map.getLayer(NODES_DOT_LAYER_ID)) {
      map.setPaintProperty(NODES_DOT_LAYER_ID, 'circle-radius', nodeDotRadiusExpression(liveMode));
      map.setPaintProperty(
        NODES_DOT_LAYER_ID,
        'circle-opacity',
        nodeDotOpacityExpression(liveMode),
      );
    }
    if (map.getLayer(NODES_SELECTED_LAYER_ID)) {
      map.setPaintProperty(
        NODES_SELECTED_LAYER_ID,
        'circle-radius',
        selectionRadiusExpression(liveMode),
      );
    }
  }, [mapRef, isReady, effectiveClustered, liveMode, themeKey]);

  // Push new node data into the source as it arrives; the source re-clusters automatically. A data
  // replacement can also change cluster ids, so cancel an expansion request captured from the old set.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isReady) return;
    const src = map.getSource(NODES_SOURCE_ID) as GeoJSONSource | undefined;
    if (src) {
      clusterActionRef.current += 1;
      src.setData(geojson);
    }
  }, [mapRef, isReady, geojson]);

  // Build node/cluster interactions and a terminal spiderfy fallback. Cluster clicks are owned by
  // Beacon rather than the library: zoom to MapLibre's expansion level first, and only fan out when
  // there is no deeper useful zoom. This keeps the interaction predictable on dense network maps.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isReady) return;

    const spider = new Spiderfy(map, {
      closeOnLeafClick: false,
      onLeafClick: (f) => {
        const id = f.properties?.['id'];
        if (typeof id === 'string') onSelectNodeRef.current(id);
      },
      spiderLegsColor: cssVar('--palette-text-dim', '#5F5F65'),
      spiderLegsWidth: 2,
      circleOptions: { leavesSeparation: 110 },
      spiralOptions: { leavesSeparation: 110, legLengthStart: 45 },
      spiderLeavesLayout: {
        'icon-image': nodeMarkerExpression(selectedNodeIdRef.current),
        'icon-size': nodeIconSizeExpression(),
        'icon-allow-overlap': true,
        'icon-pitch-alignment': 'viewport',
        'icon-rotation-alignment': 'viewport',
      },
    });
    prepareSpiderfyForDirectUse(
      spider as unknown as {
        clickedParentClusterStyle: { type: 'symbol'; layout: object; paint: object } | null;
      },
    );
    spiderRef.current = spider;

    const cancelPendingClusterAction = () => {
      clusterActionRef.current += 1;
    };

    const clearSpider = () => {
      try {
        spider.unspiderfyAll();
      } catch {
        /* map may already be changing style / removed */
      }
      syncNodeSelection(map, selectedNodeIdRef.current);
    };

    const onMapClick = (e: MapMouseEvent) => {
      const rendered = map.queryRenderedFeatures(e.point);
      const focusedNeighbor = rendered.find(
        (feature) => feature.layer.id === FOCUSED_NEIGHBORS_LAYER_ID,
      );
      const focusedId = focusedNeighbor?.properties?.['id'];
      if (typeof focusedId === 'string') {
        onSelectNodeRef.current(focusedId);
        return;
      }
      const leaf = rendered.find((feature) =>
        feature.layer.id.includes(`${NODES_CLUSTER_LAYER_ID}-spiderfy-leaf`),
      );
      if (leaf) {
        const id = leaf.properties?.['id'];
        if (typeof id === 'string') onSelectNodeRef.current(id);
        return;
      }

      const cluster = map.queryRenderedFeatures(e.point, {
        layers: [NODES_CLUSTER_LAYER_ID, NODES_CLUSTER_FALLBACK_LAYER_ID],
      })[0];
      const clusterFeature = cluster;
      if (clusterFeature?.geometry.type === 'Point') {
        const clusterId = Number(clusterFeature.properties?.['cluster_id']);
        const center = clusterFeature.geometry.coordinates as [number, number];
        const source = map.getSource(NODES_SOURCE_ID) as GeoJSONSource | undefined;
        if (source && Number.isFinite(clusterId)) {
          const actionId = ++clusterActionRef.current;
          clearSpider();
          const isCurrentAction = () =>
            clusterActionRef.current === actionId &&
            mapRef.current === map &&
            map.getSource(NODES_SOURCE_ID) === source;

          void source
            .getClusterExpansionZoom(clusterId)
            .then((expansionZoom) => {
              if (!isCurrentAction()) return;
              const maxExpansionZoom = Math.min(CLUSTER_MAX_ZOOM, map.getMaxZoom());
              const decision = clusterClickDecision(map.getZoom(), expansionZoom, maxExpansionZoom);
              if (decision.type === 'zoom') {
                clearSpider();
                map.easeTo({
                  center,
                  padding: map.getPadding(),
                  zoom: decision.zoom,
                  duration: CLUSTER_ZOOM_DURATION_MS,
                });
              } else {
                spider.spiderfy(NODES_CLUSTER_LAYER_ID, clusterId);
                requestAnimationFrame(() => {
                  if (isCurrentAction()) syncNodeSelection(map, selectedNodeIdRef.current);
                });
              }
            })
            .catch(() => {
              // A transient source/style race should not make the cluster dead. Move closer if possible;
              // at the ceiling, fall back to spiderfy. Ignore a rejection from an obsolete source/action.
              if (!isCurrentAction()) return;
              const maxExpansionZoom = Math.min(CLUSTER_MAX_ZOOM, map.getMaxZoom());
              const fallbackZoom = fallbackClusterZoom(map.getZoom(), maxExpansionZoom);
              if (fallbackZoom != null) {
                clearSpider();
                map.easeTo({
                  center,
                  padding: map.getPadding(),
                  zoom: fallbackZoom,
                  duration: CLUSTER_ZOOM_DURATION_MS,
                });
              } else {
                spider.spiderfy(NODES_CLUSTER_LAYER_ID, clusterId);
              }
            });
        }
        return;
      }

      // Low-zoom dots are intentionally tiny, but click accuracy should not shrink with the ink.
      cancelPendingClusterAction();
      const r = NODE_INTERACTION_RADIUS_PX;
      const features = map.queryRenderedFeatures(
        [
          [e.point.x - r, e.point.y - r],
          [e.point.x + r, e.point.y + r],
        ],
        { layers: [NODES_POINT_LAYER_ID, NODES_DOT_LAYER_ID] },
      );
      const id = features.find((feature) => typeof feature.properties?.['id'] === 'string')
        ?.properties?.['id'];
      if (typeof id === 'string') onSelectNodeRef.current(id);
      else {
        clearSpider();
        if (selectedNodeIdRef.current) onSelectNodeRef.current(null);
      }
    };

    const setPointer = () => {
      map.getCanvas().style.cursor = 'pointer';
    };
    const clearPointer = () => {
      map.getCanvas().style.cursor = '';
    };
    map.on('click', onMapClick);
    for (const layer of [
      NODES_POINT_LAYER_ID,
      NODES_DOT_LAYER_ID,
      NODES_CLUSTER_LAYER_ID,
      NODES_CLUSTER_FALLBACK_LAYER_ID,
    ]) {
      map.on('mouseenter', layer, setPointer);
      map.on('mouseleave', layer, clearPointer);
    }

    // A spider fan is a terminal same-location inspection aid; camera motion closes it rather than
    // trying to preserve pixel offsets through arbitrary pan/zoom/terrain changes.
    const onMoveStart = () => {
      cancelPendingClusterAction();
      clearSpider();
    };
    map.on('movestart', onMoveStart);

    return () => {
      map.off('click', onMapClick);
      cancelPendingClusterAction();
      map.off('movestart', onMoveStart);
      for (const layer of [
        NODES_POINT_LAYER_ID,
        NODES_DOT_LAYER_ID,
        NODES_CLUSTER_LAYER_ID,
        NODES_CLUSTER_FALLBACK_LAYER_ID,
      ]) {
        map.off('mouseenter', layer, setPointer);
        map.off('mouseleave', layer, clearPointer);
      }
      spiderRef.current = null;
      try {
        spider.unspiderfyAll();
      } catch {
        /* map may already be removed */
      }
    };
  }, [mapRef, isReady, effectiveClustered, themeKey]);

  // close any open fan when the dataset identity changes — its leaves no longer exist
  useEffect(() => {
    clusterActionRef.current += 1;
    try {
      spiderRef.current?.unspiderfyAll();
    } catch {
      /* map may already be removed */
    }
  }, [resetKey]);
}
