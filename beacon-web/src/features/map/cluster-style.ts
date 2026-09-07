import type { GeoJSONSourceSpecification } from 'maplibre-gl';
import { NODE_TYPE_COLORS } from '../node-type-colors';

// Aggregate role counts alongside the cluster total. The map presents the total only;
// individual roles become visible when the user expands a cluster.
export const CLUSTER_ROLE_KEYS = {
  repeater: 'repeater_count',
  companion: 'companion_count',
  roomServer: 'room_count',
  sensor: 'sensor_count',
  observer: 'observer_count',
} as const;

export const CLUSTER_ROLE_COLORS = {
  repeater: NODE_TYPE_COLORS.repeater,
  companion: NODE_TYPE_COLORS.companion,
  roomServer: NODE_TYPE_COLORS.room_server,
  sensor: NODE_TYPE_COLORS.sensor,
  observer: '#C77DFF',
} as const;

export function clusterRoleProperties(): NonNullable<
  GeoJSONSourceSpecification['clusterProperties']
> {
  const typeCount = (type: string) => ['+', ['case', ['==', ['get', 'nodeTypeName'], type], 1, 0]];
  return {
    [CLUSTER_ROLE_KEYS.repeater]: typeCount('repeater'),
    [CLUSTER_ROLE_KEYS.companion]: typeCount('companion'),
    [CLUSTER_ROLE_KEYS.roomServer]: typeCount('room_server'),
    [CLUSTER_ROLE_KEYS.sensor]: typeCount('sensor'),
    [CLUSTER_ROLE_KEYS.observer]: ['+', ['case', ['to-boolean', ['get', 'isObserver']], 1, 0]],
  } as NonNullable<GeoJSONSourceSpecification['clusterProperties']>;
}
