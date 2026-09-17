import { describe, expect, it } from 'vitest';
import { routesToFeatures } from '../../../src/features/routes/route-features';
import { TRACE_SNR_FALLBACK, traceLegColor } from '../../../src/features/traces/trace-path';
import type { PlannedRoute } from '../../../src/types/api';

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
