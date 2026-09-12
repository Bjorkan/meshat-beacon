import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Color, createExpression, latest } from '@maplibre/maplibre-gl-style-spec';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { useMapNeighbors } from '../../../src/features/map/useMapNeighbors';
import { NO_SNR_COLOR } from '../../../src/features/map/neighbor-thresholds';

function lineExpression() {
  const setPaintProperty = vi.fn();
  const map = {
    getSource: () => ({ setData: vi.fn() }),
    getLayer: () => undefined,
    addLayer: vi.fn(),
    setPaintProperty,
    removeSource: vi.fn(),
  };
  renderHook(() =>
    useMapNeighbors(
      { current: map as unknown as MapLibreMap },
      true,
      { type: 'FeatureCollection', features: [] },
      'dark',
    ),
  );
  const parsed = createExpression(
    setPaintProperty.mock.calls[0]![2],
    latest.paint_line['line-color'],
  );
  if (parsed.result === 'error') throw new Error(JSON.stringify(parsed.value));
  return (properties: Record<string, unknown>) =>
    parsed.value.evaluate({ zoom: 12 }, { type: 2, properties }) as Color;
}

describe('neighbor RF quality colours', () => {
  it.each([false, true])(
    'uses blue for no SNR regardless of observations (selected=%s)',
    (selected) => {
      const color = lineExpression();
      for (const obs of [undefined, 0, 1, 20, 10000]) {
        expect(color({ selected, ...(obs === undefined ? {} : { obs }) }).toString()).toBe(
          Color.parse(NO_SNR_COLOR)!.toString(),
        );
      }
    },
  );
  it('treats zero SNR as data and keeps colour independent of age and observation count', () => {
    const color = lineExpression();
    expect(color({ selected: true, snr: 0 }).toString()).not.toBe(
      Color.parse(NO_SNR_COLOR)!.toString(),
    );
    expect(color({ selected: true, snr: 0, ageDays: 28, obs: 10000 })).toEqual(
      color({ selected: false, snr: 0, ageDays: 0, obs: 1 }),
    );
    expect(color({ snr: -15 })).not.toEqual(color({ snr: 5 }));
  });
});
