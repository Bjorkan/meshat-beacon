import { describe, expect, it } from 'vitest';
import { NODE_TYPE_COLORS, nodeTypeColor } from '../../src/features/node-type-colors';

describe('node type colours', () => {
  it('assigns every node role a stable and distinct colour', () => {
    const roles = ['companion', 'repeater', 'room_server', 'sensor'];
    expect(new Set(roles.map(nodeTypeColor)).size).toBe(roles.length);
    expect(nodeTypeColor('unknown')).toBe(NODE_TYPE_COLORS.unknown);
  });
});
