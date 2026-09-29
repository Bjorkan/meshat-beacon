import type { ExpressionSpecification, GeoJSONSourceSpecification } from 'maplibre-gl';
import { NODE_TYPE_COLORS } from '../node-type-colors';

// Categories partition the population; observer is an additional role, never another ring slice.
export const CLUSTER_ROLE_KEYS = {
  repeater: 'repeater_count',
  companion: 'companion_count',
  roomServer: 'room_count',
  sensor: 'sensor_count',
  unknown: 'unknown_count',
  observer: 'observer_count',
} as const;

export const CLUSTER_ROLE_COLORS = {
  repeater: NODE_TYPE_COLORS.repeater,
  companion: NODE_TYPE_COLORS.companion,
  roomServer: NODE_TYPE_COLORS.room_server,
  sensor: NODE_TYPE_COLORS.sensor,
  unknown: NODE_TYPE_COLORS.unknown,
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
    [CLUSTER_ROLE_KEYS.unknown]: [
      '+',
      [
        'case',
        [
          'in',
          ['get', 'nodeTypeName'],
          ['literal', ['repeater', 'companion', 'room_server', 'sensor']],
        ],
        0,
        1,
      ],
    ],
    [CLUSTER_ROLE_KEYS.observer]: ['+', ['case', ['to-boolean', ['get', 'isObserver']], 1, 0]],
  } as NonNullable<GeoJSONSourceSpecification['clusterProperties']>;
}

export const CLUSTER_CATEGORIES = [
  'repeater',
  'companion',
  'roomServer',
  'sensor',
  'unknown',
] as const;
export const CLUSTER_ICON_PREFIX = 'node-cluster:';

export const CLUSTER_ICON_IMAGE: ExpressionSpecification = [
  'concat',
  CLUSTER_ICON_PREFIX,
  ['to-string', ['get', 'point_count']],
  ...CLUSTER_CATEGORIES.flatMap((category) => [
    ':',
    ['to-string', ['get', CLUSTER_ROLE_KEYS[category]]],
  ]),
] as ExpressionSpecification;

export function clusterSegments(counts: readonly number[]) {
  const total = counts.reduce((sum, count) => sum + count, 0);
  let cumulative = 0;
  return CLUSTER_CATEGORIES.flatMap((category, index) => {
    const count = counts[index] ?? 0;
    if (count <= 0 || total <= 0) return [];
    const start = cumulative / total;
    cumulative += count;
    return [
      { category, count, color: CLUSTER_ROLE_COLORS[category], start, end: cumulative / total },
    ];
  });
}
