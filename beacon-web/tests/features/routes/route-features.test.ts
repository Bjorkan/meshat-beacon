import { describe, expect, it } from 'vitest';
import {
  MESHCORE_3BYTE_MAX_HASHES,
  closestRoute,
  exportMeshcoreRoute,
  plannedRouteCoords,
  plannedRouteToMeshcore,
  routesToFeatures,
} from '../../../src/features/routes/route-features';
import { TRACE_SNR_FALLBACK, traceLegColor } from '../../../src/features/traces/trace-path';
import type { PlannedRoute, PlannedRouteLeg } from '../../../src/types/api';

const palette = TRACE_SNR_FALLBACK;

function route(snr: number | undefined, unmeasured: boolean): PlannedRoute {
  return {
    nodes: [
      {
        id: 'a',
        publicKey: 'aa',
        latitude: 59.6,
        longitude: 16.5,
        nodeType: 2,
        nodeTypeName: 'repeater',
        stale: false,
      },
      {
        id: 'b',
        publicKey: 'bb',
        latitude: 59.61,
        longitude: 16.52,
        nodeType: 2,
        nodeTypeName: 'repeater',
        stale: false,
      },
    ],
    legs: [
      {
        from: 'aa',
        to: 'bb',
        snr,
        snrSampleCount: snr == null ? 0 : 3,
        snrLastSeen: 1,
        observationCount: 3,
        unmeasured,
        unseen: false,
        neighbor: false,
      },
    ],
    totalCost: 1,
    hopCount: 1,
    hasUnmeasuredLegs: unmeasured,
    hasUnseenLegs: false,
    containsStaleNodes: false,
  };
}

describe('routesToFeatures stale SNR', () => {
  it('renders unmeasured legs with unknown styling even when a stale SNR is retained', () => {
    const { lines } = routesToFeatures([route(8.5, true)], 0, palette);
    expect(lines.features).toHaveLength(1);
    expect(lines.features[0].properties.snrColor).toBe(traceLegColor(null, palette));
    expect(lines.features[0].properties.label).not.toContain('dB');
  });

  it('renders measured legs with their SNR color and label', () => {
    const { lines } = routesToFeatures([route(8.5, false)], 0, palette);
    expect(lines.features).toHaveLength(1);
    expect(lines.features[0].properties.snrColor).toBe(traceLegColor(8.5, palette));
    expect(lines.features[0].properties.label).toContain('dB');
  });
});

describe('routesToFeatures active ordering', () => {
  it('frames all displayed nodes across alternatives, including nodes without a drawable leg', () => {
    const direct = route(8.5, false);
    const alternative: PlannedRoute = {
      ...route(undefined, true),
      nodes: [
        direct.nodes[0],
        { ...direct.nodes[0], publicKey: 'cc', longitude: 17, latitude: 60 },
        { ...direct.nodes[0], publicKey: 'dd', longitude: undefined, latitude: undefined },
        direct.nodes[1],
      ],
      legs: [],
    };
    for (const active of [0, 1]) {
      const { bounds } = routesToFeatures([direct, alternative], active, palette);
      expect(bounds).toContainEqual([16.5, 59.6]);
      expect(bounds).toContainEqual([16.52, 59.61]);
      expect(bounds).toContainEqual([17, 60]);
      expect(bounds.every((coordinate) => coordinate.every(Number.isFinite))).toBe(true);
    }
  });

  it('emits inactive routes first so the active route paints on top', () => {
    const r0 = route(undefined, true);
    const r1: PlannedRoute = {
      ...route(undefined, true),
      nodes: route(undefined, true).nodes.map((n) => ({ ...n, publicKey: `${n.publicKey}2` })),
      legs: [{ ...route(undefined, true).legs[0], from: 'aa2', to: 'bb2' }],
    };
    const { lines, points } = routesToFeatures([r0, r1], 0, palette);
    expect(lines.features.map((f) => f.properties.routeIndex)).toEqual([1, 0]);
    expect(lines.features[lines.features.length - 1].properties.active).toBe(true);
    // shared nodes keep the active color too: inactive points sort first so
    // the active point marker paints on top of its grey twin.
    expect(points.features[points.features.length - 1].properties.active).toBe(true);
  });
});

