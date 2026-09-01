import { describe, it, expect } from "vitest";
import {
  nodeListUpdateRequiresRefetch,
  patchNodeSummary,
  patchNodeTableSummary,
  upsertNodePages,
} from "../../../src/features/nodes/node-updates";
import type { NodeSummary } from "../../../src/features/nodes/types";
import type { WsNodeUpdate } from "../../../src/types/ws";
import type { InfiniteData } from "@tanstack/react-query";
import type { CursorPage } from "../../../src/types/api";

function node(overrides: Partial<NodeSummary>): NodeSummary {
  return {
    id: "n1",
    publicKey: "aabb",
    nodeType: 2,
    nodeTypeName: "repeater",
    name: "Node 1",
    lat: 45,
    lng: -75,
    iatas: [],
    knownNeighborCount: 0,
    isObserver: false,
    ...overrides,
  };
}

function update(overrides: Partial<WsNodeUpdate["data"]>): WsNodeUpdate["data"] {
  return {
    nodeId: "n1",
    publicKey: "aabb",
    name: "New",
    nodeType: 2,
    nodeTypeName: "repeater",
    iata: "YOW",
    lat: undefined,
    lng: undefined,
    isObserver: false,
    iatas: [],
    ...overrides,
  };
}

describe("patchNodeSummary", () => {
  it("returns the list unchanged (same ref) when it is undefined", () => {
    expect(patchNodeSummary(undefined, update({}))).toBeUndefined();
  });

  it("returns the same list when the node is not present (no new rows)", () => {
    const list = [node({ id: "a" })];
    expect(patchNodeSummary(list, update({ nodeId: "missing" }))).toBe(list);
  });

  it("patches name/lat/lng of the matching node immutably", () => {
    const list = [node({ id: "a", name: "Old" }), node({ id: "b" })];
    const out = patchNodeSummary(list, update({ nodeId: "b", name: "Renamed", lat: 50, lng: -80 }))!;
    expect(out).not.toBe(list);
    expect(out[0]).toBe(list[0]);
    expect(out[1]).toMatchObject({ id: "b", name: "Renamed", lat: 50, lng: -80 });
  });

  it("keeps the previous name when the update name is empty", () => {
    const list = [node({ id: "a", name: "Keep" })];
    const out = patchNodeSummary(list, update({ nodeId: "a", name: "" }))!;
    expect(out[0]!.name).toBe("Keep");
  });

  it("keeps the previous lat/lng when the update omits them", () => {
    const list = [node({ id: "a", lat: 10, lng: 20 })];
    const out = patchNodeSummary(list, update({ nodeId: "a", lat: undefined, lng: undefined }))!;
    expect(out[0]!.lat).toBe(10);
    expect(out[0]!.lng).toBe(20);
  });

  it("returns the same list ref when the map-visible fields do not change", () => {
    const list = [node({ id: "a", name: "Keep", lat: 10, lng: 20 })];
    const out = patchNodeSummary(list, update({ nodeId: "a", name: "Keep", radio: "915,250,11" }));
    expect(out).toBe(list);
  });
});

describe("Nodes-table live update policy", () => {
  it("patches summary fields that are safe to update in place", () => {
    const list = [node({ id: "a", name: "Keep", radio: "915,250,10", defaultScope: "#east" })];
    const out = patchNodeTableSummary(list, update({
      nodeId: "a",
      name: "Keep",
      radio: "915,250,11",
      defaultScope: "#west",
      iatas: [{ iata: "YOW", lastHeard: 123 }],
    }))!;
    expect(out[0]).toMatchObject({ radio: "915,250,11", defaultScope: "#west" });
    expect(out[0]!.iatas).toEqual([{ iata: "YOW", lastHeard: 123 }]);
  });

  it("requires a refetch when the active server sort key changes", () => {
    const prev = node({ name: "Alpha" });
    expect(nodeListUpdateRequiresRefetch(prev, update({ name: "Zulu" }), { sort: "name" })).toBe(true);
    expect(nodeListUpdateRequiresRefetch(prev, update({ name: "Zulu" }), { sort: "neighbors" })).toBe(false);
  });

  it("requires a refetch only when active filter membership changes", () => {
    const prev = node({ name: "Alpha", defaultScope: "#east", iatas: [{ iata: "YOW", lastHeard: 1 }] });
    expect(nodeListUpdateRequiresRefetch(prev, update({ name: "Zulu" }), { sort: "neighbors", name: "alp" })).toBe(true);
    expect(nodeListUpdateRequiresRefetch(prev, update({ name: "Alpha", defaultScope: "#west" }), { sort: "neighbors", scope: "#east" })).toBe(true);
    expect(nodeListUpdateRequiresRefetch(prev, update({ name: "Alpha", iatas: [{ iata: "YVR", lastHeard: 2 }] }), { sort: "neighbors", iatas: ["YOW"] })).toBe(true);
    expect(nodeListUpdateRequiresRefetch(prev, update({ name: "Alpha", lat: 46 }), { sort: "neighbors", name: "alp" })).toBe(false);
  });
});

describe("upsertNodePages", () => {
  const pages = (...lists: NodeSummary[][]): InfiniteData<CursorPage<NodeSummary>> => ({
    pages: lists.map((items, i) => ({ items, nextCursor: i + 1, hasMore: i < lists.length - 1 })),
    pageParams: lists.map((_, i) => i),
  });

  it("patches a known node in place", () => {
    const old = pages([node({ id: "a", name: "Old" })]);
    const out = upsertNodePages(old, update({ nodeId: "a", name: "Renamed" }))!;
    expect(out.pages[0]!.items[0]).toMatchObject({ id: "a", name: "Renamed" });
  });

  it("appends an unknown node to the last page", () => {
    const old = pages([node({ id: "a" })], [node({ id: "b" })]);
    const out = upsertNodePages(
      old,
      update({ nodeId: "new1", publicKey: "ccdd", name: "Fresh", nodeTypeName: "companion", nodeType: 1, lat: 50.5, lng: -100.25, isObserver: false, iatas: [] }),
    )!;
    expect(out).not.toBe(old);
    expect(out.pages[0]).toBe(old.pages[0]);
    expect(out.pages[1]!.items.map((n) => n.id)).toEqual(["b", "new1"]);
    expect(out.pages[1]!.items[1]).toMatchObject({ name: "Fresh", lat: 50.5, lng: -100.25 });
  });

  it("keeps the same ref for a re-advert that changes nothing map-visible", () => {
    const old = pages([node({ id: "a", name: "Keep", lat: 10, lng: 20 })]);
    expect(upsertNodePages(old, update({ nodeId: "a", name: "Keep", lat: undefined, lng: undefined }))).toBe(old);
  });

  it("passes undefined caches through", () => {
    expect(upsertNodePages(undefined, update({}))).toBeUndefined();
  });
});
