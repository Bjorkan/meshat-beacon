import { useEffect, useRef, useState } from "react";
import type {
  Map as MapLibreMap,
  GeoJSONSource,
  ExpressionSpecification,
  SymbolLayerSpecification,
  CircleLayerSpecification,
  MapMouseEvent,
} from "maplibre-gl";
import Spiderfy from "@nazka/map-gl-js-spiderfy";
import type { FeatureCollection, Point } from "geojson";
import { rasterizeNodeIcon, MAP_ICON_IDS, nodeObserverIconId, SELECTION_RING_ICON_ID, OBSERVER_COLOR } from "./node-icons";
import type { NodeFeatureProps } from "./node-geojson";
import {
  NODES_SOURCE_ID,
  NODES_CLUSTER_LAYER_ID,
  NODES_CLUSTER_BREAKDOWN_LAYER_ID,
  NODES_CLUSTER_FALLBACK_LAYER_ID,
  NODES_CLUSTER_HALO_LAYER_ID,
  NODES_DOT_LAYER_ID,
  NODES_POINT_LAYER_ID,
  NODES_SELECTED_LAYER_ID,
  NODES_SELECTED_LEAF_LAYER_ID,
  CLUSTER_RADIUS,
  CLUSTER_MIN_POINTS,
  CLUSTER_MAX_ZOOM,
  NODES_SOURCE_MAXZOOM,
  NODE_LABEL_MIN_ZOOM,
  NODES_GLOW_LAYER_ID,
  FOCUSED_NEIGHBORS_LAYER_ID,
  PACKET_FLOW_COLOR,
  NODE_TYPE_NAMES,
  NODE_ICON_UNKNOWN,
  nodeIconId,
} from "./types";
import { CLUSTER_ZOOM_DURATION_MS, clusterClickDecision, fallbackClusterZoom } from "./cluster-navigation";
import { prepareSpiderfyForDirectUse } from "./spiderfy-adapter";
import {
  clusterRadiusExpression,
  clusterTextSizeExpression,
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
} from "./marker-scale";
import { clusterBreakdownTextExpression, clusterRoleProperties } from "./cluster-style";
import { applyNodeClusterMode } from "./node-clustering";
import { syncMapOverlayLayerOrder } from "./map-layer-order";

type NodeFC = FeatureCollection<Point, NodeFeatureProps>;

