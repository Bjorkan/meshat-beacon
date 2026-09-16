import { describe, expect, it } from 'vitest';
import {
  buildTracePaths,
  traceLegColor,
  tracePathsToFeatures,
  TRACE_SNR_FALLBACK,
} from '../../../src/features/traces/trace-path';
import type { TracePacket } from '../../../src/types/api';

// Fixture coords cluster around Västmanland (~1.6 km between neighbours) so every
// leg stays well inside the 150 km LoRa cap — range-gating is exercised by
// dedicated cases below, not by accident in the shared fixtures.
const A: [number, number] = [16.5, 59.6];
const B: [number, number] = [16.52, 59.61];
const C: [number, number] = [16.54, 59.62];
// ~430 km away: an MQTT-stitched hop, not a radio hop.
const FAR: [number, number] = [12.57, 55.68];

function pkt(packetHash: string, over: Partial<TracePacket> = {}): TracePacket {
  return {
    packetHash,
    routeType: 1,
    routeTypeName: 'DIRECT',
    firstHeardAt: 1,
    lastHeardAt: 2,
    rawPath: [],
    resolvedRoute: [],
    ...over,
  };
}

const located = (id: string, [lng, lat]: [number, number], name?: string) => ({
  confidence: 'high' as const,
  nodes: [{ id, publicKey: 'pk', longitude: lng, latitude: lat, ...(name ? { name } : {}) }],
});

describe('buildTracePaths', () => {
  it('builds one path per drawable packet with per-leg SNR from the entering hop', () => {
    const { paths, blocked } = buildTracePaths([
      pkt('aaa', {
        rawPath: [{ hash: 'aa' }, { hash: 'bb', snr: 3.5 }, { hash: 'cc', snr: -7.5 }],
        resolvedRoute: [located('a', A, 'Alpha'), located('b', B, 'Bravo'), located('c', C, 'C')],
      }),
    ]);
    expect(blocked).toBeNull();
    expect(paths).toHaveLength(1);
    expect(paths[0]).toMatchObject({ key: 'aaa', label: 'AAA' });
    expect(paths[0]!.points.map((p) => p.id)).toEqual(['a', 'b', 'c']);
    // SNR[0] has no upstream link: the first leg carries SNR[1], the second SNR[2].
    expect(paths[0]!.legs.map((l) => l.snr)).toEqual([3.5, -7.5]);
  });

  it('skips SNR[0]: a dangling first-hop reading never colors a leg', () => {
    const { paths } = buildTracePaths([
      pkt('aaa', {
        rawPath: [{ hash: 'aa', snr: 99 }, { hash: 'bb' }],
        resolvedRoute: [located('a', A), located('b', B)],
      }),
    ]);
    expect(paths[0]!.legs).toHaveLength(1);
    expect(paths[0]!.legs[0]!.snr).toBeNull();
  });

  it('breaks the line at unlocated hops instead of drawing a guessed leg', () => {
    const { paths } = buildTracePaths([
      pkt('aaa', {
        rawPath: [{ hash: 'aa' }, { hash: 'bb' }, { hash: 'cc' }, { hash: 'dd' }],
        resolvedRoute: [
          located('a', A),
          { confidence: 'none', nodes: [] },
          located('c', B),
          located('d', C),
        ],
      }),
    ]);
    // a→? withheld, ?→c withheld (no coords to start from), only c→d draws
    expect(paths[0]!.legs).toHaveLength(1);
    expect(paths[0]!.legs[0]).toMatchObject({ from: { id: 'c' }, to: { id: 'd' } });
  });

  it('marks legs touching an ambiguous hop so the map can dash them', () => {
    const { paths } = buildTracePaths([
      pkt('aaa', {
        rawPath: [{ hash: 'aa' }, { hash: 'bb' }],
        resolvedRoute: [
          located('a', A),
          {
            confidence: 'ambiguous',
            nodes: [{ id: 'b', publicKey: 'pk', longitude: B[0], latitude: B[1] }],
          },
        ],
      }),
    ]);
    expect(paths[0]!.legs[0]!.ambiguous).toBe(true);
  });

  it('withholds an MQTT-stitched route with an impossible leg', () => {
    const { paths, blocked } = buildTracePaths([
      pkt('aaa', {
        rawPath: [{ hash: 'aa' }, { hash: 'bb' }],
        resolvedRoute: [located('a', A), located('far', FAR)],
      }),
    ]);
    expect(paths).toEqual([]);
    expect(blocked).toMatchObject({ reason: 'out-of-range' });
  });

  it('reports unresolved when nothing located enough hops', () => {
    const { paths, blocked } = buildTracePaths([pkt('aaa')]);
    expect(paths).toEqual([]);
    expect(blocked).toMatchObject({ reason: 'unresolved' });
  });

  it('reports no block when at least one packet draws', () => {
    const { paths, blocked } = buildTracePaths([
      pkt('solo'),
      pkt('ok', {
        rawPath: [{ hash: 'aa' }, { hash: 'bb' }],
        resolvedRoute: [located('a', A), located('b', B)],
      }),
    ]);
    expect(paths.map((p) => p.key)).toEqual(['ok']);
    expect(blocked).toBeNull();
  });
});

describe('traceLegColor', () => {
  it('uses the neighbor SNR scale with the blue no-measurement fallback', () => {
    expect(traceLegColor(5, TRACE_SNR_FALLBACK)).toBe(TRACE_SNR_FALLBACK.green);
    expect(traceLegColor(-5, TRACE_SNR_FALLBACK)).toBe(TRACE_SNR_FALLBACK.warn);
    expect(traceLegColor(-15, TRACE_SNR_FALLBACK)).toBe(TRACE_SNR_FALLBACK.danger);
    expect(traceLegColor(null, TRACE_SNR_FALLBACK)).toBe(TRACE_SNR_FALLBACK.noSnr);
  });
});

describe('tracePathsToFeatures', () => {
  it('emits one line per leg with its own SNR color and one point per hop', () => {
    const { paths } = buildTracePaths([
      pkt('aaa', {
        rawPath: [{ hash: 'aa' }, { hash: 'bb', snr: 6 }, { hash: 'cc' }],
        resolvedRoute: [located('a', A, 'Alpha'), located('b', B, 'Bravo'), located('c', C, 'C')],
      }),
    ]);
    const { lines, points, bounds } = tracePathsToFeatures(paths, null);
    expect(lines.features).toHaveLength(2);
    expect(lines.features[0]!.properties.snrColor).toBe(TRACE_SNR_FALLBACK.green);
    expect(lines.features[1]!.properties.snrColor).toBe(TRACE_SNR_FALLBACK.noSnr);
    expect(lines.features[0]!.properties.label).toMatch(/Alpha → Bravo · 6\.00 dB/);
    expect(points.features).toHaveLength(3);
    expect(points.features.map((f) => f.properties.endpoint)).toEqual(['start', 'mid', 'end']);
    expect(bounds).toHaveLength(3);
  });

  it('isolates a single packet when a key is given', () => {
    const { paths } = buildTracePaths([
      pkt('aaa', {
        rawPath: [{ hash: 'aa' }, { hash: 'bb' }],
        resolvedRoute: [located('a', A), located('b', B)],
      }),
      pkt('bbb', {
        rawPath: [{ hash: 'cc' }, { hash: 'dd' }],
        resolvedRoute: [located('c', B), located('d', C)],
      }),
    ]);
    const { lines, points } = tracePathsToFeatures(paths, 'bbb');
    expect(lines.features.map((f) => f.properties.key)).toEqual(['bbb']);
    expect(points.features).toHaveLength(2);
  });
});
