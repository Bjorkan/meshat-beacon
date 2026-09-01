import { useCallback, useEffect, useRef } from "react";
import type {
  Map as MapLibreMap,
  GeoJSONSource,
  CircleLayerSpecification,
  LineLayerSpecification,
} from "maplibre-gl";
import type { Feature, FeatureCollection, Point, LineString } from "geojson";
import type { WsManager } from "../../api/ws-manager";
import {
  packetChain,
  resolvedPathNodes,
  posAtHop,
  trailCoords,
} from "./packet-flow";
import {
  PACKET_FLOW_TRAIL_SOURCE_ID,
  PACKET_FLOW_TRAIL_LAYER_ID,
  PACKET_FLOW_DOT_SOURCE_ID,
  PACKET_FLOW_DOT_HALO_LAYER_ID,
  PACKET_FLOW_DOT_LAYER_ID,
  PACKET_FLOW_PULSE_SOURCE_ID,
  PACKET_FLOW_PULSE_GLOW_LAYER_ID,
  PACKET_FLOW_PULSE_RING_LAYER_ID,
  PACKET_FLOW_HOP_MS,
  PACKET_FLOW_TRAIL_FADE_MS,
  PACKET_FLOW_MAX,
  NODES_SOURCE_ID,
} from "./types";
import { packetFlowColor } from "./packet-flow-colors";
import {
  PACKET_PULSE_MAX,
  PACKET_RELAY_FORWARD_DELAY_MS,
  packetPulseFrame,
  type PacketPulseDirection,
} from "./packet-flow-pulses";
import { syncMapOverlayLayerOrder } from "./map-layer-order";

const EMPTY_FC: FeatureCollection = { type: "FeatureCollection", features: [] };

// One packet riding its hop path once. lastNode is the latest hop whose arrival pulse has been
// emitted; it also bounds the persistent feature-state glow for the already traversed path.
interface Flow {
  packetHash: string;
  color: string;
  coords: [number, number][];
  ids: (string | null)[];
  start: number;
  lastNode: number;
}

interface Pulse {
  coord: [number, number];
  color: string;
  direction: PacketPulseDirection;
  start: number;
}

