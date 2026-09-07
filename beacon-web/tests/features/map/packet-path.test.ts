import { describe, it, expect } from 'vitest';
import {
  buildPacketPaths,
  buildPacketPathResult,
  PATH_COLORS,
  packetPathsToFeatures,
  type PacketPath,
} from '../../../src/features/map/packet-path';
import type { Observation, PacketDetail, ResolvedHop } from '../../../src/types/api';
import { PayloadType } from '../../../src/types/enums';

// Fixture coords cluster around Västmanland (~1.6 km between neighbours) so every
// leg stays well inside the 150 km LoRa cap — range-gating is exercised by
// dedicated cases below, not by accident in the shared fixtures.
const A: [number, number] = [16.5, 59.6];
const B: [number, number] = [16.52, 59.61];
const C: [number, number] = [16.54, 59.62];
const D: [number, number] = [16.56, 59.63];
const E: [number, number] = [16.58, 59.64];
const F: [number, number] = [16.6, 59.65];
// ~430 km away: an MQTT-stitched hop, not a radio hop.
const FAR: [number, number] = [12.57, 55.68];

function hop(id: string, lng?: number, lat?: number): ResolvedHop {
  const nodes =
    lng != null && lat != null ? [{ id, publicKey: 'pk', longitude: lng, latitude: lat }] : [];
  return { confidence: nodes.length ? 'high' : 'none', nodes };
}

function obs(id: number, hops: ResolvedHop[], over: Partial<Observation> = {}): Observation {
  return {
    id,
    observerId: `observer-${id}`,
    iata: 'YYZ',
    heardAt: 0,
    pathLength: { raw: '', hashSize: 3, hopCount: hops.length },
    sourceBroker: 'b',
    resolvedPath: hops,
    ...over,
  } as Observation;
}

function detail(observations: Observation[], over: Partial<PacketDetail> = {}): PacketDetail {
  return {
    header: { payloadType: PayloadType.TEXT, routeType: 1 },
    observations,
    ...over,
  } as unknown as PacketDetail;
}

