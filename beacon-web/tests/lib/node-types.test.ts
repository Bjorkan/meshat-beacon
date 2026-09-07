import { expect, it } from 'vitest';
import { NODE_TYPES, nodeTypeLabel } from '../../src/lib/node-types';

it('uses canonical labels for both API enum casings', () => {
  for (const { name, label } of NODE_TYPES) {
    expect(nodeTypeLabel(name)).toBe(label);
    expect(nodeTypeLabel(name.toUpperCase())).toBe(label);
  }
  expect(nodeTypeLabel('ROOM_SERVER')).toBe('Room');
});
it('uses localized unknown copy for missing and future enum values', () => {
  for (const value of [null, undefined, '', 'FUTURE_DEVICE']) {
    expect(nodeTypeLabel(value, 'Okänd')).toBe('Okänd');
  }
});
