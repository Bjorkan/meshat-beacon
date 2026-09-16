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

// Trace-hashar på tråden är minst 2 byte i praktiken (1-byte-prefix kolliderar för
// brett för att någonsin verifieras — samma bar som Paketsökvägens
// MIN_VERIFIABLE_HASH_BYTES). Fixturerna använder därför 2-byte-hashar rakt igenom;
// 1-byte-fallet täcks av det dedikerade short-hash-testet nedan.
const H = (lo: string) => `${lo}${lo}`;

describe('buildTracePaths', () => {
  it('builds one path per drawable packet with per-leg SNR from the entering hop', () => {
    const { paths, blocked } = buildTracePaths(
      [
        pkt('aaa', {
          rawPath: [{ hash: H('aa') }, { hash: H('bb'), snr: 3.5 }, { hash: H('cc'), snr: -7.5 }],
          resolvedRoute: [located('a', A, 'Alpha'), located('b', B, 'Bravo'), located('c', C, 'C')],
        }),
      ],
      { ambiguousPrefix2: [] },
    );
    expect(blocked).toBeNull();
    expect(paths).toHaveLength(1);
    expect(paths[0]).toMatchObject({ key: 'aaa', label: 'AAA' });
    expect(paths[0]!.points.map((p) => p.id)).toEqual(['a', 'b', 'c']);
    // SNR[0] has no upstream link: the first leg carries SNR[1], the second SNR[2].
    expect(paths[0]!.legs.map((l) => l.snr)).toEqual([3.5, -7.5]);
  });

  it('skips SNR[0]: a dangling first-hop reading never colors a leg', () => {
    const { paths } = buildTracePaths(
      [
        pkt('aaa', {
          rawPath: [{ hash: H('aa'), snr: 99 }, { hash: H('bb') }],
          resolvedRoute: [located('a', A), located('b', B)],
        }),
      ],
      { ambiguousPrefix2: [] },
    );
    expect(paths[0]!.legs).toHaveLength(1);
    expect(paths[0]!.legs[0]!.snr).toBeNull();
  });

  it('withholds the whole packet when a hop is unlocated', () => {
    const { paths, blocked } = buildTracePaths(
      [
        pkt('aaa', {
          rawPath: [{ hash: H('aa') }, { hash: H('bb') }, { hash: H('cc') }, { hash: H('dd') }],
          resolvedRoute: [
            located('a', A),
            { confidence: 'none', nodes: [] },
            located('c', B),
            located('d', C),
          ],
        }),
      ],
      { ambiguousPrefix2: [] },
    );
    // INGEN del ritas om NÅGON del saknar säker matchning — samma spärr som Paketsökvägen
    expect(paths).toEqual([]);
    expect(blocked).toMatchObject({ reason: 'ambiguous-hop' });
  });

  it('withholds the whole packet when any hop is ambiguous', () => {
    const { paths, blocked } = buildTracePaths(
      [
        pkt('aaa', {
          rawPath: [{ hash: H('aa') }, { hash: H('bb') }],
          resolvedRoute: [
            located('a', A),
            {
              confidence: 'ambiguous',
              nodes: [{ id: 'b', publicKey: 'pk', longitude: B[0], latitude: B[1] }],
            },
          ],
        }),
      ],
      { ambiguousPrefix2: [] },
    );
    // INGEN del ritas om NÅGON del är tvetydig — samma spärr som Paketsökvägen
    expect(paths).toEqual([]);
    expect(blocked).toMatchObject({ reason: 'ambiguous-hop' });
  });

  it('withholds 1-byte hashes entirely (same bar as the packet path map)', () => {
    const { paths, blocked } = buildTracePaths([
      pkt('aaa', {
        rawPath: [{ hash: 'aa' }, { hash: 'bb' }],
        resolvedRoute: [located('a', A), located('b', B)],
      }),
    ]);
    expect(paths).toEqual([]);
    expect(blocked).toMatchObject({ reason: 'short-hash', observedHashSize: 1 });
  });

  it('withholds a 2-byte route that hits the global collision set', () => {
    const { paths, blocked } = buildTracePaths(
      [
        pkt('aaa', {
          rawPath: [{ hash: 'aabb' }, { hash: 'ccdd' }],
          resolvedRoute: [located('a', A), located('b', B)],
        }),
      ],
      { ambiguousPrefix2: ['ccdd'] },
    );
    expect(paths).toEqual([]);
    expect(blocked).toMatchObject({ reason: 'ambiguous-hop' });
  });

  it('draws a collision-free 2-byte route with high-confidence hops', () => {
    const { paths, blocked } = buildTracePaths(
      [
        pkt('aaa', {
          rawPath: [{ hash: 'aabb' }, { hash: 'ccdd' }],
          resolvedRoute: [located('a', A), located('b', B)],
        }),
      ],
      { ambiguousPrefix2: [] },
    );
    expect(blocked).toBeNull();
    expect(paths).toHaveLength(1);
  });

  it('fails closed while the collision set is still loading', () => {
    const { paths, blocked } = buildTracePaths([
      pkt('aaa', {
        rawPath: [{ hash: 'aabb' }, { hash: 'ccdd' }],
        resolvedRoute: [located('a', A), located('b', B)],
      }),
    ]);
    expect(paths).toEqual([]);
    expect(blocked).toMatchObject({ reason: 'ambiguous-hop' });
  });

  it('withholds an MQTT-stitched route with an impossible leg', () => {
    const { paths, blocked } = buildTracePaths(
      [
        pkt('aaa', {
          rawPath: [{ hash: H('aa') }, { hash: H('bb') }],
          resolvedRoute: [located('a', A), located('far', FAR)],
        }),
      ],
      { ambiguousPrefix2: [] },
    );
    expect(paths).toEqual([]);
    expect(blocked).toMatchObject({ reason: 'out-of-range' });
  });

  it('reports unresolved when nothing located enough hops', () => {
    const { paths, blocked } = buildTracePaths([pkt('aaa')]);
    expect(paths).toEqual([]);
    expect(blocked).toMatchObject({ reason: 'unresolved' });
  });

  it('reports no block when at least one packet draws', () => {
    const { paths, blocked } = buildTracePaths(
      [
        pkt('solo'),
        pkt('ok', {
          rawPath: [{ hash: H('aa') }, { hash: H('bb') }],
          resolvedRoute: [located('a', A), located('b', B)],
        }),
      ],
      { ambiguousPrefix2: [] },
    );
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
  it('emits one line per leg with its own SNR color and one point per hop (isolated packet)', () => {
    const { paths } = buildTracePaths(
      [
        pkt('aaa', {
          rawPath: [{ hash: H('aa') }, { hash: H('bb'), snr: 6 }, { hash: H('cc') }],
          resolvedRoute: [located('a', A, 'Alpha'), located('b', B, 'Bravo'), located('c', C, 'C')],
        }),
      ],
      { ambiguousPrefix2: [] },
    );
    const { lines, points, bounds } = tracePathsToFeatures(paths, 'aaa');
    expect(lines.features).toHaveLength(2);
    expect(lines.features[0]!.properties.snrColor).toBe(TRACE_SNR_FALLBACK.green);
    expect(lines.features[1]!.properties.snrColor).toBe(TRACE_SNR_FALLBACK.noSnr);
    expect(lines.features[0]!.properties.label).toMatch(/Alpha → Bravo · 6\.00 dB/);
    expect(points.features).toHaveLength(3);
    expect(points.features.map((f) => f.properties.endpoint)).toEqual(['start', 'mid', 'end']);
    expect(bounds).toHaveLength(3);
  });

  it('isolates a single packet when a key is given', () => {
    const { paths } = buildTracePaths(
      [
        pkt('aaa', {
          rawPath: [{ hash: H('aa') }, { hash: H('bb') }],
          resolvedRoute: [located('a', A), located('b', B)],
        }),
        pkt('bbb', {
          rawPath: [{ hash: H('cc') }, { hash: H('dd') }],
          resolvedRoute: [located('c', B), located('d', C)],
        }),
      ],
      { ambiguousPrefix2: [] },
    );
    const { lines, points } = tracePathsToFeatures(paths, 'bbb');
    expect(lines.features.map((f) => f.properties.key)).toEqual(['bbb']);
    expect(points.features).toHaveLength(2);
  });
});

describe('tracePathsToFeatures aggregate (Alla sökvägar)', () => {
  const routeAB = [located('a', A, 'Alpha'), located('b', B, 'Bravo')];
  const packetWithSnr = (hash: string, snr: number | undefined) =>
    pkt(hash, {
      rawPath: [
        { hash: H('aa') },
        ...(snr === undefined ? [{ hash: H('bb') }] : [{ hash: H('bb'), snr }]),
      ],
      resolvedRoute: routeAB,
    });
  const buildAll = (packets: TracePacket[]) =>
    buildTracePaths(packets, { ambiguousPrefix2: [] }).paths;

  it('averages only the legs that have a value; blue when none has one', () => {
    const paths = buildAll([
      packetWithSnr('p1', 9.0),
      packetWithSnr('p2', 11.0),
      packetWithSnr('p3', undefined),
    ]);
    const { lines } = tracePathsToFeatures(paths, null);
    expect(lines.features).toHaveLength(1);
    const props = lines.features[0]!.properties;
    // (9 + 11) / 2 — the packet without a reading is ignored, not counted as zero
    expect(props.snr).toBeCloseTo(10, 10);
    expect(props.snrSamples).toBe(2);
    expect(props.snrSpread).toBeCloseTo(2, 10);
    expect(props.snrColor).toBe(TRACE_SNR_FALLBACK.green);
    expect(props.key).toBe('all');
  });

  it('falls back to blue when no packet measured the leg', () => {
    const paths = buildAll([packetWithSnr('p1', undefined), packetWithSnr('p2', undefined)]);
    const { lines } = tracePathsToFeatures(paths, null);
    expect(lines.features).toHaveLength(1);
    const props = lines.features[0]!.properties;
    expect(props.snr).toBeNull();
    expect(props.snrSamples).toBe(0);
    expect(props.snrColor).toBe(TRACE_SNR_FALLBACK.noSnr);
    expect(props.label).toBe('Alpha → Bravo');
  });

  it('keeps directed pairs apart (A→B ≠ B→A)', () => {
    const paths = buildAll([
      pkt('p1', {
        rawPath: [{ hash: H('aa') }, { hash: H('bb'), snr: 6 }],
        resolvedRoute: [located('a', A, 'Alpha'), located('b', B, 'Bravo')],
      }),
      pkt('p2', {
        rawPath: [{ hash: H('bb') }, { hash: H('aa'), snr: -10 }],
        resolvedRoute: [located('b', B, 'Bravo'), located('a', A, 'Alpha')],
      }),
    ]);
    const { lines } = tracePathsToFeatures(paths, null);
    expect(lines.features).toHaveLength(2);
    const colors = lines.features.map((f) => f.properties.snrColor).sort();
    expect(colors).toEqual([TRACE_SNR_FALLBACK.danger, TRACE_SNR_FALLBACK.green].sort());
  });

  it('labels a unanimous single-sample leg without packet count', () => {
    const paths = buildAll([packetWithSnr('p1', 6)]);
    const { lines } = tracePathsToFeatures(paths, null);
    expect(lines.features[0]!.properties.label).toBe('Alpha → Bravo · 6.00 dB');
  });
});