describe('buildPacketPaths', () => {
  it('keys each path by observerId and carries propagation, fastest first', () => {
    const d = detail([
      obs(1, [hop('a', ...A), hop('b', ...B)], {
        observerId: 'obs-slow',
        observerName: 'Slow',
        propagationTimeMs: 900,
      }),
      obs(2, [hop('c', ...C), hop('d', ...D)], {
        observerId: 'obs-fast',
        observerName: 'Fast',
        propagationTimeMs: 100,
      }),
    ]);
    const paths = buildPacketPaths(d);
    expect(paths.map((p) => p.key)).toEqual(['obs-fast', 'obs-slow']); // fastest first
    expect(paths[0]).toMatchObject({
      key: 'obs-fast',
      label: 'Fast',
      propagationMs: 100,
      color: PATH_COLORS[0],
    });
    expect(paths[1]).toMatchObject({ key: 'obs-slow', propagationMs: 900, color: PATH_COLORS[1] }); // colors follow sort order
  });

  it('sorts observations with missing propagation after timed ones', () => {
    const d = detail([
      obs(1, [hop('a', ...A), hop('b', ...B)], { observerId: 'obs-none' }), // no propagation
      obs(2, [hop('c', ...C), hop('d', ...D)], {
        observerId: 'obs-fast',
        propagationTimeMs: 50,
      }),
    ]);
    const keys = buildPacketPaths(d).map((p) => p.key);
    expect(keys[0]).toBe('obs-fast');
    expect(keys[keys.length - 1]).toBe('obs-none'); // missing propagation sorts last
  });

  it('prepends resolvedSource and appends resolvedDestination to the observation line', () => {
    const d = detail([
      obs(1, [hop('relay', ...B)], {
        observerId: 'obs-1',
        propagationTimeMs: 100,
        resolvedSource: hop('src', ...A),
        resolvedDestination: hop('dst', ...C),
      }),
    ]);
    const paths = buildPacketPaths(d);
    expect(paths).toHaveLength(1);
    expect(paths[0]!.points.map((p) => p.id)).toEqual(['src', 'relay', 'dst']);
  });

  it('draws a source->destination line for a directed message with no relay hops', () => {
    const d = detail([
      obs(1, [], {
        observerId: 'obs-1',
        propagationTimeMs: 50,
        resolvedSource: hop('src', ...A),
        resolvedDestination: hop('dst', ...B),
      }),
    ]);
    const paths = buildPacketPaths(d);
    expect(paths).toHaveLength(1);
    expect(paths[0]!.points.map((p) => p.id)).toEqual(['src', 'dst']);
  });

  it('dedupes a resolvedSource that matches the first relay hop', () => {
    const d = detail([
      obs(1, [hop('src', ...A), hop('relay', ...B)], {
        observerId: 'obs-1',
        propagationTimeMs: 100,
        resolvedSource: hop('src', ...A),
        resolvedDestination: hop('dst', ...C),
      }),
    ]);
    const [path] = buildPacketPaths(d);
    expect(path!.points.map((p) => p.id)).toEqual(['src', 'relay', 'dst']);
  });

  it('skips an unresolved endpoint rather than drawing a misleading line', () => {
    const d = detail([
      obs(1, [hop('relay1', ...A), hop('relay2', ...B)], {
        observerId: 'obs-1',
        propagationTimeMs: 100,
        resolvedSource: hop('src'), // unlocated — no coords
        resolvedDestination: hop('dst', ...C),
      }),
    ]);
    const [path] = buildPacketPaths(d);
    expect(path!.points.map((p) => p.id)).toEqual(['relay1', 'relay2', 'dst']);
  });

  it('skips an ambiguous endpoint instead of guessing one of its candidates', () => {
    // 1-byte source/dest prefixes resolve to several candidate nodes; the backend flags this
    // "ambiguous" so the client shouldn't pick one and draw it as a definitive endpoint.
    const ambiguousSource: ResolvedHop = {
      confidence: 'ambiguous',
      nodes: [
        { id: 'cand-a', publicKey: 'pa', longitude: C[0], latitude: C[1] },
        { id: 'cand-b', publicKey: 'pb', longitude: D[0], latitude: D[1] },
      ],
    };
    const d = detail([
      obs(1, [hop('relay1', ...A), hop('relay2', ...B)], {
        observerId: 'obs-1',
        propagationTimeMs: 100,
        resolvedSource: ambiguousSource,
        resolvedDestination: hop('dst', ...C), // high confidence — still drawn
      }),
    ]);
    const [path] = buildPacketPaths(d);
    expect(path!.points.map((p) => p.id)).toEqual(['relay1', 'relay2', 'dst']);
  });

  it('draws only the trace route for TRACE packets, suppressing per-observation lines', () => {
    const d = detail(
      [
        obs(1, [hop('a', ...A), hop('b', ...B)], {
          observerId: 'obs-1',
          propagationTimeMs: 100,
        }),
      ],
      {
        header: { payloadType: PayloadType.TRACE, routeType: 1 },
        resolvedRoute: [hop('e', ...E), hop('f', ...F)],
      } as unknown as Partial<PacketDetail>,
    );
    expect(buildPacketPaths(d).map((p) => p.key)).toEqual(['trace']);
  });

  it('draws nothing for a TRACE with no resolved route', () => {
    // per-observation lines are suppressed for TRACE, so without resolvedRoute there is nothing to draw
    const d = detail(
      [
        obs(1, [hop('a', ...A), hop('b', ...B)], {
          observerId: 'obs-1',
          propagationTimeMs: 100,
        }),
      ],
      {
        header: { payloadType: PayloadType.TRACE, routeType: 1 },
      } as unknown as Partial<PacketDetail>,
    );
    expect(buildPacketPaths(d)).toEqual([]);
  });

  it('uses the first located candidate for an ambiguous relay hop', () => {
    const multi: ResolvedHop = {
      confidence: 'ambiguous',
      nodes: [
        { id: 'unlocated', publicKey: 'p0' }, // no coords — skipped
        { id: 'located', publicKey: 'p1', longitude: B[0], latitude: B[1] }, // first with coords — used
      ],
    };
    const d = detail([
      obs(1, [multi, hop('relay2', ...C)], { observerId: 'obs-1', propagationTimeMs: 100 }),
    ]);
    const [path] = buildPacketPaths(d);
    expect(path!.points.map((p) => p.id)).toEqual(['located', 'relay2']);
  });

  it('omits observations that resolve to fewer than 2 located hops', () => {
    const d = detail([
      obs(1, [hop('a', ...A), hop('x')], { observerId: 'obs-1' }),
      obs(2, [hop('b', ...B), hop('c', ...C)], { observerId: 'obs-2' }),
    ]);
    expect(buildPacketPaths(d).map((p) => p.key)).toEqual(['obs-2']);
  });

  it('returns empty when nothing is drawable', () => {
    expect(buildPacketPaths(detail([obs(1, [hop('a', ...A)], { observerId: 'obs-1' })]))).toEqual(
      [],
    );
  });

  it('withholds a verifiable-looking 1-byte path that collides across nodes', () => {
    // The screenshot case: two located 1-byte hops draw a confident-looking line
    // that is physically impossible. Same nodes sent with 3-byte hashes draw fine.
    const oneByte = detail([
      obs(1, [hop('a', ...A), hop('b', ...C)], {
        observerId: 'obs-1',
        propagationTimeMs: 100,
        pathLength: { raw: '', hashSize: 1, hopCount: 2 },
      }),
    ]);
    expect(buildPacketPaths(oneByte)).toEqual([]);
    const { blocked } = buildPacketPathResult(oneByte);
    expect(blocked).toMatchObject({ reason: 'short-hash', observedHashSize: 1 });

    const threeByte = detail([
      obs(1, [hop('a', ...A), hop('b', ...C)], {
        observerId: 'obs-1',
        propagationTimeMs: 100,
        pathLength: { raw: '', hashSize: 3, hopCount: 2 },
      }),
    ]);
    expect(buildPacketPaths(threeByte)).toHaveLength(1);
    expect(buildPacketPathResult(threeByte).blocked).toBeNull();
  });

  it('draws a 2-byte route when the DB has no 2-byte collisions and hops are high-confidence', () => {
    const twoByte = (over: Partial<Observation> = {}) =>
      obs(1, [hop('a', ...A), hop('b', ...C)], {
        observerId: 'obs-1',
        propagationTimeMs: 100,
        pathLength: { raw: '', hashSize: 2, hopCount: 2 },
        pathBytes: 'a1b2c3d4',
        ...over,
      });
    // fail-closed without the collision set: cannot prove safety yet.
    // The open buttons stay fail-open (pure detail data) so they remain
    // clickable onto the modal's explanation; the modal itself withholds here.
    expect(buildPacketPaths(detail([twoByte()]))).toEqual([]);
    expect(buildPacketPathResult(detail([twoByte()])).blocked).toMatchObject({
      reason: 'ambiguous-hop',
    });
    // empty collision set + all hops high + air bytes present: draw
    const ok = buildPacketPathResult(detail([twoByte()]), { ambiguousPrefix2: [] });
    expect(ok.paths).toHaveLength(1);
    expect(ok.blocked).toBeNull();
  });

  it('withholds a 2-byte route when any hop is ambiguous', () => {
    const ambiguous: ResolvedHop = {
      confidence: 'ambiguous',
      nodes: [
        { id: 'x', publicKey: 'pa', longitude: A[0], latitude: A[1] },
        { id: 'y', publicKey: 'pb', longitude: B[0], latitude: B[1] },
      ],
    };
    const d = detail([
      obs(1, [ambiguous, hop('b', ...C)], {
        observerId: 'obs-1',
        propagationTimeMs: 100,
        pathLength: { raw: '', hashSize: 2, hopCount: 2 },
        pathBytes: 'a1b2c3d4',
      }),
    ]);
    expect(buildPacketPaths(d, { ambiguousPrefix2: [] })).toEqual([]);
    expect(buildPacketPathResult(d, { ambiguousPrefix2: [] }).blocked).toMatchObject({
      reason: 'ambiguous-hop',
    });
  });

  it('withholds a 2-byte route when an air prefix collides in the DB', () => {
    const d = detail([
      obs(1, [hop('a', ...A), hop('b', ...C)], {
        observerId: 'obs-1',
        propagationTimeMs: 100,
        pathLength: { raw: '', hashSize: 2, hopCount: 2 },
        pathBytes: 'a1b2c3d4',
      }),
    ]);
    // only the second hop's prefix collides — the whole route is still withheld
    const result = buildPacketPathResult(d, { ambiguousPrefix2: ['c3d4'] });
    expect(result.paths).toEqual([]);
    expect(result.blocked).toMatchObject({ reason: 'ambiguous-hop' });
  });

  it('withholds a 2-byte route when air bytes are missing', () => {
    const d = detail([
      obs(1, [hop('a', ...A), hop('b', ...C)], {
        observerId: 'obs-1',
        propagationTimeMs: 100,
        pathLength: { raw: '', hashSize: 2, hopCount: 2 },
        // no pathBytes: prefixes can't be checked, so withhold rather than guess
      }),
    ]);
    expect(buildPacketPathResult(d, { ambiguousPrefix2: [] }).blocked).toMatchObject({
      reason: 'ambiguous-hop',
    });
  });

  it('withholds a 3-byte path with an MQTT-stitched leg beyond LoRa range', () => {
    const d = detail([
      obs(1, [hop('a', ...A), hop('far', ...FAR)], {
        observerId: 'obs-1',
        propagationTimeMs: 100,
      }),
    ]);
    expect(buildPacketPaths(d)).toEqual([]);
    expect(buildPacketPathResult(d).blocked).toMatchObject({ reason: 'out-of-range' });
  });

  it('reports unresolved when nothing located enough hops', () => {
    const d = detail([obs(1, [hop('a', ...A)], { observerId: 'obs-1' })]);
    expect(buildPacketPathResult(d).blocked).toMatchObject({ reason: 'unresolved' });
  });

  it('reports no block when at least one path draws', () => {
    const d = detail([
      obs(1, [hop('solo', ...A)], { observerId: 'obs-solo' }),
      obs(2, [hop('b', ...B), hop('c', ...C)], { observerId: 'obs-ok' }),
    ]);
    const result = buildPacketPathResult(d);
    expect(result.paths.map((p) => p.key)).toEqual(['obs-ok']);
    expect(result.blocked).toBeNull();
  });
});

