import { describe, it, expect } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { TestRouter } from "../../helpers/test-router";
import { matchesFilters, toServerFilter, usePacketFilters } from "../../../src/features/packets/usePacketFilters";
import { EMPTY_FILTERS } from "../../../src/features/packets/types";
import type { PayloadTypeValue, RouteTypeValue } from "../../../src/types/enums";
import type { PacketSummary } from "../../../src/types/api";

function pkt(over: Partial<PacketSummary>): PacketSummary {
  return {
    packetHash: "abcd1234",
    payloadType: 2,
    payloadTypeName: "TEXT_MESSAGE",
    routeType: 0,
    routeTypeName: "FLOOD",
    firstHeardAt: 0,
    lastHeardAt: 0,
    observationCount: 1,
    ...over,
  };
}

describe("matchesFilters — scope", () => {
  it("ignores scope when no scope filter is set", () => {
    expect(matchesFilters(pkt({ scope: "#bc" }), EMPTY_FILTERS)).toBe(true);
    expect(matchesFilters(pkt({ scope: undefined }), EMPTY_FILTERS)).toBe(true);
  });

  it("keeps only packets whose scope is selected", () => {
    const filters = { ...EMPTY_FILTERS, scopes: ["#bc"] };
    expect(matchesFilters(pkt({ scope: "#bc" }), filters)).toBe(true);
    expect(matchesFilters(pkt({ scope: "#west" }), filters)).toBe(false);
    expect(matchesFilters(pkt({ scope: undefined }), filters)).toBe(false); // untagged is excluded
  });

  it("matches any of several selected scopes", () => {
    const filters = { ...EMPTY_FILTERS, scopes: ["#bc", "#west"] };
    expect(matchesFilters(pkt({ scope: "#west" }), filters)).toBe(true);
    expect(matchesFilters(pkt({ scope: "#east" }), filters)).toBe(false);
  });

  it("ANDs scope with the payload-type filter", () => {
    const filters = { ...EMPTY_FILTERS, scopes: ["#bc"], payloadTypes: [4] as PayloadTypeValue[] };
    expect(matchesFilters(pkt({ scope: "#bc", payloadType: 4 }), filters)).toBe(true);
    expect(matchesFilters(pkt({ scope: "#bc", payloadType: 2 }), filters)).toBe(false); // wrong type
    expect(matchesFilters(pkt({ scope: "#west", payloadType: 4 }), filters)).toBe(false); // wrong scope
  });
});

describe("toServerFilter", () => {
  it("returns null when no server-side dimension is selected", () => {
    expect(toServerFilter(EMPTY_FILTERS)).toBeNull();
  });

  it("pushes a multi-value payload-type selection server-side", () => {
    expect(toServerFilter({ ...EMPTY_FILTERS, payloadTypes: [2, 4] as PayloadTypeValue[] })).toEqual({ payloadTypes: [2, 4] });
  });

  it("emits payloadTypes for a single selected type", () => {
    expect(toServerFilter({ ...EMPTY_FILTERS, payloadTypes: [4] as PayloadTypeValue[] })).toEqual({ payloadTypes: [4] });
  });

  it("emits routeTypes including 0 (falsy) for a selected route", () => {
    expect(toServerFilter({ ...EMPTY_FILTERS, routeTypes: [0] as RouteTypeValue[] })).toEqual({ routeTypes: [0] });
  });

  it("emits scopes for selected scopes", () => {
    expect(toServerFilter({ ...EMPTY_FILTERS, scopes: ["#bc", "#west"] })).toEqual({ scopes: ["#bc", "#west"] });
  });

  it("emits every selected dimension together", () => {
    const filters = {
      ...EMPTY_FILTERS,
      payloadTypes: [4] as PayloadTypeValue[],
      routeTypes: [1, 2] as RouteTypeValue[],
      scopes: ["#bc"],
    };
    expect(toServerFilter(filters)).toEqual({ payloadTypes: [4], routeTypes: [1, 2], scopes: ["#bc"] });
  });

  it("pushes observers and the selected search field server-side", () => {
    expect(toServerFilter({ ...EMPTY_FILTERS, observers: ["o1"] })).toEqual({ observers: ["o1"] });
    expect(toServerFilter({ ...EMPTY_FILTERS, search: " ab ", searchField: "payload" })).toEqual({
      search: "ab",
      searchField: "payload",
    });
  });
});

function routerAt(url: string) {
  return ({ children }: { children: ReactNode }) =>
    createElement(TestRouter, { initialEntry: url }, children);
}

describe("usePacketFilters — sf param", () => {
  it("accepts sf=hash", async () => {
    const { result } = renderHook(() => usePacketFilters(), { wrapper: routerAt("/?sf=hash") });
    await waitFor(() => expect(result.current?.filters.searchField).toBe("hash"));
  });

  it("accepts path and payload, but falls back to hash for unknown fields", async () => {
    for (const sf of ["path", "payload"] as const) {
      const { result } = renderHook(() => usePacketFilters(), { wrapper: routerAt(`/?sf=${sf}&q=ab`) });
      await waitFor(() => expect(result.current?.filters.searchField).toBe(sf));
    }
    const { result } = renderHook(() => usePacketFilters(), { wrapper: routerAt("/?sf=bogus&q=ab") });
    await waitFor(() => expect(result.current?.filters.searchField).toBe("hash"));
  });
});