describe('plannedRouteCoords', () => {
  it('returns ordered drawable coords and skips unlocated nodes', () => {
    const r = route(undefined, true);
    const withUnlocated: PlannedRoute = {
      ...r,
      nodes: [
        r.nodes[0],
        { ...r.nodes[1], latitude: undefined, longitude: undefined },
        { ...r.nodes[0], publicKey: 'cc' },
      ],
    };
    expect(plannedRouteCoords(r)).toEqual([
      [16.5, 59.6],
      [16.52, 59.61],
    ]);
    // unlocated middle node skipped: flow rides start → end directly
    expect(plannedRouteCoords(withUnlocated)).toEqual([
      [16.5, 59.6],
      [16.5, 59.6],
    ]);
  });

  it('returns an empty path for a route without drawable nodes', () => {
    const r = route(undefined, true);
    const empty: PlannedRoute = { ...r, nodes: [] };
    expect(plannedRouteCoords(empty)).toEqual([]);
  });
});

const FULL_A = 'aa'.repeat(32);
const FULL_B = 'bb'.repeat(32);
const FULL_C = 'cc'.repeat(32);
const FULL_D = 'dd'.repeat(32);

function meshcoreLeg(from: string, to: string): PlannedRouteLeg {
  return {
    from,
    to,
    snrSampleCount: 0,
    snrLastSeen: 0,
    observationCount: 1,
    unmeasured: true,
    unseen: false,
    neighbor: false,
  };
}

function meshcoreRoute(keys: string[]): PlannedRoute {
  const legs = keys.slice(1).map((to, i) => meshcoreLeg(keys[i] as string, to));
  return {
    // nodes intentionally mirror the leg endpoints so the test proves legs
    // (not nodes) drive the export — no doubled start/target.
    nodes: keys.map((publicKey, i) => ({
      id: `n${i}`,
      publicKey,
      nodeType: 2,
      nodeTypeName: 'repeater',
      stale: false,
    })),
    legs,
    totalCost: legs.length,
    hopCount: legs.length,
    hasUnmeasuredLegs: true,
    hasUnseenLegs: false,
    containsStaleNodes: false,
  };
}

describe('plannedRouteToMeshcore', () => {
  it('exports A -> B as two 3-byte ids', () => {
    expect(plannedRouteToMeshcore(meshcoreRoute([FULL_A, FULL_B]))).toBe('aaaaaa,bbbbbb');
  });

  it('exports A -> B -> C -> D as four ordered 3-byte ids', () => {
    expect(plannedRouteToMeshcore(meshcoreRoute([FULL_A, FULL_B, FULL_C, FULL_D]))).toBe(
      'aaaaaa,bbbbbb,cccccc,dddddd',
    );
  });

  it('exports the documented example shape (start, middles, target)', () => {
    const start = '030680' + '00'.repeat(29);
    const m1 = 'ab6b92' + '11'.repeat(29);
    const m2 = '73f8a9' + '22'.repeat(29);
    const m3 = '65c1d1' + '33'.repeat(29);
    const target = 'b322cf' + '44'.repeat(29);
    expect(plannedRouteToMeshcore(meshcoreRoute([start, m1, m2, m3, target]))).toBe(
      '030680,ab6b92,73f8a9,65c1d1,b322cf',
    );
  });

  it('normalizes uppercase hex to lowercase without spaces', () => {
    expect(
      plannedRouteToMeshcore(meshcoreRoute([FULL_A.toUpperCase(), FULL_B.toUpperCase()])),
    ).toBe('aaaaaa,bbbbbb');
  });

  it('returns null for an empty route', () => {
    expect(plannedRouteToMeshcore(meshcoreRoute([FULL_A]))).toBeNull();
  });

  it('returns null instead of a partial route when a hop lacks a full public key', () => {
    expect(plannedRouteToMeshcore(meshcoreRoute([FULL_A, 'bbbbbb']))).toBeNull();
    expect(plannedRouteToMeshcore(meshcoreRoute(['aaaaaa', FULL_B]))).toBeNull();
    expect(plannedRouteToMeshcore(meshcoreRoute([FULL_A, FULL_B, 'zz']))).toBeNull();
  });

  it('rejects a discontinuous leg chain instead of exporting a broken route', () => {
    // A -> B, C -> D would naively export A,B,D — the exporter must refuse.
    const broken: PlannedRoute = {
      ...meshcoreRoute([FULL_A, FULL_B]),
      legs: [meshcoreLeg(FULL_A, FULL_B), meshcoreLeg(FULL_C, FULL_D)],
    };
    const res = exportMeshcoreRoute(broken);
    expect(res).toEqual({ ok: false, reason: 'discontinuous' });
    expect(plannedRouteToMeshcore(broken)).toBeNull();
  });

  it(`accepts exactly ${21} exported ids and rejects 22 (legs+1 semantics)`, () => {
    expect(MESHCORE_3BYTE_MAX_HASHES).toBe(21);
    const keys21 = Array.from({ length: 21 }, (_, i) => i.toString(16).padStart(2, '0').repeat(32));
    const ok21 = exportMeshcoreRoute(meshcoreRoute(keys21));
    expect(ok21.ok).toBe(true);
    if (ok21.ok) {
      // 21 legs would be 22 ids; here legs = 20 so ids = 21.
      expect(ok21.value.split(',')).toHaveLength(21);
    }
    const keys22 = [...keys21, 'ff'.repeat(32)];
    expect(exportMeshcoreRoute(meshcoreRoute(keys22))).toEqual({ ok: false, reason: 'too-long' });
    expect(plannedRouteToMeshcore(meshcoreRoute(keys22))).toBeNull();
  });
});