const P: PacketPath[] = [
  {
    key: '1',
    label: 'A',
    color: '#111',
    points: [
      { id: 'a', lng: -79, lat: 43 },
      { id: 'b', lng: -78, lat: 44 },
      { id: 'c', lng: -77, lat: 45 },
    ],
  },
  {
    key: '2',
    label: 'B',
    color: '#222',
    points: [
      { id: 'd', lng: -80, lat: 46 },
      { id: 'e', lng: -76, lat: 47 },
    ],
  },
];

describe('packetPathsToFeatures', () => {
  it('emits one line per path and one point per hop, with the path color', () => {
    const { lines, points, bounds } = packetPathsToFeatures(P, null);
    expect(lines.features).toHaveLength(2);
    expect(lines.features[0]!.properties).toEqual({ key: '1', color: '#111' });
    expect(lines.features[0]!.geometry.coordinates).toEqual([
      [-79, 43],
      [-78, 44],
      [-77, 45],
    ]);
    expect(points.features).toHaveLength(5);
    expect(bounds).toHaveLength(5);
  });

  it('marks first/last/middle hops as start/end/mid', () => {
    const { points } = packetPathsToFeatures([P[0]!], null);
    expect(points.features.map((f) => f.properties.endpoint)).toEqual(['start', 'mid', 'end']);
    expect(points.features[0]!.properties.label).toBe('a');
  });

  it('shows only the selected path when a key is given', () => {
    const { lines, points } = packetPathsToFeatures(P, '2');
    expect(lines.features.map((f) => f.properties.key)).toEqual(['2']);
    expect(points.features).toHaveLength(2);
  });

  it('carries the untruncated node identity as title', () => {
    const path: PacketPath = {
      key: 'k',
      label: 'L',
      color: '#111',
      points: [
        { id: 'abcdef123456', lng: -79, lat: 43 }, // no name -> title is the full id
        { id: 'z', name: 'Repeater North', lng: -78, lat: 44 }, // named -> title is the name
      ],
    };
    const { points } = packetPathsToFeatures([path], null);
    expect(points.features[0]!.properties.title).toBe('abcdef123456');
    expect(points.features[0]!.properties.label).toBe('abcdef'); // label stays truncated for the map
    expect(points.features[1]!.properties.title).toBe('Repeater North');
  });
});
