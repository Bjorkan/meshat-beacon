import { describe, expect, it } from 'vitest';
import { effectiveColor, pingAgeOpacity, formatPingAge } from '../../../src/features/map/coverage';
import { coverageToFeatureCollection } from '../../../src/features/map/useMapCoverageLayer';
import type { CoverageCell } from '../../../src/features/map/coverage';

const NOW = 1788636304 * 1000;

function cell(over: Partial<CoverageCell> = {}): CoverageCell {
  return {
    gridId: '1_1',
    bounds: { south: 59.0, west: 17.0, north: 59.01, east: 17.01 },
    coverageType: 'BIDIR',
    effective: 2.5,
    count: 10,
    timestamp: 1788636304,
    statusMask: 1,
    ...over,
  };
}

describe('effectiveColor', () => {
  it('ramps red to green across 0-3', () => {
    expect(effectiveColor(0)).toBe('rgb(189,33,48)');
    expect(effectiveColor(3)).toBe('rgb(30,126,52)');
    const mid = effectiveColor(1.5);
    expect(mid).not.toBe('rgb(189,33,48)');
    expect(mid).not.toBe('rgb(30,126,52)');
  });

  it('clamps out-of-range input', () => {
    expect(effectiveColor(-5)).toBe(effectiveColor(0));
    expect(effectiveColor(99)).toBe(effectiveColor(3));
  });
});

describe('pingAgeOpacity', () => {
  it('is solid when fresh, faint when stale', () => {
    expect(pingAgeOpacity(Math.floor(NOW / 1000) - 3600, NOW)).toBeCloseTo(0.85);
    expect(pingAgeOpacity(Math.floor(NOW / 1000) - 30 * 86400, NOW)).toBeCloseTo(0.15);
    expect(pingAgeOpacity(undefined, NOW)).toBe(0.15);
  });
});

describe('formatPingAge', () => {
  it('formats minutes, hours and days', () => {
    const base = Math.floor(NOW / 1000);
    expect(formatPingAge(base - 90, NOW)).toBe('1m ago');
    expect(formatPingAge(base - 5 * 3600, NOW)).toBe('5h ago');
    expect(formatPingAge(base - 3 * 86400, NOW)).toBe('3d ago');
    expect(formatPingAge(undefined, NOW)).toBe('unknown age');
  });
});

describe('coverageToFeatureCollection', () => {
  it('emits one polygon per cell with bounds ring', () => {
    const fc = coverageToFeatureCollection([cell()], 'effective', NOW);
    expect(fc.features).toHaveLength(1);
    const geom = fc.features[0]!.geometry;
    expect(geom.type).toBe('Polygon');
    expect(geom.coordinates[0]).toEqual([
      [17.0, 59.0],
      [17.01, 59.0],
      [17.01, 59.01],
      [17.0, 59.01],
      [17.0, 59.0],
    ]);
  });

  it('encodes mode in fill color and opacity', () => {
    const eff = coverageToFeatureCollection([cell({ effective: 3 })], 'effective', NOW);
    expect(eff.features[0]!.properties['fill-color']).toBe('rgb(30,126,52)');
    const age = coverageToFeatureCollection(
      [cell({ timestamp: Math.floor(NOW / 1000) - 3600 })],
      'age',
      NOW,
    );
    expect(age.features[0]!.properties['fill-opacity']).toBeCloseTo(0.85);
  });
});
