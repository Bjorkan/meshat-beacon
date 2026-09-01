import { useEffect, useRef } from "react";
import type {
  Map as MapLibreMap,
  GeoJSONSource,
  LineLayerSpecification,
} from "maplibre-gl";
import {
  IATA_BORDERS_SOURCE_ID,
  IATA_BORDERS_LINE_LAYER_ID,
  NODES_CLUSTER_LAYER_ID,
} from "./types";
import type { BorderFeatureCollection } from "./useMapBordersData";
import { syncMapOverlayLayerOrder } from "./map-layer-order";

function paletteVar(name: string, fallback: string): string {
  return (
    getComputedStyle(document.documentElement).getPropertyValue(name).trim() ||
    fallback
  );
}

// Draws IATA region borders as an outline only (no fill) beneath the node markers. Mirrors
// useMapNeighbors: the source/layer re-add themselves after a style switch, the paint tracks the
// palette on theme change, and border data flows through a separate setData effect so toggling the
// layer on/off never rebuilds it.
export function useMapBorders(
  mapRef: React.RefObject<MapLibreMap | null>,
  isReady: boolean,
  data: BorderFeatureCollection,
  themeKey: string,
) {
  const dataRef = useRef(data);
  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  // build source + line, and keep the colour in step with the palette
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isReady) return;

    const color = paletteVar("--palette-secondary", "#A78BFA");
    const beforeId = map.getLayer(NODES_CLUSTER_LAYER_ID)
      ? NODES_CLUSTER_LAYER_ID
      : undefined;

    if (!map.getSource(IATA_BORDERS_SOURCE_ID)) {
      map.addSource(IATA_BORDERS_SOURCE_ID, {
        type: "geojson",
        data: dataRef.current,
      });
    }
    if (!map.getLayer(IATA_BORDERS_LINE_LAYER_ID)) {
      map.addLayer(
        {
          id: IATA_BORDERS_LINE_LAYER_ID,
          type: "line",
          source: IATA_BORDERS_SOURCE_ID,
          layout: { "line-cap": "round", "line-join": "round" },
          paint: {
            "line-color": color,
            "line-width": 1.5,
            "line-opacity": 0.8,
          },
        } as LineLayerSpecification,
        beforeId,
      );
    }
    map.setPaintProperty(IATA_BORDERS_LINE_LAYER_ID, "line-color", color);
    (map.getSource(IATA_BORDERS_SOURCE_ID) as GeoJSONSource).setData(
      dataRef.current,
    );
    syncMapOverlayLayerOrder(map);
  }, [mapRef, isReady, themeKey]);

  // push new border data as the toggle / region changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isReady) return;
    const src = map.getSource(IATA_BORDERS_SOURCE_ID) as
      GeoJSONSource | undefined;
    if (src) src.setData(data);
  }, [mapRef, isReady, data]);

  // remove layer (before the source) on unmount; runs before useMapLibre tears the map down
  useEffect(() => {
    const map = mapRef.current;
    return () => {
      if (!map) return;
      try {
        if (map.getLayer(IATA_BORDERS_LINE_LAYER_ID))
          map.removeLayer(IATA_BORDERS_LINE_LAYER_ID);
        if (map.getSource(IATA_BORDERS_SOURCE_ID))
          map.removeSource(IATA_BORDERS_SOURCE_ID);
      } catch {
        // map may already be torn down
      }
    };
  }, [mapRef]);
}
