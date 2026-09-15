import { renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { createExpression } from '@maplibre/maplibre-gl-style-spec';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { useMapNeighborHighlight } from '../../../src/features/map/useMapNeighborHighlight';
import {
  FOCUSED_NEIGHBORS_LAYER_ID,
  NEIGHBORS_LINE_LAYER_ID,
} from '../../../src/features/map/types';

it('emphasizes only the focused endpoint and its edge, using paint changes and restoring on leave', () => {
  const paints = new Map<string, unknown>();
  const map = {
    getLayer: () => ({}),
    setPaintProperty: vi.fn((layer: string, prop: string, expression: unknown) =>
      paints.set(`${layer}:${prop}`, expression),
    ),
    addSource: vi.fn(),
    getSource: vi.fn(),
  };
  const mapRef = { current: map as unknown as MapLibreMap };
  const points = { type: 'FeatureCollection' as const, features: [] };
  const { rerender } = renderHook(
    ({ id, live }) => useMapNeighborHighlight(mapRef, true, id, live, 'dark', points),
    { initialProps: { id: 'one' as string | null, live: false } },
  );
  const evaluate = (layer: string, prop: string, properties: Record<string, unknown>) => {
    const parsed = createExpression(paints.get(`${layer}:${prop}`));
    if (parsed.result === 'error') throw new Error(JSON.stringify(parsed.value));
    return parsed.value.evaluate(
      { zoom: 12 },
      { type: layer === NEIGHBORS_LINE_LAYER_ID ? 2 : 1, properties },
    );
  };
  expect(
    evaluate(NEIGHBORS_LINE_LAYER_ID, 'line-width', { selected: true, neighborId: 'one' }),
  ).toBe(4);
  expect(
    evaluate(NEIGHBORS_LINE_LAYER_ID, 'line-width', { selected: true, neighborId: 'two' }),
  ).toBe(2);
  expect(
    evaluate(NEIGHBORS_LINE_LAYER_ID, 'line-width', { selected: false, neighborId: 'one' }),
  ).toBe(1);
  expect(evaluate(FOCUSED_NEIGHBORS_LAYER_ID, 'circle-radius', { id: 'one' })).toBe(16);
  expect(evaluate(FOCUSED_NEIGHBORS_LAYER_ID, 'circle-radius', { id: 'two' })).toBe(13.5);
  expect(evaluate(FOCUSED_NEIGHBORS_LAYER_ID, 'circle-radius', { id: 'one', selected: true })).toBe(
    13.5,
  );
  rerender({ id: null, live: false });
  expect(
    evaluate(NEIGHBORS_LINE_LAYER_ID, 'line-width', { selected: true, neighborId: 'one' }),
  ).toBe(2);
  expect(evaluate(FOCUSED_NEIGHBORS_LAYER_ID, 'circle-stroke-width', { id: 'one' })).toBe(1.25);
  rerender({ id: 'one', live: true });
  expect(evaluate(FOCUSED_NEIGHBORS_LAYER_ID, 'circle-radius', { id: 'one' })).toBe(9);
  expect(map.addSource).not.toHaveBeenCalled();
  expect(map.getSource).not.toHaveBeenCalled();
});