function cssVar(name: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

const EMPTY_FC: FeatureCollection<Point> = { type: "FeatureCollection", features: [] };

// Place the selection ring on the selected node's spiderfied leaf, or clear it. Spiderfy fans each
// leaf out from the shared cluster center via a screen-space icon-offset, so we draw the ring on
// that same center + offset: it rides the same symbol pipeline as the leaf and stays aligned on any
// pitch/terrain (a circle layer would sit on the terrain and drift). The id-filtered
// NODES_SELECTED_LAYER_ID can't reach a leaf — it's aggregated inside a cluster with no top-level id.
function syncLeafSelectionRing(map: MapLibreMap, selectedId: string | null): void {
  const src = map.getSource(NODES_SELECTED_LEAF_LAYER_ID) as GeoJSONSource | undefined;
  if (!src || !map.getLayer(NODES_SELECTED_LEAF_LAYER_ID)) return;
  let center: [number, number] | null = null;
  let offset: [number, number] = [0, 0];
  if (selectedId) {
    for (const layer of map.getStyle().layers ?? []) {
      if (!layer.id.includes("-spiderfy-leaf")) continue;
      const feat = map
        .querySourceFeatures(layer.id)
        .find((f) => f.properties?.["id"] === selectedId);
      if (feat && feat.geometry.type === "Point") {
        center = feat.geometry.coordinates as [number, number];
        const o = map.getLayoutProperty(layer.id, "icon-offset");
        if (Array.isArray(o) && o.length === 2) offset = [Number(o[0]), Number(o[1])];
        break;
      }
    }
  }
  map.setLayoutProperty(NODES_SELECTED_LEAF_LAYER_ID, "icon-offset", offset);
  src.setData(
    center
      ? {
          type: "FeatureCollection",
          features: [{ type: "Feature", geometry: { type: "Point", coordinates: center }, properties: {} }],
        }
      : EMPTY_FC,
  );
}

// Icon per device type; observers get the -observer pip variant, unknown types the fallback ring.
const ICON_IMAGE: ExpressionSpecification = [
  "match",
  ["get", "nodeTypeName"],
  ...NODE_TYPE_NAMES.flatMap((t) => [
    t,
    ["case", ["to-boolean", ["get", "isObserver"]], nodeObserverIconId(t), nodeIconId(t)],
  ]),
  NODE_ICON_UNKNOWN,
] as unknown as ExpressionSpecification;

// Node labels fade in only past NODE_LABEL_MIN_ZOOM.
const LABEL_OPACITY: ExpressionSpecification = ["step", ["zoom"], 0, NODE_LABEL_MIN_ZOOM, 1];

const SPIDER_LEAVES_LAYOUT: SymbolLayerSpecification["layout"] = {
  "icon-image": ICON_IMAGE,
  // Spiderfy only activates at close zoom, but sharing the same expression guarantees leaf markers
  // never jump to a different visual scale if that threshold changes later.
  "icon-size": nodeIconSizeExpression() as ExpressionSpecification,
  "icon-allow-overlap": true,
};

// Renders nodes as a clustered GeoJSON layer (per-type icons, spiderfy for co-located nodes, name
// labels at high zoom). Like useMapLibre, the imperative work re-adds itself after every style switch.
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
  resetKey = "",
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
  const [dpr, setDpr] = useState(() => (typeof window === "undefined" ? 1 : window.devicePixelRatio));
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    let mql = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    const onChange = () => {
      setDpr(window.devicePixelRatio);
      mql.removeEventListener("change", onChange);
      mql = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      mql.addEventListener("change", onChange);
    };
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  // Build the source + layers and keep their paint in step with the basemap and theme. Idempotent,
  // so it re-runs safely on first ready, after each style switch, and on theme changes. Marker
  // images are handled by the icons effect below.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isReady) return;

    const textColor = isDark ? "#FAFAFA" : "#18181B";
    const halo = isDark ? "rgba(0,0,0,0.85)" : "rgba(255,255,255,0.92)";

    // MapLibre 5.x supports changing cluster options in place. Do not infer the source mode from
    // React state: the map/source can outlive this hook across remounts, which previously allowed a
    // stale cluster:false source from Live to survive while the UI showed "Clustering: On".
    let nodesSource = map.getSource(NODES_SOURCE_ID) as GeoJSONSource | undefined;
    if (!nodesSource) {
      map.addSource(NODES_SOURCE_ID, {
        type: "geojson",
        data: geojsonRef.current,
        maxzoom: NODES_SOURCE_MAXZOOM,
        cluster: effectiveClustered,
        clusterRadius: CLUSTER_RADIUS,
        clusterMaxZoom: CLUSTER_MAX_ZOOM,
        clusterMinPoints: CLUSTER_MIN_POINTS,
        clusterProperties: clusterRoleProperties(),
        // promote the node id so live packet-flow can flash individual nodes via feature-state
        promoteId: "id",
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

    // Cluster markers use a neutral, high-contrast bubble with the total count as the primary carrier
    // and a compact R/C/M/S composition below it. Keeping the cluster neutral prevents the marker from
    // disappearing into the same neon line/region palette used elsewhere on the map.
    const clusterFill = "rgba(33,41,54,0.94)";
    const clusterBorder = isDark ? "#7B8493" : "#5F6672";
    if (!map.getLayer(NODES_CLUSTER_HALO_LAYER_ID)) {
      map.addLayer({
        id: NODES_CLUSTER_HALO_LAYER_ID,
        type: "circle",
        source: NODES_SOURCE_ID,
        filter: ["has", "point_count"],
        paint: {
          "circle-radius": ["+", clusterRadiusExpression(), 3] as unknown as ExpressionSpecification,
          "circle-color": "rgba(0,0,0,0.58)",
          "circle-opacity": 0.72,
          "circle-blur": 0.55,
        },
      } as CircleLayerSpecification);
    }
    if (!map.getLayer(NODES_CLUSTER_FALLBACK_LAYER_ID)) {
      map.addLayer({
        id: NODES_CLUSTER_FALLBACK_LAYER_ID,
        type: "circle",
        source: NODES_SOURCE_ID,
        filter: ["has", "point_count"],
        paint: {
          "circle-radius": clusterRadiusExpression() as ExpressionSpecification,
          "circle-color": clusterFill,
          "circle-stroke-color": clusterBorder,
          "circle-stroke-width": ["step", ["get", "point_count"], 1.5, 30, 2.25, 100, 2.6],
          "circle-opacity": 1,
        },
      } as CircleLayerSpecification);
    }
    map.setPaintProperty(NODES_CLUSTER_FALLBACK_LAYER_ID, "circle-stroke-color", clusterBorder);
    map.setPaintProperty(NODES_CLUSTER_FALLBACK_LAYER_ID, "circle-color", clusterFill);

    // This text-only symbol remains the Spiderfy parent layer; the circle below it owns the visual
    // bubble/hit target, so cluster rendering no longer depends on async rasterized SVG images.
    if (!map.getLayer(NODES_CLUSTER_LAYER_ID)) {
      map.addLayer({
        id: NODES_CLUSTER_LAYER_ID,
        type: "symbol",
        source: NODES_SOURCE_ID,
        filter: ["has", "point_count"],
        layout: {
          "text-field": ["get", "point_count_abbreviated"],
          "text-font": ["Noto Sans Bold"],
          "text-size": clusterTextSizeExpression() as ExpressionSpecification,
          "text-offset": [0, -0.35],
          "text-allow-overlap": true,
          "text-ignore-placement": true,
        },
        paint: {
          "text-color": "#FFFFFF",
          "text-halo-color": "rgba(0,0,0,0.6)",
          "text-halo-width": 1,
        },
      } as SymbolLayerSpecification);
    }
    if (!map.getLayer(NODES_CLUSTER_BREAKDOWN_LAYER_ID)) {
      map.addLayer({
        id: NODES_CLUSTER_BREAKDOWN_LAYER_ID,
        type: "symbol",
        source: NODES_SOURCE_ID,
        filter: ["has", "point_count"],
        layout: {
          "text-field": clusterBreakdownTextExpression() as ExpressionSpecification,
          "text-font": ["Noto Sans Bold"],
          "text-size": 9,
          "text-offset": [0, 0.85],
          "text-allow-overlap": true,
          "text-ignore-placement": true,
        },
        paint: {
          "text-halo-color": "rgba(12,16,24,0.96)",
          "text-halo-width": 0.9,
        },
      } as SymbolLayerSpecification);
    }

    // Cluster layers are meaningful only while the source is clustered. Hiding them immediately on
    // Live/Off transitions prevents stale worker tiles from flashing an old cluster during the
    // asynchronous setClusterOptions update; enabling them makes the normal-map contract explicit.
    const clusterVisibility = effectiveClustered ? "visible" : "none";
    for (const layerId of [
      NODES_CLUSTER_HALO_LAYER_ID,
      NODES_CLUSTER_FALLBACK_LAYER_ID,
      NODES_CLUSTER_LAYER_ID,
      NODES_CLUSTER_BREAKDOWN_LAYER_ID,
    ]) {
      if (map.getLayer(layerId)) map.setLayoutProperty(layerId, "visibility", clusterVisibility);
    }

    // At overview zooms the detailed SVG glyphs collapse into compact role-coloured dots. This is
    // deliberately a separate layer instead of scaling the intricate glyphs down to unreadable pixels:
    // the map reads like a network distribution view from afar, then crossfades into Beacon's full icons.
    const dotColor: ExpressionSpecification = [
      "match",
      ["get", "nodeTypeName"],
      "companion", cssVar("--palette-primary", "#3B82F6"),
      "repeater", cssVar("--palette-secondary", "#A78BFA"),
      "room_server", cssVar("--palette-green", "#22C55E"),
      "sensor", cssVar("--palette-warn", "#EAB308"),
      cssVar("--palette-text-dim", "#71717A"),
    ] as unknown as ExpressionSpecification;
    const dotOutline = isDark ? "rgba(9,9,11,0.92)" : "rgba(255,255,255,0.96)";
    if (!map.getLayer(NODES_DOT_LAYER_ID)) {
      map.addLayer({
        id: NODES_DOT_LAYER_ID,
        type: "circle",
        source: NODES_SOURCE_ID,
        filter: ["!", ["has", "point_count"]],
        paint: {
          "circle-radius": nodeDotRadiusExpression(liveMode) as ExpressionSpecification,
          "circle-color": dotColor,
          "circle-opacity": nodeDotOpacityExpression(liveMode) as ExpressionSpecification,
          "circle-stroke-color": (liveMode
            ? dotOutline
            : [
                "case",
                ["to-boolean", ["get", "isObserver"]],
                OBSERVER_COLOR,
                dotOutline,
              ]) as ExpressionSpecification,
          "circle-stroke-width": (liveMode
            ? LIVE_NODE_STROKE_WIDTH_PX
            : [
                "case",
                ["to-boolean", ["get", "isObserver"]],
                1.4,
                0.9,
              ]) as ExpressionSpecification,
        },
      } as CircleLayerSpecification);
    }

    if (!map.getLayer(NODES_POINT_LAYER_ID)) {
      map.addLayer({
        id: NODES_POINT_LAYER_ID,
        type: "symbol",
        source: NODES_SOURCE_ID,
        filter: ["!", ["has", "point_count"]],
        layout: {
          "icon-image": ICON_IMAGE,
          "icon-size": nodeIconSizeExpression() as ExpressionSpecification,
          "icon-allow-overlap": true,
          "text-field": ["get", "name"],
          "text-font": ["Noto Sans Regular"],
          "text-size": 11,
          "text-offset": [0, 1.2],
          "text-anchor": "top",
          "text-optional": true,
        },
        paint: {
          "icon-opacity": nodeIconOpacityExpression(liveMode) as ExpressionSpecification,
          "text-color": textColor,
          "text-halo-color": halo,
          "text-halo-width": 1.3,
          "text-opacity": liveMode ? 0 : LABEL_OPACITY, // Live keeps the path field visually quiet
        },
      } as SymbolLayerSpecification);
    }

    // Live packet-flow pulse: a soft halo behind each node that blooms with the glow feature-state
    // (fed by useMapPacketFlow's rAF loop as a dot crosses the node) and eases back out after. This
    // is the only node-level live animation — nodes themselves are never dimmed.
    const flowColor = cssVar("--palette-warn", PACKET_FLOW_COLOR);
    if (!map.getLayer(NODES_GLOW_LAYER_ID)) {
      map.addLayer(
        {
          id: NODES_GLOW_LAYER_ID,
          type: "circle",
          source: NODES_SOURCE_ID,
          filter: ["!", ["has", "point_count"]],
          paint: {
            "circle-radius": glowRadiusExpression() as ExpressionSpecification,
            "circle-color": flowColor,
            "circle-opacity": ["*", ["coalesce", ["feature-state", "glow"], 0], 0.4],
            "circle-blur": 1,
          },
        } as CircleLayerSpecification,
        NODES_CLUSTER_FALLBACK_LAYER_ID, // beneath the cluster + point layers
      );
    }
    map.setPaintProperty(NODES_GLOW_LAYER_ID, "circle-color", flowColor);

    // Ring under the selected node's icon. Only matches an unclustered point (clusters carry no id);
    // color tracks --palette-primary.
    const primary = cssVar("--palette-primary", "#3B82F6");
    if (!map.getLayer(NODES_SELECTED_LAYER_ID)) {
      map.addLayer(
        {
          id: NODES_SELECTED_LAYER_ID,
          type: "circle",
          source: NODES_SOURCE_ID,
          filter: ["==", ["get", "id"], selectedNodeIdRef.current ?? ""],
          paint: {
            "circle-radius": selectionRadiusExpression(liveMode) as ExpressionSpecification,
            // A small opaque knockout prevents focused-neighbor lines from visually cutting through
            // the selected repeater while the symbol icon remains on top.
            "circle-color": isDark ? "rgba(9,9,11,0.9)" : "rgba(255,255,255,0.92)",
            "circle-stroke-width": selectionStrokeExpression() as ExpressionSpecification,
            "circle-stroke-color": primary,
            "circle-stroke-opacity": 0.95,
          },
        },
        NODES_CLUSTER_FALLBACK_LAYER_ID, // insert beneath the cluster + point symbol layers
      );
    }
    map.setPaintProperty(NODES_SELECTED_LAYER_ID, "circle-stroke-color", primary);
    map.setPaintProperty(NODES_SELECTED_LAYER_ID, "circle-color", isDark ? "rgba(9,9,11,0.9)" : "rgba(255,255,255,0.92)");

    // Same ring for a node shown as a spiderfied leaf, but as a SYMBOL so it tracks the leaf's
    // offset (see syncLeafSelectionRing). The ring image is supplied by the icons effect.
    if (!map.getSource(NODES_SELECTED_LEAF_LAYER_ID)) {
      map.addSource(NODES_SELECTED_LEAF_LAYER_ID, { type: "geojson", data: EMPTY_FC });
    }
    if (!map.getLayer(NODES_SELECTED_LEAF_LAYER_ID)) {
      map.addLayer(
        {
          id: NODES_SELECTED_LEAF_LAYER_ID,
          type: "symbol",
          source: NODES_SELECTED_LEAF_LAYER_ID,
          layout: {
            "icon-image": SELECTION_RING_ICON_ID,
            "icon-size": nodeIconSizeExpression() as ExpressionSpecification,
            "icon-offset": [0, 0],
            "icon-allow-overlap": true,
          },
        },
        NODES_CLUSTER_FALLBACK_LAYER_ID, // beneath the markers; the dynamic leaf layers still render on top
      );
    }
    syncLeafSelectionRing(map, selectedNodeIdRef.current);

    // node-label colors track the basemap dark/light flag (cluster count is white on the hexagon)
    map.setPaintProperty(NODES_POINT_LAYER_ID, "text-color", textColor);
    map.setPaintProperty(NODES_POINT_LAYER_ID, "text-halo-color", halo);
    map.setPaintProperty(NODES_DOT_LAYER_ID, "circle-color", dotColor);
    map.setPaintProperty(NODES_DOT_LAYER_ID, "circle-radius", nodeDotRadiusExpression(liveMode));
    map.setPaintProperty(NODES_DOT_LAYER_ID, "circle-opacity", nodeDotOpacityExpression(liveMode));
    map.setPaintProperty(
      NODES_DOT_LAYER_ID,
      "circle-stroke-color",
      liveMode
        ? dotOutline
        : (["case", ["to-boolean", ["get", "isObserver"]], OBSERVER_COLOR, dotOutline] as unknown as ExpressionSpecification),
    );
    map.setPaintProperty(
      NODES_DOT_LAYER_ID,
      "circle-stroke-width",
      liveMode
        ? LIVE_NODE_STROKE_WIDTH_PX
        : (["case", ["to-boolean", ["get", "isObserver"]], 1.4, 0.9] as unknown as ExpressionSpecification),
    );
    map.setPaintProperty(NODES_POINT_LAYER_ID, "icon-opacity", nodeIconOpacityExpression(liveMode));
    map.setPaintProperty(NODES_POINT_LAYER_ID, "text-opacity", liveMode ? 0 : LABEL_OPACITY);
    map.setPaintProperty(NODES_SELECTED_LAYER_ID, "circle-radius", selectionRadiusExpression(liveMode));

    // seed the (possibly just-recreated) source; live updates flow through the geojson effect below
    (map.getSource(NODES_SOURCE_ID) as GeoJSONSource).setData(geojsonRef.current);
    syncMapOverlayLayerOrder(map);
  }, [mapRef, isReady, isDark, effectiveClustered, liveMode, themeKey]);

  // Supply and re-color the marker images. SVG glyphs rasterize async, so they're provided both
  // proactively here and lazily on styleimagemissing. Re-runs on a theme/basemap/DPR change to
  // re-rasterize; a basemap switch also drops the images via setStyle, which this then restores.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isReady) return;
    let cancelled = false;
    const provide = (id: string) =>
      rasterizeNodeIcon(id, isDark)
        .then((icon) => {
          if (cancelled || !icon || mapRef.current !== map) return;
          if (map.hasImage(id)) map.removeImage(id);
          map.addImage(id, icon.data, { pixelRatio: icon.pixelRatio });
        })
        .catch(() => {
          /* an icon failed to rasterize; the layer simply draws nothing for that id */
        });
    const onMissing = (e: { id: string }) => provide(e.id);
    map.on("styleimagemissing", onMissing);
    // A symbol won't draw until its icon is in, and adding one late doesn't redraw tiles that
    // already laid out — that's the "markers only show after I pan/zoom" bug. So once every icon
    // is ready, nudge the source to lay the markers out again (setData reloads the whole source).
    // styleimagemissing still covers anything asked for before we get here.
    Promise.all(MAP_ICON_IDS.map(provide)).then(() => {
      if (cancelled || mapRef.current !== map) return;
      const src = map.getSource(NODES_SOURCE_ID) as GeoJSONSource | undefined;
      if (src) src.setData(geojsonRef.current);
    });
    return () => {
      cancelled = true;
      map.off("styleimagemissing", onMissing);
    };
  }, [mapRef, isReady, isDark, themeKey, dpr]);

  // Reflect the shared selection as a ring (mirrors the table's row highlight). Its own effect so
  // changing the selection doesn't rebuild the source/layers.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isReady || !map.getLayer(NODES_SELECTED_LAYER_ID)) return;
    map.setFilter(NODES_SELECTED_LAYER_ID, ["==", ["get", "id"], selectedNodeId ?? ""]);
    syncLeafSelectionRing(map, selectedNodeId);
  }, [mapRef, isReady, selectedNodeId]);

  // Restore the active presentation after a style/theme/source rebuild. Normal mode crossfades
  // overview dots into Beacon glyphs; Live intentionally keeps every node as the same compact dot
  // and suppresses labels so packet trails remain the strongest visual signal.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isReady) return;
    if (map.getLayer(NODES_POINT_LAYER_ID)) {
      map.setPaintProperty(NODES_POINT_LAYER_ID, "icon-opacity", nodeIconOpacityExpression(liveMode));
      map.setPaintProperty(NODES_POINT_LAYER_ID, "text-opacity", liveMode ? 0 : LABEL_OPACITY);
    }
    if (map.getLayer(NODES_DOT_LAYER_ID)) {
      map.setPaintProperty(NODES_DOT_LAYER_ID, "circle-radius", nodeDotRadiusExpression(liveMode));
      map.setPaintProperty(NODES_DOT_LAYER_ID, "circle-opacity", nodeDotOpacityExpression(liveMode));
    }
    if (map.getLayer(NODES_SELECTED_LAYER_ID)) {
      map.setPaintProperty(NODES_SELECTED_LAYER_ID, "circle-radius", selectionRadiusExpression(liveMode));
    }
    if (map.getLayer(NODES_CLUSTER_LAYER_ID)) map.setPaintProperty(NODES_CLUSTER_LAYER_ID, "text-opacity", 1);
    if (map.getLayer(NODES_CLUSTER_BREAKDOWN_LAYER_ID)) map.setPaintProperty(NODES_CLUSTER_BREAKDOWN_LAYER_ID, "text-opacity", 1);
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
        const id = f.properties?.["id"];
        if (typeof id === "string") onSelectNodeRef.current(id);
      },
      spiderLegsColor: cssVar("--palette-text-dim", "#5F5F65"),
      spiderLegsWidth: 2,
      spiderLeavesLayout: SPIDER_LEAVES_LAYOUT,
    });
    prepareSpiderfyForDirectUse(
      spider as unknown as {
        clickedParentClusterStyle: { type: "symbol"; layout: object; paint: object } | null;
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
      syncLeafSelectionRing(map, selectedNodeIdRef.current);
    };

    const onMapClick = (e: MapMouseEvent) => {
      const rendered = map.queryRenderedFeatures(e.point);
      const focusedNeighbor = rendered.find((feature) => feature.layer.id === FOCUSED_NEIGHBORS_LAYER_ID);
      const focusedId = focusedNeighbor?.properties?.["id"];
      if (typeof focusedId === "string") {
        onSelectNodeRef.current(focusedId);
        return;
      }
      const leaf = rendered.find((feature) => feature.layer.id.includes(`${NODES_CLUSTER_LAYER_ID}-spiderfy-leaf`));
      if (leaf) {
        const id = leaf.properties?.["id"];
        if (typeof id === "string") onSelectNodeRef.current(id);
        return;
      }

      const cluster = map.queryRenderedFeatures(e.point, {
        layers: [NODES_CLUSTER_LAYER_ID, NODES_CLUSTER_BREAKDOWN_LAYER_ID, NODES_CLUSTER_FALLBACK_LAYER_ID],
      })[0];
      const clusterFeature = cluster;
      if (clusterFeature?.geometry.type === "Point") {
        const clusterId = Number(clusterFeature.properties?.["cluster_id"]);
        const center = clusterFeature.geometry.coordinates as [number, number];
        const source = map.getSource(NODES_SOURCE_ID) as GeoJSONSource | undefined;
        if (source && Number.isFinite(clusterId)) {
          const actionId = ++clusterActionRef.current;
          clearSpider();
          const isCurrentAction = () =>
            clusterActionRef.current === actionId &&
            mapRef.current === map &&
            map.getSource(NODES_SOURCE_ID) === source;

          void source.getClusterExpansionZoom(clusterId).then((expansionZoom) => {
            if (!isCurrentAction()) return;
            const maxExpansionZoom = Math.min(CLUSTER_MAX_ZOOM, map.getMaxZoom());
            const decision = clusterClickDecision(map.getZoom(), expansionZoom, maxExpansionZoom);
            if (decision.type === "zoom") {
              clearSpider();
              map.easeTo({ center, zoom: decision.zoom, duration: CLUSTER_ZOOM_DURATION_MS });
            } else {
              spider.spiderfy(NODES_CLUSTER_LAYER_ID, clusterId);
              requestAnimationFrame(() => {
                if (isCurrentAction()) syncLeafSelectionRing(map, selectedNodeIdRef.current);
              });
            }
          }).catch(() => {
            // A transient source/style race should not make the cluster dead. Move closer if possible;
            // at the ceiling, fall back to spiderfy. Ignore a rejection from an obsolete source/action.
            if (!isCurrentAction()) return;
            const maxExpansionZoom = Math.min(CLUSTER_MAX_ZOOM, map.getMaxZoom());
            const fallbackZoom = fallbackClusterZoom(map.getZoom(), maxExpansionZoom);
            if (fallbackZoom != null) {
              clearSpider();
              map.easeTo({ center, zoom: fallbackZoom, duration: CLUSTER_ZOOM_DURATION_MS });
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
        [[e.point.x - r, e.point.y - r], [e.point.x + r, e.point.y + r]],
        { layers: [NODES_POINT_LAYER_ID, NODES_DOT_LAYER_ID] },
      );
      const id = features.find((feature) => typeof feature.properties?.["id"] === "string")?.properties?.["id"];
      if (typeof id === "string") onSelectNodeRef.current(id);
      else {
        clearSpider();
        if (selectedNodeIdRef.current) onSelectNodeRef.current(null);
      }
    };

    const setPointer = () => { map.getCanvas().style.cursor = "pointer"; };
    const clearPointer = () => { map.getCanvas().style.cursor = ""; };
    map.on("click", onMapClick);
    for (const layer of [NODES_POINT_LAYER_ID, NODES_DOT_LAYER_ID, NODES_CLUSTER_LAYER_ID, NODES_CLUSTER_BREAKDOWN_LAYER_ID, NODES_CLUSTER_FALLBACK_LAYER_ID]) {
      map.on("mouseenter", layer, setPointer);
      map.on("mouseleave", layer, clearPointer);
    }

    // A spider fan is a terminal same-location inspection aid; camera motion closes it rather than
    // trying to preserve pixel offsets through arbitrary pan/zoom/terrain changes.
    const onMoveStart = () => {
      cancelPendingClusterAction();
      clearSpider();
    };
    map.on("movestart", onMoveStart);

    return () => {
      map.off("click", onMapClick);
      cancelPendingClusterAction();
      map.off("movestart", onMoveStart);
      for (const layer of [NODES_POINT_LAYER_ID, NODES_DOT_LAYER_ID, NODES_CLUSTER_LAYER_ID, NODES_CLUSTER_BREAKDOWN_LAYER_ID, NODES_CLUSTER_FALLBACK_LAYER_ID]) {
        map.off("mouseenter", layer, setPointer);
        map.off("mouseleave", layer, clearPointer);
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
