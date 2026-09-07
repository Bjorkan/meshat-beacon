import type { Feature, FeatureCollection, LineString, Point } from 'geojson';
import type { PacketDetail, Observation, ResolvedHop } from '../../types/api';
import { PayloadType } from '../../types/enums';
import { packetChain, pathWithinLoRaRange } from './packet-flow';

export interface PathPoint {
  id: string;
  name?: string;
  lng: number;
  lat: number;
}

// A resolved hop is only trustworthy when its prefix is wide enough to be
// unambiguous. This matches the backend's neighbor rule (packet.go): path
// edges are only derived from >=3-byte hashes, and 1–2 byte prefixes stay
// excluded. The path map applies the same gate so it can never draw a
// physically impossible route from colliding 1-byte prefixes.
export const MIN_PATH_HASH_BYTES = 3;

export type PacketPathBlockReason = 'short-hash' | 'out-of-range' | 'unresolved';

export interface PacketPathBlockInfo {
  reason: PacketPathBlockReason;
  observedHashSize: number; // the best (widest) hashSize seen on this packet, e.g. 1
  count: number; // how many drawable candidates were held back
}

export interface PacketPath {
  key: string; // observerId, or "trace"
  label: string; // observer name, a truncated observer id, or "Trace route"
  propagationMs?: number; // packet's propagation to this observer (ms); absent for the trace route
  color: string;
  points: PathPoint[];
}

// Distinct, saturated hues that read on both the dark and light basemaps. Local constants (like
// PACKET_FLOW_COLOR), not theme tokens — the selector swatch reuses each path's color.
export const PATH_COLORS: string[] = [
  '#ff6b35', // orange
  '#00b4d8', // cyan
  '#22c55e', // green
  '#e879f9', // pink
  '#eab308', // yellow
  '#3b82f6', // blue
  '#ef4444', // red
  '#a78bfa', // violet
];

// The located nodes on a resolved path — first candidate per hop that has coords, deduped by id, in
// order. Modelled on resolvedPathNodes() in packet-flow.ts, but keeps each node's name for labels.
function pathPoints(hops: ResolvedHop[]): PathPoint[] {
  const seen = new Set<string>();
  const out: PathPoint[] = [];
  for (const hop of hops) {
    const node = hop.nodes.find((n) => n.latitude != null && n.longitude != null);
    if (node && !seen.has(node.id)) {
      seen.add(node.id);
      out.push({ id: node.id, name: node.name, lng: node.longitude!, lat: node.latitude! });
    }
  }
  return out;
}

function observerLabel(obs: Observation): string {
  return obs.observerName ?? obs.observerId.slice(0, 8);
}

// One verifierbar path per observation (and the trace route for TRACE packets): the route
// must be sent with >=3-byte hashes, resolve to >=2 located hops, and have every leg within
// direct LoRa range. Anything else is withheld so the map can never draw a physically
// impossible route from colliding 1-byte prefixes or an MQTT-stitched hop. Colors are
// assigned after sorting so the selector swatch matches the drawn line.
export function buildPacketPaths(detail: PacketDetail): PacketPath[] {
  return buildPacketPathResult(detail).paths;
}

