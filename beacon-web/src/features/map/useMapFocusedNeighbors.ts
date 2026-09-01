import { useEffect, useRef } from "react";
import type { Map as MapLibreMap, GeoJSONSource, CircleLayerSpecification, ExpressionSpecification } from "maplibre-gl";
import type { FeatureCollection, Point } from "geojson";
import type { FocusedNeighborPointProps } from "./node-geojson";
import {
  FOCUSED_NEIGHBORS_LAYER_ID,
  FOCUSED_NEIGHBORS_BASE_LAYER_ID,
  FOCUSED_NEIGHBORS_SOURCE_ID,
  FOCUSED_SELECTED_BACKDROP_LAYER_ID,
} from "./types";
import { syncMapOverlayLayerOrder } from "./map-layer-order";

type Points = FeatureCollection<Point, FocusedNeighborPointProps>;

function paletteVar(name: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

export function useMapFocusedNeighbors(
  mapRef: React.RefObject<MapLibreMap | null>,
  isReady: boolean,
  points: Points,
  liveMode: boolean,
  themeKey: string,
  onSelectNode: (id: string) => void,
) {
  const selectRef = useRef(onSelectNode);
  useEffect(() => { selectRef.current = onSelectNode; }, [onSelectNode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isReady) return;
    const typeColor: ExpressionSpecification = [
      "match", ["get", "nodeTypeName"],
      "companion", paletteVar("--palette-primary", "#3B82F6"),
      "repeater", paletteVar("--palette-secondary", "#A78BFA"),
      "room_server", paletteVar("--palette-green", "#22C55E"),
      "sensor", paletteVar("--palette-warn", "#EAB308"),
      paletteVar("--palette-text-muted", "#71717A"),
    ] as unknown as ExpressionSpecification;
    const accent = paletteVar("--palette-primary", "#3B82F6");
    const backdrop = paletteVar("--palette-bg-base", "#09090B");
    if (!map.getSource(FOCUSED_NEIGHBORS_SOURCE_ID)) map.addSource(FOCUSED_NEIGHBORS_SOURCE_ID, { type: "geojson", data: points });
    if (!map.getLayer(FOCUSED_SELECTED_BACKDROP_LAYER_ID)) {
      map.addLayer({
        id: FOCUSED_SELECTED_BACKDROP_LAYER_ID,
        type: "circle",
        source: FOCUSED_NEIGHBORS_SOURCE_ID,
        filter: ["==", ["get", "selected"], true],
        paint: {
          "circle-radius": liveMode ? 6 : 13,
          "circle-color": backdrop,
          "circle-opacity": 0.9,
          "circle-stroke-color": accent,
          "circle-stroke-width": liveMode ? 1.2 : 1.5,
        },
      } as CircleLayerSpecification);
    }
    if (!map.getLayer(FOCUSED_NEIGHBORS_BASE_LAYER_ID)) {
      map.addLayer({
        id: FOCUSED_NEIGHBORS_BASE_LAYER_ID,
        type: "circle",
        source: FOCUSED_NEIGHBORS_SOURCE_ID,
        filter: ["!=", ["get", "selected"], true],
        paint: {
          "circle-radius": liveMode ? 3.6 : 6.5,
          "circle-color": backdrop,
          "circle-opacity": 0.94,
          "circle-stroke-color": typeColor,
          "circle-stroke-width": liveMode ? 1 : 1.3,
        },
      } as CircleLayerSpecification);
    }
    if (!map.getLayer(FOCUSED_NEIGHBORS_LAYER_ID)) {
      map.addLayer({
          id: FOCUSED_NEIGHBORS_LAYER_ID,
          type: "circle",
          source: FOCUSED_NEIGHBORS_SOURCE_ID,
          filter: ["!=", ["get", "selected"], true],
          paint: {
            // Endpoints stay unclustered and render above the normal node layer, so a focused edge
            // never terminates in empty space even if its base-source node is filtered or clustered.
            "circle-radius": liveMode ? 6.5 : 13.5,
            "circle-color": "rgba(0,0,0,0)",
            "circle-opacity": 1,
            "circle-stroke-color": accent,
            "circle-stroke-opacity": 0.72,
            "circle-stroke-width": liveMode ? 1 : 1.25,
          },
        } as CircleLayerSpecification);
    }
    map.setPaintProperty(FOCUSED_SELECTED_BACKDROP_LAYER_ID, "circle-radius", liveMode ? 6 : 13);
    map.setPaintProperty(FOCUSED_SELECTED_BACKDROP_LAYER_ID, "circle-color", backdrop);
    map.setPaintProperty(FOCUSED_SELECTED_BACKDROP_LAYER_ID, "circle-stroke-color", accent);
    map.setPaintProperty(FOCUSED_SELECTED_BACKDROP_LAYER_ID, "circle-stroke-width", liveMode ? 1.2 : 1.5);
    map.setPaintProperty(FOCUSED_NEIGHBORS_BASE_LAYER_ID, "circle-radius", liveMode ? 3.6 : 6.5);
    map.setPaintProperty(FOCUSED_NEIGHBORS_BASE_LAYER_ID, "circle-color", backdrop);
    map.setPaintProperty(FOCUSED_NEIGHBORS_BASE_LAYER_ID, "circle-stroke-color", typeColor);
    map.setPaintProperty(FOCUSED_NEIGHBORS_LAYER_ID, "circle-radius", liveMode ? 6.5 : 13.5);
    map.setPaintProperty(FOCUSED_NEIGHBORS_LAYER_ID, "circle-stroke-color", accent);
    map.setPaintProperty(FOCUSED_NEIGHBORS_LAYER_ID, "circle-stroke-width", liveMode ? 1 : 1.25);
    const source = map.getSource(FOCUSED_NEIGHBORS_SOURCE_ID) as GeoJSONSource;
    source.setData(points);
    syncMapOverlayLayerOrder(map);
    const onClick = (event: { features?: Array<{ properties?: Record<string, unknown> }> }) => {
      const id = event.features?.[0]?.properties?.["id"];
      if (typeof id === "string") selectRef.current(id);
    };
    const onEnter = () => { map.getCanvas().style.cursor = "pointer"; };
    const onLeave = () => { map.getCanvas().style.cursor = ""; };
    map.on("click", FOCUSED_NEIGHBORS_LAYER_ID, onClick);
    map.on("mouseenter", FOCUSED_NEIGHBORS_LAYER_ID, onEnter);
    map.on("mouseleave", FOCUSED_NEIGHBORS_LAYER_ID, onLeave);
    return () => {
      map.off("click", FOCUSED_NEIGHBORS_LAYER_ID, onClick);
      map.off("mouseenter", FOCUSED_NEIGHBORS_LAYER_ID, onEnter);
      map.off("mouseleave", FOCUSED_NEIGHBORS_LAYER_ID, onLeave);
    };
  }, [mapRef, isReady, points, liveMode, themeKey]);
}
