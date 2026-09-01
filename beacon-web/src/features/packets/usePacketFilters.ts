import { useCallback } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import type {
  PacketFilterState,
  PacketServerFilter,
  SearchField,
} from "./types";
import type { PacketSummary } from "../../types/api";
import type { PayloadTypeValue, RouteTypeValue } from "../../types/enums";

// Packet filter state synced to the /packets route search params (?types/?routes/?obs/?scope/?q/?sf).
// The params themselves are validated on the ROOT route so they survive tab switches; this hook is
// the typed reader/writer the filter bar uses.

export function usePacketFilters() {
  // The validated root search carries the URL-param keys (types/routes/obs/scope/q/sf); the hook
  // maps them onto the domain-shaped PacketFilterState the rest of the feature consumes.
  const search = useSearch({ from: "__root__" });
  const navigate = useNavigate();

  const filters: PacketFilterState = {
    payloadTypes: (search.types ?? []) as PacketFilterState["payloadTypes"],
    routeTypes: (search.routes ?? []) as PacketFilterState["routeTypes"],
    observers: search.obs ?? [],
    scopes: search.scope ?? [],
    search: search.q ?? "",
    searchField:
      search.sf === "path" || search.sf === "payload" ? search.sf : "hash",
  };

  const patch = useCallback(
    (
      updates: Partial<
        Record<
          "types" | "routes" | "obs" | "scope" | "q" | "sf",
          string | number[] | string[] | SearchField | undefined
        >
      >,
    ) => {
      navigate({
        to: ".",
        search: (prev: Record<string, unknown>) => {
          const next = { ...prev };
          for (const [key, value] of Object.entries(updates)) {
            if (
              value == null ||
              value === "" ||
              (Array.isArray(value) && value.length === 0)
            ) {
              next[key] = undefined;
            } else {
              next[key] = value;
            }
          }
          return next;
        },
        replace: true,
      });
    },
    [navigate],
  );

  const setFilter = useCallback(
    (
      key: "payloadTypes" | "routeTypes" | "observers" | "scopes",
      values: (number | string)[],
    ) => {
      const paramKey =
        key === "payloadTypes"
          ? "types"
          : key === "routeTypes"
            ? "routes"
            : key === "observers"
              ? "obs"
              : "scope";
      patch({ [paramKey]: values });
    },
    [patch],
  );

  const setSearch = useCallback(
    (query: string) => patch({ q: query }),
    [patch],
  );

  const setSearchField = useCallback(
    (field: SearchField) => patch({ sf: field === "hash" ? undefined : field }),
    [patch],
  );

  const clearFilters = useCallback(
    () =>
      patch({
        types: [],
        routes: [],
        obs: [],
        scope: [],
        q: "",
        sf: undefined,
      }),
    [patch],
  );

  return { filters, setFilter, setSearch, setSearchField, clearFilters };
}

// Every packet filter is sent to /packets so pagination always traverses the matching history instead
// of filtering a partial client-side page. The predicate below is retained for live WS summaries.
export function toServerFilter(
  filters: PacketFilterState,
): PacketServerFilter | null {
  const serverFilter: PacketServerFilter = {};
  if (filters.payloadTypes.length > 0)
    serverFilter.payloadTypes = filters.payloadTypes;
  if (filters.routeTypes.length > 0)
    serverFilter.routeTypes = filters.routeTypes;
  if (filters.observers.length > 0)
    serverFilter.observers = filters.observers;
  if (filters.scopes.length > 0) serverFilter.scopes = filters.scopes;
  const search = filters.search.trim();
  if (search) {
    serverFilter.search = search;
    serverFilter.searchField = filters.searchField;
  }
  return Object.keys(serverFilter).length > 0 ? serverFilter : null;
}

// client-side filter predicate for packet rows

export function matchesFilters(
  packet: PacketSummary,
  filters: PacketFilterState,
  observersByHash?: ReadonlyMap<string, ReadonlySet<string>>,
): boolean {
  if (
    filters.payloadTypes.length > 0 &&
    !filters.payloadTypes.includes(packet.payloadType as PayloadTypeValue)
  ) {
    return false;
  }
  if (
    filters.routeTypes.length > 0 &&
    !filters.routeTypes.includes(packet.routeType as RouteTypeValue)
  ) {
    return false;
  }
  if (filters.observers.length > 0) {
    const known = observersByHash?.get(packet.packetHash);
    const match = known
      ? filters.observers.some((id) => known.has(id))
      : packet.latestObserver
        ? filters.observers.includes(packet.latestObserver.id)
        : false;
    if (!match) return false;
  }
  if (
    filters.scopes.length > 0 &&
    (!packet.scope || !filters.scopes.includes(packet.scope))
  ) {
    return false;
  }
  if (filters.search && filters.searchField === "hash") {
    const q = filters.search.toLowerCase().replace(/[\s:-]/g, "");
    if (!packet.packetHash.toLowerCase().includes(q)) {
      return false;
    }
  }
  return true;
}