// Same as buildPacketPaths, but also reports why candidates were withheld so the
// modal can explain instead of just showing an empty map. observedHashSize is the
// widest hashSize seen anywhere on this packet (used for the short-hash message).
export function buildPacketPathResult(detail: PacketDetail): {
  paths: PacketPath[];
  blocked: PacketPathBlockInfo | null;
} {
  const raw: Omit<PacketPath, 'color'>[] = [];
  let shortHashCount = 0;
  let outOfRangeCount = 0;
  let unresolvedCount = 0;
  let observedHashSize = 0;
  const add = (
    key: string,
    label: string,
    propagationMs: number | undefined,
    points: PathPoint[],
    hashSize: number | null,
  ) => {
    if (hashSize != null) observedHashSize = Math.max(observedHashSize, hashSize);
    // Not enough located hops to draw a line at all.
    if (points.length < 2) {
      unresolvedCount += 1;
      return;
    }
    // 1–2 byte prefixes collide across nodes: an "exact" match is a guess, not a route.
    // Unknown width (null) skips this gate — we don't claim a width we can't verify.
    if (hashSize != null && hashSize < MIN_PATH_HASH_BYTES) {
      shortHashCount += 1;
      return;
    }
    // A leg longer than a direct LoRa hop can reach is an MQTT interconnect stitching
    // regions together, not a radio hop — drawing it claims an impossible route.
    if (!pathWithinLoRaRange(points.map((p) => [p.lng, p.lat] as [number, number]))) {
      outOfRangeCount += 1;
      return;
    }
    raw.push({ key, label, propagationMs, points });
  };

  const isTrace = detail.header.payloadType === PayloadType.TRACE;
  // TRACE observations now resolve to the same hops as detail.resolvedRoute, so their per-observation
  // lines would just duplicate the single "Trace route" below — draw only that one for traces.
  if (!isTrace) {
    for (const obs of detail.observations) {
      // full chain: source → relay hops → destination; missing/unlocated hops drop out in pathPoints.
      const chain = packetChain(obs.resolvedSource, obs.resolvedPath, obs.resolvedDestination);
      add(
        obs.observerId,
        observerLabel(obs),
        obs.propagationTimeMs,
        pathPoints(chain),
        obs.pathLength.hashSize,
      );
    }
  }
  if (isTrace && detail.resolvedRoute) {
    // A trace route's width is the trace payload's own hash width. Prefer the
    // per-hop hashBytes when present (it is on RouteHop-derived trace hops),
    // gated on the narrowest hop; unknown width (null) skips the width gate
    // rather than guessing — range/point checks still apply. 1–2 byte trace
    // widths stay excluded like 1–2 byte OTA paths.
    const perHopWidths = detail.resolvedRoute
      .map((h) => (h.hashBytes != null ? h.hashBytes.length / 2 : null))
      .filter((w): w is number => w != null);
    const traceWidth: number | null =
      perHopWidths.length > 0
        ? Math.min(...perHopWidths)
        : detail.observations.length > 0
          ? Math.max(...detail.observations.map((o) => o.pathLength?.hashSize ?? 0))
          : null;
    add('trace', 'Trace route', undefined, pathPoints(detail.resolvedRoute), traceWidth);
  }

  // fastest first; missing propagation (incl. the trace route) sorts last
  raw.sort((a, b) => (a.propagationMs ?? Infinity) - (b.propagationMs ?? Infinity) || 0); // || 0: two Infinity props → NaN; keep insertion order
  const paths = raw.map((p, i) => ({ ...p, color: PATH_COLORS[i % PATH_COLORS.length]! }));

  // Report the dominant reason candidates were withheld (short-hash first: it is the
  // actionable one — "resend with wider hashes" — while range/unresolved are data facts).
  // Ordering inside `add` matters: unresolved <2-point candidates never reach the
  // width/range checks, so a bare 1-byte sighting with no located hops reports
  // 'unresolved' rather than 'short-hash'.
  const blockedCount = shortHashCount + outOfRangeCount + unresolvedCount;
  const blocked: PacketPathBlockInfo | null =
    paths.length > 0 || blockedCount === 0
      ? null
      : shortHashCount > 0
        ? { reason: 'short-hash', observedHashSize, count: blockedCount }
        : outOfRangeCount > 0
          ? { reason: 'out-of-range', observedHashSize, count: blockedCount }
          : { reason: 'unresolved', observedHashSize, count: blockedCount };
  return { paths, blocked };
}

export interface PathLineProps {
  key: string;
  color: string;
}

export interface PathNodeProps {
  key: string;
  color: string;
  label: string; // short label for the map (truncated id when unnamed)
  title: string; // untruncated name/id for the click popup
  endpoint: 'start' | 'end' | 'mid';
}

// Selection: null = every path ("All paths"); a key isolates that one path. Returns the line + node
// FeatureCollections to setData() and the coords to fitBounds over.
export function packetPathsToFeatures(
  paths: PacketPath[],
  selectedKey: string | null,
): {
  lines: FeatureCollection<LineString, PathLineProps>;
  points: FeatureCollection<Point, PathNodeProps>;
  bounds: [number, number][];
} {
  const shown = selectedKey ? paths.filter((p) => p.key === selectedKey) : paths;
  const lines: Feature<LineString, PathLineProps>[] = [];
  const points: Feature<Point, PathNodeProps>[] = [];
  const bounds: [number, number][] = [];

  for (const path of shown) {
    lines.push({
      type: 'Feature',
      properties: { key: path.key, color: path.color },
      geometry: { type: 'LineString', coordinates: path.points.map((p) => [p.lng, p.lat]) },
    });
    path.points.forEach((pt, i) => {
      const endpoint = i === 0 ? 'start' : i === path.points.length - 1 ? 'end' : 'mid';
      points.push({
        type: 'Feature',
        properties: {
          key: path.key,
          color: path.color,
          label: pt.name ?? pt.id.slice(0, 6),
          title: pt.name ?? pt.id,
          endpoint,
        },
        geometry: { type: 'Point', coordinates: [pt.lng, pt.lat] },
      });
      bounds.push([pt.lng, pt.lat]);
    });
  }

  return {
    lines: { type: 'FeatureCollection', features: lines },
    points: { type: 'FeatureCollection', features: points },
    bounds,
  };
}
