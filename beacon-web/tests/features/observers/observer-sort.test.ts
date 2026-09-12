import { describe, expect, it } from 'vitest';
import { observerSortId } from '../../../src/features/observers/observer-sort';

describe('observer sort identifiers', () => {
  it.each(['name', 'type', 'radio', 'iata', 'status'])('preserves the API ID %s', (id) => {
    expect(observerSortId(id)).toBe(id);
  });
  it.each([undefined, 'Name', 'Grannar', 'invalid'])(
    'falls back for unsupported input %s',
    (id) => {
      expect(observerSortId(id)).toBe('name');
    },
  );
});
