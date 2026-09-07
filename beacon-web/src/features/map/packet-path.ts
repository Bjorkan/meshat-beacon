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
// unambiguous. 3+ byte routes always draw (same bar as the backend's neighbor
// rule in packet.go). 2-byte routes draw only when the database has zero
// 2-byte collisions globally AND every hop on the route resolved
// high-confidence — see buildPacketPathResult's ambiguousPrefix2 param.
// 1-byte prefixes collide too widely to ever verify, so they never draw.
export const MIN_PATH_HASH_BYTES = 3;
export const MIN_VERIFIABLE_HASH_BYTES = 2;

export type PacketPathBlockReason = 'short-hash' | 'ambiguous-hop' | 'out-of-range' | 'unresolved';

export interface PacketPathBlockInfo {
  reason: PacketPathBlockReason;
  observedHashSize: number; // the best (widest) hashSize seen on this packet, e.g. 1
  count: number; // how many drawable candidates were held back
}

// Options that refine the width gate. ambiguousPrefix2 is the server's global
// 2-byte collision set (lowercase hex, e.g. "a3f1") from
// GET /nodes/ambiguous-prefix2 — omit it and 2-byte routes stay withheld,
// so a slow/failed fetch can never draw an unverified route.
export interface PacketPathOptions {
  ambiguousPrefix2?: string[] | null;
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

// The exact 2-byte prefixes that were on the air for one observation, lowercased
// hex, or null when the bytes are missing/malformed. This is what a collision
// would actually confuse — resolved hops don't carry per-hop prefixes here.
function pathBytePrefixes(pathBytes: string | undefined, hashSize: number): string[] | null {
  if (pathBytes == null || pathBytes.length % (hashSize * 2) !== 0) return null;
  if (!/^[0-9a-fA-F]*$/.test(pathBytes)) return null;
  const out: string[] = [];
  for (let i = 0; i < pathBytes.length; i += hashSize * 2) {
    out.push(pathBytes.slice(i, i + hashSize * 2).toLowerCase());
  }
  return out;
}

// One verifierbar path per observation (and the trace route for TRACE packets): the route
// must be sent with >=2-byte hashes, resolve to >=2 located hops, and have every leg within
// direct LoRa range. 3+ byte widths always draw; 2-byte widths draw only when the database
// has zero 2-byte collisions globally AND every hop on the route resolved high-confidence
// (no ambiguous hop anywhere on it). Anything else is withheld so the map can never draw a
// physically impossible route from colliding prefixes or an MQTT-stitched hop. Colors are
// assigned after sorting so the selector swatch matches the drawn line.
export function buildPacketPaths(detail: PacketDetail, options?: PacketPathOptions): PacketPath[] {
  return buildPacketPathResult(detail, options).paths;
}

// Same as buildPacketPaths, but also reports why candidates were withheld so the
// modal can explain instead of just showing an empty map. observedHashSize is the
// widest hashSize seen anywhere on this packet (used for the short-hash message).
export function buildPacketPathResult(
  detail: PacketDetail,
  options?: PacketPathOptions,
): {
  paths: PacketPath[];
  blocked: PacketPathBlockInfo | null;
} {
  const raw: Omit<PacketPath, 'color'>[] = [];
  let shortHashCount = 0;
  let ambiguousHopCount = 0;
  let outOfRangeCount = 0;
  let unresolvedCount = 0;
  let observedHashSize = 0;
  // Fail-closed: without the server's collision set we cannot prove a 2-byte route
  // safe, so 2-byte candidates stay withheld until the fetch resolves.
  const ambiguousPrefix2 =
    options?.ambiguousPrefix2 == null ? null : new Set(options.ambiguousPrefix2);
  const add = (
    key: string,
    label: string,
    propagationMs: number | undefined,
    chain: ResolvedHop[],
    hashSize: number | null,
    pathBytes?: string,
  ) => {
    if (hashSize != null) observedHashSize = Math.max(observedHashSize, hashSize);
    const points = pathPoints(chain);
    // Not enough located hops to draw a line at all.
    if (points.length < 2) {
      unresolvedCount += 1;
      return;
    }
    // 1-byte prefixes collide too widely to ever verify.
    // Unknown width (null) skips this gate — we don't claim a width we can't verify.
    if (hashSize != null && hashSize < MIN_VERIFIABLE_HASH_BYTES) {
      shortHashCount += 1;
      return;
    }
    // 2-byte routes need both halves of the proof: zero collisions for every prefix
    // on this route in the whole database, and no ambiguous hop anywhere on it.
    // The prefix check keys off the observation's own pathBytes (the exact bytes
    // that were on the air), not the resolved hop's hashBytes — resolved hops
    // don't carry per-hop prefixes on this path, and the air bytes are what a
    // collision would actually confuse.
    if (hashSize === MIN_VERIFIABLE_HASH_BYTES) {
      const airPrefixes = pathBytePrefixes(pathBytes, hashSize);
      const hitsCollisionSet =
        ambiguousPrefix2 == null ||
        airPrefixes == null ||
        airPrefixes.some((p) => ambiguousPrefix2.has(p));
      const hasAmbiguousHop = chain.some((h) => h.confidence !== 'high');
      if (hitsCollisionSet || hasAmbiguousHop) {
        ambiguousHopCount += 1;
        return;
      }
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
        chain,
        obs.pathLength.hashSize,
        obs.pathBytes,
      );
    }
  }
  if (isTrace && detail.resolvedRoute) {
    // A trace route's width is the trace payload's own hash width. Prefer the
    // per-hop hashBytes when present (it is on RouteHop-derived trace hops),
    // gated on the narrowest hop; unknown width (null) skips the width gate
    // rather than guessing — confidence/range/point checks still apply.
    // 2-byte trace widths need the same collision-free proof as OTA paths; the
    // air bytes come from the first observation carrying them.
    const perHopWidths = detail.resolvedRoute
      .map((h) => (h.hashBytes != null ? h.hashBytes.length / 2 : null))
      .filter((w): w is number => w != null);
    const traceWidth: number | null =
      perHopWidths.length > 0
        ? Math.min(...perHopWidths)
        : detail.observations.length > 0
          ? Math.max(...detail.observations.map((o) => o.pathLength?.hashSize ?? 0))
          : null;
    const tracePathBytes = detail.observations.find((o) => o.pathBytes != null)?.pathBytes;
    add('trace', 'Trace route', undefined, detail.resolvedRoute, traceWidth, tracePathBytes);
  }

  // fastest first; missing propagation (incl. the trace route) sorts last
  raw.sort((a, b) => (a.propagationMs ?? Infinity) - (b.propagationMs ?? Infinity) || 0); // || 0: two Infinity props → NaN; keep insertion order
  const paths = raw.map((p, i) => ({ ...p, color: PATH_COLORS[i % PATH_COLORS.length]! }));

  // Report the dominant reason candidates were withheld (short-hash first: it is the
  // actionable one — "resend with wider hashes" — while range/unresolved are data facts).
  // Ordering inside `add` matters: unresolved <2-point candidates never reach the
  // width/range checks, so a bare 1-byte sighting with no located hops reports
  // 'unresolved' rather than 'short-hash'.
  const blockedCount = shortHashCount + ambiguousHopCount + outOfRangeCount + unresolvedCount;
  const blocked: PacketPathBlockInfo | null =
    paths.length > 0 || blockedCount === 0
      ? null
      : shortHashCount > 0
        ? { reason: 'short-hash', observedHashSize, count: blockedCount }
        : ambiguousHopCount > 0
          ? { reason: 'ambiguous-hop', observedHashSize, count: blockedCount }
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
