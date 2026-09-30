import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearNodeImageProvider,
  provideMissingStyleImage,
  setNodeImageProvider,
} from '../../../src/features/map/map-image-provider';

// Pins the MapLibre 6 missing-image dispatch contract (#101): the single per-map resolver
// installed by useMapLibre must send generated node ids to the provider mounted by useMapNodes
// (synchronously, before the requesting tiles parse) and stand in for every other id with a
// transparent placeholder, like the removed styleimagemissing listener did under MapLibre 5.
const fakeMap = () => {
  const added: Array<[string, unknown]> = [];
  const images = new Set<string>();
  return {
    hasImage: (id: string) => images.has(id),
    addImage: (id: string, image: unknown) => {
      added.push([id, image]);
      images.add(id);
    },
    added,
  };
};

describe('provideMissingStyleImage', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'ImageData',
      class {
        width = 1;
        height = 1;
      },
    );
  });

  it('dispatches generated node ids to the mounted provider and never adds a placeholder', () => {
    const map = fakeMap();
    const provider = vi.fn();
    setNodeImageProvider(provider);
    try {
      provideMissingStyleImage(map as never, 'node-cluster:3:1:1:0:1:0');
      provideMissingStyleImage(map as never, 'node-pill:repeater:0:ABCDEF');
      expect(provider).toHaveBeenCalledTimes(2);
      expect(provider).toHaveBeenNthCalledWith(1, 'node-cluster:3:1:1:0:1:0');
      expect(provider).toHaveBeenNthCalledWith(2, 'node-pill:repeater:0:ABCDEF');
      expect(map.added).toEqual([]);
    } finally {
      clearNodeImageProvider(provider);
    }
  });

  it('supplies a transparent placeholder for base-style sprite ids', () => {
    const map = fakeMap();
    const provider = vi.fn();
    setNodeImageProvider(provider);
    try {
      provideMissingStyleImage(map as never, 'circle-11');
      expect(provider).not.toHaveBeenCalled();
      expect(map.added).toHaveLength(1);
      expect(map.added[0]![0]).toBe('circle-11');
      expect((map.added[0]![1] as { width: number }).width).toBe(1);
      // A second request for the same id must not re-add it.
      provideMissingStyleImage(map as never, 'circle-11');
      expect(map.added).toHaveLength(1);
    } finally {
      clearNodeImageProvider(provider);
    }
  });

  it('keeps the registry identity-checked so a late cleanup cannot unregister its successor', () => {
    const first = vi.fn();
    const second = vi.fn();
    const map = fakeMap();
    setNodeImageProvider(first);
    clearNodeImageProvider(second); // wrong instance: no-op
    provideMissingStyleImage(map as never, 'node-pill:repeater:0:ABCDEF');
    expect(first).toHaveBeenCalledTimes(1);
    clearNodeImageProvider(first);
    provideMissingStyleImage(map as never, 'node-pill:repeater:0:ABCDEF');
    expect(first).toHaveBeenCalledTimes(1); // no provider left; MapLibre falls back to its warning
  });
});