describe('closestRoute', () => {
  const active = {
    routeIndex: 0,
    active: true,
    points: [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ],
  };
  const alternative = {
    routeIndex: 1,
    active: false,
    points: [
      { x: 0, y: 12 },
      { x: 100, y: 12 },
    ],
  };
  it('selects the closest line even when the active route is drawn on top', () => {
    expect(closestRoute({ x: 50, y: 10 }, [active, alternative])).toBe(1);
    expect(closestRoute({ x: 50, y: 2 }, [alternative, active])).toBe(0);
  });
  it('allows switching alternatives on a shared segment', () => {
    expect(
      closestRoute({ x: 50, y: 0 }, [active, { ...active, routeIndex: 2, active: false }]),
    ).toBe(2);
  });
  it('measures distance to segment endpoints and handles colocated nodes', () => {
    const short = {
      routeIndex: 2,
      active: false,
      points: [
        { x: 0, y: 1 },
        { x: 1, y: 1 },
      ],
    };
    const colocated = {
      routeIndex: 3,
      active: false,
      points: [
        { x: 50, y: 10 },
        { x: 50, y: 10 },
      ],
    };
    expect(closestRoute({ x: 50, y: 1 }, [short, active])).toBe(0);
    expect(closestRoute({ x: 50, y: 10 }, [active, colocated])).toBe(3);
    expect(closestRoute({ x: 50, y: 10 }, [])).toBeNull();
  });
});

describe('route endpoint preview', () => {
  const from = { publicKey: 'aa', name: 'Alpha', lat: 59.6, lng: 16.5 };
  const to = { publicKey: 'bb', name: 'Beta', lat: 59.61, lng: 16.52 };
  it('shows either endpoint alone and both while waiting for a route, without connecting them', () => {
    for (const endpoints of [
      [from, null],
      [null, to],
      [from, to],
    ]) {
      const { points, lines, bounds } = routesToFeatures([], 0, palette, endpoints);
      expect(points.features.map((point) => point.properties.label)).toEqual(
        endpoints.filter(Boolean).map((node) => node!.name),
      );
      expect(lines.features).toHaveLength(0);
      expect(bounds).toEqual(endpoints.filter(Boolean).map((node) => [node!.lng, node!.lat]));
    }
    expect(
      routesToFeatures([], 0, palette, [null, to]).points.features[0].properties.endpoint,
    ).toBe('end');
  });
  it('removes cleared endpoints and replaces the preview when computed routes arrive', () => {
    expect(routesToFeatures([], 0, palette, [null, null]).points.features).toHaveLength(0);
    const { points, lines } = routesToFeatures([route(8.5, false)], 0, palette, [from, to]);
    expect(points.features).toHaveLength(2);
    expect(points.features.every((point) => point.properties.routeIndex === 0)).toBe(true);
    expect(lines.features).toHaveLength(1);
  });
});
