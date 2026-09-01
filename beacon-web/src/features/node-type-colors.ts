// Semantic role colours are intentionally independent of the active palette. A repeater should
// read as the same thing in the map and analytics, and the roles remain distinguishable.
export const NODE_TYPE_COLORS = {
  companion: '#0072B2',
  repeater: '#D55E00',
  room_server: '#009E73',
  sensor: '#CC79A7',
  unknown: '#6B7280',
} as const;

export function nodeTypeColor(typeName: string): string {
  return NODE_TYPE_COLORS[typeName as keyof typeof NODE_TYPE_COLORS] ?? NODE_TYPE_COLORS.unknown;
}
