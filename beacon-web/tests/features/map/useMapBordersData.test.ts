import { describe, it, expect, vi } from 'vitest';
import { mergeBorders, useMapBordersData } from '../../../src/features/map/useMapBordersData';
import { createElement, type ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { getIataBorder } from '../../../src/api/client';
import type { Feature, Polygon } from 'geojson';

const poly = (id: number): Feature<Polygon> => ({
  type: 'Feature',
  properties: { name: `p${id}` },
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [id, 0],
        [id + 1, 0],
        [id + 1, 1],
        [id, 0],
      ],
    ],
  },
});

describe('mergeBorders', () => {
  it("drops IATAs with no border and stamps the iata onto each feature's properties", () => {
    const fc = mergeBorders([
      { iata: 'YOW', border: poly(0) },
      { iata: 'YYZ', border: null },
      { iata: 'YUL', border: poly(5) },
    ]);

    expect(fc.type).toBe('FeatureCollection');
    expect(fc.features).toHaveLength(2);
    expect(fc.features.map((f) => f.properties.iata)).toEqual(['YOW', 'YUL']);
    // existing properties and geometry survive the merge
    expect(fc.features[0]!.properties.name).toBe('p0');
    expect(fc.features[0]!.geometry).toEqual(poly(0).geometry);
  });

  it('returns an empty FeatureCollection when nothing has a border', () => {
    const fc = mergeBorders([{ iata: 'YOW', border: null }]);
    expect(fc.features).toHaveLength(0);
  });
});

// Disabling a query does not discard cached data; the map must explicitly clear its source.
vi.mock('../../../src/api/client', () => ({ getIataBorder: vi.fn() }));

it('clears cached borders when switched off and restores them when enabled', async () => {
  vi.mocked(getIataBorder).mockResolvedValue(poly(0));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
  const { result, rerender } = renderHook(({ enabled }) => useMapBordersData(['YOW'], enabled), {
    initialProps: { enabled: true },
    wrapper,
  });
  await waitFor(() => expect(result.current.features).toHaveLength(1));
  rerender({ enabled: false });
  expect(result.current.features).toEqual([]);
  rerender({ enabled: true });
  expect(result.current.features).toHaveLength(1);
});

it('does not reveal a late response after the borders were switched off', async () => {
  let resolve!: (value: Feature<Polygon>) => void;
  vi.mocked(getIataBorder).mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
  const { result, rerender } = renderHook(({ enabled }) => useMapBordersData(['YOW'], enabled), {
    initialProps: { enabled: true },
    wrapper,
  });
  rerender({ enabled: false });
  resolve(poly(0));
  await waitFor(() => expect(client.isFetching()).toBe(0));
  expect(result.current.features).toEqual([]);
});
