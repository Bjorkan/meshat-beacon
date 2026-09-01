import { describe, expect, it } from "vitest";
import {
  CLUSTER_ROLE_COLORS,
  CLUSTER_ROLE_KEYS,
  clusterBreakdownTextExpression,
  clusterRoleProperties,
} from "../../../src/features/map/cluster-style";

describe("cluster style", () => {
  it("aggregates every role used by the compact cluster summary", () => {
    const props = clusterRoleProperties();
    expect(Object.keys(props).sort()).toEqual(Object.values(CLUSTER_ROLE_KEYS).sort());
    expect(props[CLUSTER_ROLE_KEYS.repeater]).toContainEqual(["case", ["==", ["get", "nodeTypeName"], "repeater"], 1, 0]);
    expect(props[CLUSTER_ROLE_KEYS.companion]).toContainEqual(["case", ["==", ["get", "nodeTypeName"], "companion"], 1, 0]);
    expect(props[CLUSTER_ROLE_KEYS.observer]).toContainEqual(["case", ["to-boolean", ["get", "isObserver"]], 1, 0]);
  });

  it("renders role composition as a single formatted label with stable colours", () => {
    const expression = clusterBreakdownTextExpression();
    expect(expression[0]).toBe("format");
    const serialized = JSON.stringify(expression);
    for (const colour of Object.values(CLUSTER_ROLE_COLORS).slice(0, 4)) expect(serialized).toContain(colour);
    expect(serialized).toContain(CLUSTER_ROLE_KEYS.repeater);
    expect(serialized).toContain(CLUSTER_ROLE_KEYS.companion);
    expect(serialized).toContain(CLUSTER_ROLE_KEYS.roomServer);
    expect(serialized).toContain(CLUSTER_ROLE_KEYS.sensor);
  });
});
