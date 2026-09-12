import { describe, expect, it } from 'vitest';
import { nodeSortId } from '../../../src/features/nodes/node-sort';

describe('node sort identifiers', () => {
  it.each(['name', 'type', 'radio', 'neighbors'])('preserves the API ID %s', (id) => {
    expect(nodeSortId(id)).toBe(id);
  });
  it.each([undefined, 'Name', 'Grannar', 'invalid'])(
    'falls back for unsupported input %s',
    (id) => {
      expect(nodeSortId(id)).toBe('name');
    },
  );
});
