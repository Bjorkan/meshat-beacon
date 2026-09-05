import { describe, expect, it } from 'vitest';
import {
  ALL_REGIONS,
  isAllRegions,
  normalizeSelection,
  resolveIatas,
  regionKey,
} from '../../src/hooks/region-selection';

describe('normalizeSelection', () => {
  it('collapses a root-only region selection to the empty no-filter state', () => {
    const normalized = normalizeSelection({ regions: ['sweden'], iatas: [] }, 'sweden');
    expect(isAllRegions(normalized)).toBe(true);
    expect(normalized).toEqual(ALL_REGIONS);
  });

  it('keeps the no-filter semantics: root resolves to undefined IATAs and the "*" key', () => {
    const normalized = normalizeSelection({ regions: ['sweden'], iatas: [] }, 'sweden');
    expect(resolveIatas(normalized, new Map([['sweden', ['ARN']]]))).toBeUndefined();
    expect(regionKey(resolveIatas(normalized, new Map([['sweden', ['ARN']]])))).toBe('*');
  });

  it('leaves other selections untouched', () => {
    expect(normalizeSelection({ regions: ['sweden', 'gotland'], iatas: [] }, 'sweden')).toEqual({
      regions: ['sweden', 'gotland'],
      iatas: [],
    });
    expect(normalizeSelection({ regions: [], iatas: ['ARN'] }, 'sweden')).toEqual({
      regions: [],
      iatas: ['ARN'],
    });
    expect(normalizeSelection(ALL_REGIONS, 'sweden')).toEqual(ALL_REGIONS);
  });

  it('is a no-op when no root region is configured', () => {
    expect(normalizeSelection({ regions: ['sweden'], iatas: [] }, null)).toEqual({
      regions: ['sweden'],
      iatas: [],
    });
  });
});
