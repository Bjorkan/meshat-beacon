import { describe, it, expect } from "vitest";
import {
  observerListUpdateRequiresRefetch,
  patchObserverSummary,
} from "../../../src/features/observers/observer-updates";
import type { ObserverSummary } from "../../../src/features/observers/types";
import type { WsObserverStatus } from "../../../src/types/ws";

function observer(overrides: Partial<ObserverSummary>): ObserverSummary {
  return {
    id: "o1",
    iata: "YOW",
    status: "offline",
    displayName: "Obs 1",
    observerType: "meshcoretomqtt",
    scopes: ["#east"],
    ...overrides,
  };
}

function update(overrides: Partial<WsObserverStatus["data"]>): WsObserverStatus["data"] {
  return {
    observerId: "o1",
    displayName: "New",
    observerType: "meshcoretomqtt",
    iata: "YOW",
    online: true,
    scopes: ["#east"],
    uptimeSeconds: 100,
    lastStatusAt: 1000,
    ...overrides,
  };
}

describe("patchObserverSummary", () => {
  it("returns undefined when the list is undefined", () => {
    expect(patchObserverSummary(undefined, update({}))).toBeUndefined();
  });

  it("returns the same list (same ref) when the observer is not present", () => {
    const list = [observer({ id: "a" })];
    expect(patchObserverSummary(list, update({ observerId: "missing" }))).toBe(list);
  });

  it("patches the complete live summary of the matching observer immutably", () => {
    const list = [observer({ id: "a" }), observer({ id: "b", status: "offline" })];
    const out = patchObserverSummary(list, update({
      observerId: "b",
      online: true,
      displayName: "Renamed",
      observerType: "serial",
      iata: "YVR",
      radio: "915,250,11",
      scopes: ["#west"],
    }))!;
    expect(out).not.toBe(list);
    expect(out[0]).toBe(list[0]);
    expect(out[1]).toMatchObject({
      id: "b",
      status: "online",
      displayName: "Renamed",
      observerType: "serial",
      iata: "YVR",
      radio: "915,250,11",
      scopes: ["#west"],
    });
  });

  it("maps online=false to offline status", () => {
    const list = [observer({ id: "a", status: "online" })];
    const out = patchObserverSummary(list, update({ observerId: "a", online: false }))!;
    expect(out[0]!.status).toBe("offline");
  });

  it("maps a null scopes payload to an empty scope list", () => {
    const list = [observer({ id: "a", scopes: ["#east"] })];
    const out = patchObserverSummary(list, update({ observerId: "a", scopes: null }))!;
    expect(out[0]!.scopes).toEqual([]);
  });

  it("keeps the previous displayName when the update name is empty", () => {
    const list = [observer({ id: "a", displayName: "Keep" })];
    const out = patchObserverSummary(list, update({ observerId: "a", displayName: "" }))!;
    expect(out[0]!.displayName).toBe("Keep");
  });

  it("returns the same list ref when the update changes nothing", () => {
    const list = [observer({ id: "a", status: "online", displayName: "Keep", lastStatusAt: 1000 })];
    const out = patchObserverSummary(list, update({ observerId: "a", online: true, displayName: "Keep", lastStatusAt: 1000 }));
    expect(out).toBe(list);
  });

  it("updates lastStatusAt even when the sort/filter fields are unchanged", () => {
    const list = [observer({ id: "a", status: "online", displayName: "Keep", lastStatusAt: 100 })];
    const out = patchObserverSummary(list, update({ observerId: "a", online: true, displayName: "Keep", lastStatusAt: 200 }))!;
    expect(out).not.toBe(list);
    expect(out[0]!.lastStatusAt).toBe(200);
  });
});

describe("Observers-table live update policy", () => {
  it("refetches when a server ordering key changes", () => {
    const prev = observer({ displayName: "Alpha", status: "offline" });
    expect(observerListUpdateRequiresRefetch(prev, update({ displayName: "Zulu", online: false }), { sort: "name" })).toBe(true);
    expect(observerListUpdateRequiresRefetch(prev, update({ displayName: "Alpha", online: true }), { sort: "status" })).toBe(true);
    expect(observerListUpdateRequiresRefetch(prev, update({ displayName: "Alpha", online: false, lastStatusAt: 2000 }), { sort: "name" })).toBe(false);
  });

  it("refetches when active server filter membership changes", () => {
    const prev = observer({ displayName: "Alpha", status: "offline", iata: "YOW", scopes: ["#east"] });
    expect(observerListUpdateRequiresRefetch(prev, update({ displayName: "Zulu", online: false }), { sort: "last_seen", name: "alp" })).toBe(true);
    expect(observerListUpdateRequiresRefetch(prev, update({ displayName: "Alpha", online: false, scopes: ["#west"] }), { sort: "last_seen", scope: "#east" })).toBe(true);
    expect(observerListUpdateRequiresRefetch(prev, update({ displayName: "Alpha", online: false, iata: "YVR" }), { sort: "last_seen", iatas: ["YOW"] })).toBe(true);
    expect(observerListUpdateRequiresRefetch(prev, update({ displayName: "Alpha", online: false, lastStatusAt: 2000 }), { sort: "last_seen", name: "alp" })).toBe(false);
  });
});
