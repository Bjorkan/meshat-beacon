import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nodeMarkerId, rasterizeMapMarker } from '../../../src/features/map/marker-images';
import { clusterSegments } from '../../../src/features/map/cluster-style';

const ctx = {
  scale: vi.fn(),
  beginPath: vi.fn(),
  arc: vi.fn(),
  roundRect: vi.fn(),
  moveTo: vi.fn(),
  quadraticCurveTo: vi.fn(),
  fill: vi.fn(),
  stroke: vi.fn(),
  fillText: vi.fn(),
  getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(), width: 1, height: 1 })),
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    ctx as unknown as CanvasRenderingContext2D,
  );
});
afterEach(() => vi.restoreAllMocks());

describe('proportional cluster contours', () => {
  it('assigns half and two quarters, with contiguous segments that cover the entire circle', () => {
    const segments = clusterSegments([0, 0, 20, 10, 10]);
    expect(segments.map(({ start, end }) => end - start)).toEqual([0.5, 0.25, 0.25]);
    expect(segments[0]!.start).toBe(0);
    expect(segments.at(-1)!.end).toBe(1);
    for (let index = 1; index < segments.length; index++)
      expect(segments[index]!.start).toBe(segments[index - 1]!.end);
  });

  it('keeps a single category at 100% and does not exaggerate a tiny minority', () => {
    expect(clusterSegments([0, 3, 0, 0, 0])).toMatchObject([{ count: 3, start: 0, end: 1 }]);
    const segments = clusterSegments([999, 0, 0, 1, 0]);
    expect(segments[0]!.end).toBe(0.999);
    expect(segments[1]!.end - segments[1]!.start).toBeCloseTo(0.001);
  });

  it('draws the exact total and rejects inconsistent or malformed distributions', () => {
    expect(rasterizeMapMarker('node-cluster:40:20:10:0:10:0', 2)).not.toBeNull();
    expect(ctx.fillText).toHaveBeenCalledWith(
      '40',
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
    );
    // First arc is the face. The next three are the proportional ring segments.
    expect(ctx.arc.mock.calls.slice(1, 4).map((args) => args[4] - args[3])).toEqual([
      Math.PI,
      Math.PI / 2,
      Math.PI / 2,
    ]);
    expect(rasterizeMapMarker('node-cluster:40:20:10:0:11:0', 2)).toBeNull();
    expect(rasterizeMapMarker('node-cluster:2:-1:3:0:0:0', 2)).toBeNull();
    expect(rasterizeMapMarker('node-cluster:2:NaN:2:0:0:0', 2)).toBeNull();
  });
});

describe('node capsules', () => {
  it('uses only the first three public-key bytes and draws an eye only for observers', () => {
    const key = '5c0680abcdef'.padEnd(64, '0');
    const normal = nodeMarkerId(key, 'repeater', false);
    expect(normal).toBe('node-pill:repeater:0:5C0680');
    rasterizeMapMarker(normal, 2);
    expect(ctx.fillText.mock.calls[0]![0]).toBe('5C0680');
    expect(ctx.quadraticCurveTo).not.toHaveBeenCalled();
    rasterizeMapMarker(nodeMarkerId(key, 'repeater', true), 2);
    expect(ctx.quadraticCurveTo).toHaveBeenCalledTimes(2);
    expect(ctx.fillText.mock.calls[1]![0]).toBe('5C0680');
  });

  it('retains the same content when selected and supports unknown categories', () => {
    const id = nodeMarkerId('ABCDEF012345', 'future-device', false);
    expect(rasterizeMapMarker(`${id}:selected`, 3)).not.toBeNull();
    expect(ctx.fillText.mock.calls[0]![0]).toBe('ABCDEF');
    expect(rasterizeMapMarker('basemap-icon', 2)).toBeNull();
  });
});
