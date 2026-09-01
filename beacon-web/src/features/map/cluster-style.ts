import type { GeoJSONSourceSpecification } from "maplibre-gl";

// Cluster presentation deliberately uses a neutral carrier with compact role counts. It borrows the
// useful visual hierarchy from CoreScope (count first, composition second) without sharing its DOM/
// Leaflet implementation. The source aggregates these counters once, so rendering stays GPU-native.
export const CLUSTER_ROLE_KEYS = {
  repeater: "repeater_count",
  companion: "companion_count",
  roomServer: "room_count",
  sensor: "sensor_count",
  observer: "observer_count",
} as const;

export const CLUSTER_ROLE_COLORS = {
  repeater: "#E4572E",
  companion: "#56B4E9",
  roomServer: "#22C55E",
  sensor: "#F0C62E",
  observer: "#C77DFF",
} as const;

export function clusterRoleProperties(): NonNullable<GeoJSONSourceSpecification["clusterProperties"]> {
  const typeCount = (type: string) => [
    "+",
    ["case", ["==", ["get", "nodeTypeName"], type], 1, 0],
  ];
  return {
    [CLUSTER_ROLE_KEYS.repeater]: typeCount("repeater"),
    [CLUSTER_ROLE_KEYS.companion]: typeCount("companion"),
    [CLUSTER_ROLE_KEYS.roomServer]: typeCount("room_server"),
    [CLUSTER_ROLE_KEYS.sensor]: typeCount("sensor"),
    [CLUSTER_ROLE_KEYS.observer]: [
      "+",
      ["case", ["to-boolean", ["get", "isObserver"]], 1, 0],
    ],
  } as NonNullable<GeoJSONSourceSpecification["clusterProperties"]>;
}

function compactCount(property: string): unknown[] {
  return [
    "case",
    [">", ["get", property], 999],
    "999+",
    ["to-string", ["get", property]],
  ];
}

function roleSegment(prefix: string, property: string, leadingSpace = false): unknown[] {
  return [
    "case",
    [">", ["get", property], 0],
    ["concat", leadingSpace ? "  " : "", prefix, compactCount(property)],
    "",
  ];
}

// MapLibre's formatted text lets each role retain a distinct hue without creating one layer per
// role or one HTML marker per cluster. Counts are secondary to the large total above them.
export function clusterBreakdownTextExpression(): unknown[] {
  return [
    "format",
    roleSegment("R", CLUSTER_ROLE_KEYS.repeater),
    { "text-color": CLUSTER_ROLE_COLORS.repeater, "font-scale": 0.82 },
    roleSegment("C", CLUSTER_ROLE_KEYS.companion, true),
    { "text-color": CLUSTER_ROLE_COLORS.companion, "font-scale": 0.82 },
    roleSegment("M", CLUSTER_ROLE_KEYS.roomServer, true),
    { "text-color": CLUSTER_ROLE_COLORS.roomServer, "font-scale": 0.82 },
    roleSegment("S", CLUSTER_ROLE_KEYS.sensor, true),
    { "text-color": CLUSTER_ROLE_COLORS.sensor, "font-scale": 0.82 },
  ];
}
