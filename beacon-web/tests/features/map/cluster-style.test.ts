import { describe, expect, it } from 'vitest';
import { CLUSTER_ROLE_KEYS, clusterRoleProperties } from '../../../src/features/map/cluster-style';

describe('cluster style', () => {
  it('aggregates every role used by the compact cluster summary', () => {
    const props = clusterRoleProperties();
    expect(Object.keys(props).sort()).toEqual(Object.values(CLUSTER_ROLE_KEYS).sort());
    expect(props[CLUSTER_ROLE_KEYS.repeater]).toContainEqual([
      'case',
      ['==', ['get', 'nodeTypeName'], 'repeater'],
      1,
      0,
    ]);
    expect(props[CLUSTER_ROLE_KEYS.companion]).toContainEqual([
      'case',
      ['==', ['get', 'nodeTypeName'], 'companion'],
      1,
      0,
    ]);
    expect(props[CLUSTER_ROLE_KEYS.observer]).toContainEqual([
      'case',
      ['to-boolean', ['get', 'isObserver']],
      1,
      0,
    ]);
  });
});
