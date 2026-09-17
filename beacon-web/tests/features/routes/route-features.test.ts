import { describe, expect, it } from 'vitest';
import {
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
        neighbor: false,
      },
    ],
    totalCost: 1,
    hopCount: 1,
    hasUnmeasuredLegs: unmeasured,
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
  it('emits inactive routes first so the active route paints on top', () => {
    const r0 = route(undefined, true);
    const r1: PlannedRoute = {
      ...route(undefined, true),
      nodes: route(undefined, true).nodes.map((n) => ({ ...n, publicKey: `${n.publicKey}2` })),
      legs: [{ ...route(undefined, true).legs[0], from: 'aa2', to: 'bb2' }],
    };
    const { lines } = routesToFeatures([r0, r1], 0, palette);
    expect(lines.features.map((f) => f.properties.routeIndex)).toEqual([1, 0]);
    expect(lines.features[lines.features.length - 1].properties.active).toBe(true);
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
});