// Live mode: each packet gets a stable hash colour, rides its resolved hop path, leaves a fading
// trail and generates radio-like node pulses. Transmit is an expanding ring; receive is the same
// visual language in reverse, contracting into the receiving node. Relays therefore read naturally
// as receive -> short forwarding delay -> transmit without adding another event subscription.
export function useMapPacketFlow(
  mapRef: React.RefObject<MapLibreMap | null>,
  isReady: boolean,
  enabled: boolean,
  wsManager: WsManager,
  themeKey: string,
  resetKey: string,
) {
  const flowsRef = useRef<Flow[]>([]);
  const pulsesRef = useRef<Pulse[]>([]);
  const litRef = useRef<Set<string>>(new Set());
  const rafRef = useRef<number | null>(null);

  const pushPulse = useCallback((pulse: Pulse) => {
    while (pulsesRef.current.length >= PACKET_PULSE_MAX) pulsesRef.current.shift();
    pulsesRef.current.push(pulse);
  }, []);

  const clearFlows = useCallback((map: MapLibreMap | null) => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    flowsRef.current = [];
    pulsesRef.current = [];
    try {
      for (const id of litRef.current) map?.removeFeatureState({ source: NODES_SOURCE_ID, id }, "glow");
      (map?.getSource(PACKET_FLOW_TRAIL_SOURCE_ID) as GeoJSONSource | undefined)?.setData(EMPTY_FC);
      (map?.getSource(PACKET_FLOW_DOT_SOURCE_ID) as GeoJSONSource | undefined)?.setData(EMPTY_FC);
      (map?.getSource(PACKET_FLOW_PULSE_SOURCE_ID) as GeoJSONSource | undefined)?.setData(EMPTY_FC);
    } catch {
      // style not ready / map already removed
    }
    litRef.current.clear();
  }, []);

  const startLoop = useCallback(() => {
    if (rafRef.current != null) return;

    function frame() {
      const map = mapRef.current;
      const now = performance.now();
      const dots: Feature<Point>[] = [];
      const lines: Feature<LineString>[] = [];
      const pulseFeatures: Feature<Point>[] = [];
      const glowByNode = new Map<string, number>();

      for (let i = flowsRef.current.length - 1; i >= 0; i--) {
        const flow = flowsRef.current[i]!;
        const nSeg = flow.coords.length - 1;
        const t = (now - flow.start) / PACKET_FLOW_HOP_MS;
        const reachedNode = Math.min(nSeg, Math.max(0, Math.floor(t + 1e-6)));

        // Emit every missed hop event if a frame was delayed. Pulse start times are based on the
        // packet clock, so a slow frame catches up rather than replaying old activity late.
        if (reachedNode > flow.lastNode) {
          for (let nodeIndex = Math.max(1, flow.lastNode + 1); nodeIndex <= reachedNode; nodeIndex += 1) {
            const arrival = flow.start + nodeIndex * PACKET_FLOW_HOP_MS;
            pushPulse({
              coord: flow.coords[nodeIndex]!,
              color: flow.color,
              direction: "inbound",
              start: arrival,
            });
            if (nodeIndex < nSeg) {
              pushPulse({
                coord: flow.coords[nodeIndex]!,
                color: flow.color,
                direction: "outbound",
                start: arrival + PACKET_RELAY_FORWARD_DELAY_MS,
              });
            }
          }
          flow.lastNode = reachedNode;
        }

        const headT = Math.min(Math.max(t, 0), nSeg);
        const fade =
          t > nSeg
            ? Math.max(0, 1 - (now - (flow.start + nSeg * PACKET_FLOW_HOP_MS)) / PACKET_FLOW_TRAIL_FADE_MS)
            : 1;

        const coords = trailCoords(flow.coords, headT);
        if (coords.length >= 2) {
          lines.push({
            type: "Feature",
            properties: { a: 0.66 * fade, color: flow.color },
            geometry: { type: "LineString", coordinates: coords },
          });
        }
        if (t >= 0 && t <= nSeg) {
          dots.push({
            type: "Feature",
            properties: { r: 5, a: 1, color: flow.color },
            geometry: { type: "Point", coordinates: posAtHop(flow.coords, headT) },
          });
        }

        if (fade > 0) {
          for (let k = 0; k <= flow.lastNode; k += 1) {
            const id = flow.ids[k];
            if (id != null) glowByNode.set(id, Math.max(glowByNode.get(id) ?? 0, fade));
          }
        }
        if (t > nSeg && fade <= 0) flowsRef.current.splice(i, 1);
      }

      for (let i = pulsesRef.current.length - 1; i >= 0; i -= 1) {
        const pulse = pulsesRef.current[i]!;
        const visual = packetPulseFrame(pulse.direction, now - pulse.start);
        if (!visual) {
          if (now >= pulse.start) pulsesRef.current.splice(i, 1);
          continue;
        }
        pulseFeatures.push({
          type: "Feature",
          properties: {
            color: pulse.color,
            r: visual.radius,
            a: visual.opacity,
            w: visual.strokeWidth,
            gr: visual.glowRadius,
            ga: visual.glowOpacity,
          },
          geometry: { type: "Point", coordinates: pulse.coord },
        });
      }

      try {
        for (const [id, glow] of glowByNode) map?.setFeatureState({ source: NODES_SOURCE_ID, id }, { glow });
        for (const id of litRef.current) {
          if (!glowByNode.has(id)) map?.removeFeatureState({ source: NODES_SOURCE_ID, id }, "glow");
        }
      } catch {
        // the node source may have been recreated by a Live/clustering/style transition
      }
      litRef.current = new Set(glowByNode.keys());

      (map?.getSource(PACKET_FLOW_TRAIL_SOURCE_ID) as GeoJSONSource | undefined)?.setData({
        type: "FeatureCollection",
        features: lines,
      });
      (map?.getSource(PACKET_FLOW_DOT_SOURCE_ID) as GeoJSONSource | undefined)?.setData({
        type: "FeatureCollection",
        features: dots,
      });
      (map?.getSource(PACKET_FLOW_PULSE_SOURCE_ID) as GeoJSONSource | undefined)?.setData({
        type: "FeatureCollection",
        features: pulseFeatures,
      });

      const busy = flowsRef.current.length > 0 || pulsesRef.current.length > 0 || litRef.current.size > 0;
      rafRef.current = busy ? requestAnimationFrame(frame) : null;
    }

    rafRef.current = requestAnimationFrame(frame);
  }, [mapRef, pushPulse]);

  // A small, fixed layer set renders every concurrent packet. Per-packet colour and per-pulse size
  // live in feature properties; we never create a source/layer per packet.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isReady) return;

    if (!map.getSource(PACKET_FLOW_TRAIL_SOURCE_ID)) {
      map.addSource(PACKET_FLOW_TRAIL_SOURCE_ID, { type: "geojson", data: EMPTY_FC });
    }
    if (!map.getLayer(PACKET_FLOW_TRAIL_LAYER_ID)) {
      map.addLayer({
        id: PACKET_FLOW_TRAIL_LAYER_ID,
        type: "line",
        source: PACKET_FLOW_TRAIL_SOURCE_ID,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": ["get", "color"],
          "line-width": 2.6,
          "line-dasharray": [2, 2],
          "line-opacity": ["get", "a"],
        },
      } as LineLayerSpecification);
    }

    if (!map.getSource(PACKET_FLOW_PULSE_SOURCE_ID)) {
      map.addSource(PACKET_FLOW_PULSE_SOURCE_ID, { type: "geojson", data: EMPTY_FC });
    }
    if (!map.getLayer(PACKET_FLOW_PULSE_GLOW_LAYER_ID)) {
      map.addLayer({
        id: PACKET_FLOW_PULSE_GLOW_LAYER_ID,
        type: "circle",
        source: PACKET_FLOW_PULSE_SOURCE_ID,
        paint: {
          "circle-radius": ["get", "gr"],
          "circle-color": ["get", "color"],
          "circle-opacity": ["get", "ga"],
          "circle-blur": 0.78,
        },
      } as CircleLayerSpecification);
    }
    if (!map.getLayer(PACKET_FLOW_PULSE_RING_LAYER_ID)) {
      map.addLayer({
        id: PACKET_FLOW_PULSE_RING_LAYER_ID,
        type: "circle",
        source: PACKET_FLOW_PULSE_SOURCE_ID,
        paint: {
          "circle-radius": ["get", "r"],
          "circle-color": "rgba(0,0,0,0)",
          "circle-opacity": 0,
          "circle-stroke-color": ["get", "color"],
          "circle-stroke-width": ["get", "w"],
          "circle-stroke-opacity": ["get", "a"],
        },
      } as CircleLayerSpecification);
    }

    if (!map.getSource(PACKET_FLOW_DOT_SOURCE_ID)) {
      map.addSource(PACKET_FLOW_DOT_SOURCE_ID, { type: "geojson", data: EMPTY_FC });
    }
    if (!map.getLayer(PACKET_FLOW_DOT_HALO_LAYER_ID)) {
      map.addLayer({
        id: PACKET_FLOW_DOT_HALO_LAYER_ID,
        type: "circle",
        source: PACKET_FLOW_DOT_SOURCE_ID,
        paint: {
          "circle-radius": ["+", ["get", "r"], 2.4],
          "circle-color": "rgba(0,0,0,0.5)",
          "circle-opacity": ["*", ["get", "a"], 0.5],
          "circle-blur": 0.5,
        },
      } as CircleLayerSpecification);
    }
    if (!map.getLayer(PACKET_FLOW_DOT_LAYER_ID)) {
      map.addLayer({
        id: PACKET_FLOW_DOT_LAYER_ID,
        type: "circle",
        source: PACKET_FLOW_DOT_SOURCE_ID,
        paint: {
          "circle-radius": ["get", "r"],
          "circle-color": ["get", "color"],
          "circle-opacity": ["get", "a"],
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": ["*", ["get", "a"], 1.1],
        },
      } as CircleLayerSpecification);
    }
    syncMapOverlayLayerOrder(map);
  }, [mapRef, isReady, themeKey]);

  useEffect(() => {
    wsManager.setResolvePath(enabled);
    return () => wsManager.setResolvePath(false);
  }, [enabled, wsManager]);

  // Launch one flow for every trusted resolved path. The source node transmits immediately; each
  // reached relay/destination receives an inward pulse, and relays then emit a delayed outbound wave.
  useEffect(() => {
    if (!enabled) return;
    const map = mapRef.current;
    const unsub = wsManager.onPacketObservation((data) => {
      const obs = data.observation;
      if (!obs?.resolvedPath) return;
      if ((obs.pathLength?.hashSize ?? 0) < 2) return;
      const nodes = resolvedPathNodes(packetChain(obs.resolvedSource, obs.resolvedPath, obs.resolvedDestination));
      if (nodes.length < 2) return;

      while (flowsRef.current.length >= PACKET_FLOW_MAX) flowsRef.current.shift();
      const color = packetFlowColor(data.packetHash);
      const start = performance.now();
      const coords = nodes.map((node) => [node.lng, node.lat] as [number, number]);
      flowsRef.current.push({
        packetHash: data.packetHash,
        color,
        coords,
        ids: nodes.map((node) => node.id),
        start,
        lastNode: 0,
      });
      pushPulse({ coord: coords[0]!, color, direction: "outbound", start });
      startLoop();
    });

    return () => {
      unsub();
      clearFlows(map);
    };
  }, [enabled, wsManager, mapRef, startLoop, clearFlows, pushPulse]);

  useEffect(() => {
    clearFlows(mapRef.current);
  }, [resetKey, mapRef, clearFlows]);

  useEffect(() => {
    const map = mapRef.current;
    return () => {
      clearFlows(map);
      if (!map) return;
      try {
        for (const id of [
          PACKET_FLOW_TRAIL_LAYER_ID,
          PACKET_FLOW_PULSE_GLOW_LAYER_ID,
          PACKET_FLOW_PULSE_RING_LAYER_ID,
          PACKET_FLOW_DOT_HALO_LAYER_ID,
          PACKET_FLOW_DOT_LAYER_ID,
        ]) {
          if (map.getLayer(id)) map.removeLayer(id);
        }
        for (const id of [
          PACKET_FLOW_TRAIL_SOURCE_ID,
          PACKET_FLOW_PULSE_SOURCE_ID,
          PACKET_FLOW_DOT_SOURCE_ID,
        ]) {
          if (map.getSource(id)) map.removeSource(id);
        }
      } catch {
        // map may already be torn down
      }
    };
  }, [mapRef, clearFlows]);
}
