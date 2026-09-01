// Centralized TanStack Query contracts: one factory object per domain, so query keys, query
// functions and stable configuration live in exactly one place. Components consume these via
// useQuery/useInfiniteQuery and through queryClient set/invalidate/reset operations — no raw
// key arrays outside this file.
//
// Factories are pure functions over their filter/id arguments (no React hooks), so they are
// equally usable inside hooks, components and imperative QueryClient calls. Runtime-dependent
// options (enabled, keepPreviousData, select) stay at the call site unless every consumer
// shares them. Paginated factories are fully generic-annotated so their InfiniteData contract
// is explicit and the shared useInfinitePages hook can accept them structurally.

import {
  infiniteQueryOptions,
  keepPreviousData,
  queryOptions,
} from "@tanstack/react-query";
import type {
  InfiniteData,
  QueryKey,
  UseInfiniteQueryOptions,
} from "@tanstack/react-query";
import {
  getBrokers,
  getChannels,
  getChannelMessagesPage,
  getClockDrift,
  getIatas,
  getIataBorder,
  getNode,
  getNodeNeighbors,
  getNodeObservations,
  getNodesPage,
  getObserver,
  getObserverAdverts,
  getObserverTelemetry,
  getObserversPage,
  getPacketDetail,
  getPackets,
  getPayloadBreakdown,
  getRadioPresets,
  getRegions,
  getRegion,
  getScopes,
  getStatsNodeTypes,
  getStatsObservations,
  getStatsOverview,
  getStatsScopes,
  getTopAdvertisers,
  getTopNodes,
  getTopObservers,
  getTopTalkers,
  getTraceDetail,
  getTraces,
  getKnownRoutesPage,
  searchCrossIATARoutes,
  searchKnownRoutes,
} from "./client";
import type { CursorPage, PacketSummary, TraceType } from "../types/api";
import type { ChannelMessage } from "../features/channels/types";
import type { ObserverSummary } from "../features/observers/types";
import type { NodeSummary } from "../features/nodes/types";
import type { KnownRoute } from "../types/api";
import type { StatsRange } from "../features/stats/types";
import type { PacketServerFilter } from "../features/packets/types";

// Cursor-paginated options contract shared by useInfinitePages consumers. TData is pinned to
// InfiniteData (no select transforms inside factories — callers add select at the hook site).
type PagedOptions<T, TPageParam = number | undefined> = UseInfiniteQueryOptions<
  CursorPage<T>,
  Error,
  InfiniteData<CursorPage<T>>,
  QueryKey,
  TPageParam
>;

type SortablePageParam = string | number | undefined;

// ── regions ──────────────────────────────────────────────────────────────────────────────────
// The loader expands each summary into its full detail (member IATAs + map-focus hints) in one
// query — regions are near-static, so the combined result caches long and is shared app-wide.

export const regionQueries = {
  all: () => ["regions"] as const,
  list: () =>
    queryOptions({
      queryKey: regionQueries.all(),
      queryFn: async () => {
        const summaries = await getRegions();
        return Promise.all(summaries.map((s) => getRegion(s.id)));
      },
      staleTime: 5 * 60_000,
    }),
};

// ── iatas + borders ──────────────────────────────────────────────────────────────────────────

export const iataQueries = {
  all: () => ["iatas"] as const,
  list: () =>
    queryOptions({
      queryKey: iataQueries.all(),
      queryFn: getIatas,
      staleTime: 5 * 60_000,
    }),
  border: (iata: string) =>
    queryOptions({
      queryKey: ["iata-border", iata] as const,
      queryFn: () => getIataBorder(iata),
    }),
};

// ── scopes + brokers ─────────────────────────────────────────────────────────────────────────

export const scopeQueries = {
  all: () => ["scopes"] as const,
  list: () =>
    queryOptions({
      queryKey: scopeQueries.all(),
      queryFn: getScopes,
      staleTime: 5 * 60_000,
    }),
};

export const brokerQueries = {
  all: () => ["brokers"] as const,
  list: () =>
    queryOptions({
      queryKey: brokerQueries.all(),
      queryFn: getBrokers,
      staleTime: 60_000,
    }),
};

// ── nodes ────────────────────────────────────────────────────────────────────────────────────

export interface NodeListFilters {
  regionKey: string;
  iatas?: string[];
  type?: string;
  name?: string;
  pubkeyPrefix?: string;
  supportsMultibytePaths?: "true" | "false";
  supportsMultibyteTraces?: "true" | "false";
  scope?: string;
  sort?: "name" | "type" | "radio" | "neighbors" | "last_seen";
  direction?: "asc" | "desc";
}

// Key shape matters: the unfiltered 2-element prefix is what cache resets match by prefix, and
// WS patches write through the full filtered key. Keep element order stable.
function nodeListKey(f: NodeListFilters) {
  return [
    "nodes",
    f.regionKey,
    f.type ?? "",
    f.supportsMultibytePaths ?? "",
    f.supportsMultibyteTraces ?? "",
    f.name ?? "",
    f.pubkeyPrefix ?? "",
    f.scope ?? "",
    f.sort ?? "name",
    f.direction ?? "asc",
  ] as const;
}

export const nodeQueries = {
  all: () => ["nodes"] as const,
  // Map variant: always requests neighborIds so the neighbor-lines toggle is a pure client-side
  // render switch. Deliberately a different key from the filtered Nodes-table list.
  mapList: (args: {
    regionKey: string;
    iatas?: string[];
  }): PagedOptions<NodeSummary, SortablePageParam> =>
    infiniteQueryOptions<
      CursorPage<NodeSummary>,
      Error,
      InfiniteData<CursorPage<NodeSummary>>,
      QueryKey,
      SortablePageParam
    >({
      queryKey: ["map-nodes", args.regionKey] as const,
      queryFn: ({ pageParam }) =>
        getNodesPage(args.iatas, {
          cursor: typeof pageParam === "number" ? pageParam : undefined,
          pageToken: typeof pageParam === "string" ? pageParam : undefined,
          sort: "last_seen",
          direction: "desc",
          neighbors: true,
        }),
      getNextPageParam: (last) => last.nextPageToken ?? last.nextCursor ?? undefined,
      initialPageParam: undefined,
      staleTime: 60_000,
    }),
  list: (f: NodeListFilters): PagedOptions<NodeSummary, SortablePageParam> =>
    infiniteQueryOptions<
      CursorPage<NodeSummary>,
      Error,
      InfiniteData<CursorPage<NodeSummary>>,
      QueryKey,
      SortablePageParam
    >({
      queryKey: nodeListKey(f),
      queryFn: ({ pageParam }) =>
        getNodesPage(f.iatas, {
          cursor: typeof pageParam === "number" ? pageParam : undefined,
          pageToken: typeof pageParam === "string" ? pageParam : undefined,
          sort: f.sort ?? "name",
          direction: f.direction ?? "asc",
          type: f.type || undefined,
          name: f.name || undefined,
          pubkeyPrefix: f.pubkeyPrefix || undefined,
          supportsMultibytePaths: f.supportsMultibytePaths || undefined,
          supportsMultibyteTraces: f.supportsMultibyteTraces || undefined,
          scope: f.scope || undefined,
        }),
      getNextPageParam: (last) => last.nextPageToken ?? last.nextCursor ?? undefined,
      initialPageParam: undefined,
      staleTime: 60_000,
    }),
  detail: (id: string) =>
    queryOptions({
      queryKey: ["node", id] as const,
      queryFn: () => getNode(id),
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    }),
  observations: (id: string) =>
    queryOptions({
      queryKey: ["node-observations", id] as const,
      queryFn: () => getNodeObservations(id, { limit: 50 }),
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    }),
  neighbors: (id: string) =>
    queryOptions({
      queryKey: ["node-neighbors", id] as const,
      queryFn: () => getNodeNeighbors(id),
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    }),
};

// ── observers ────────────────────────────────────────────────────────────────────────────────

export interface ObserverListFilters {
  regionKey: string;
  iatas?: string[];
  status?: string;
  type?: string;
  broker?: string;
  name?: string;
  searchField?: string;
  scope?: string;
  sort?: "name" | "type" | "radio" | "iata" | "status" | "last_seen";
  direction?: "asc" | "desc";
}

function observerListKey(f: ObserverListFilters) {
  return [
    "observers",
    f.regionKey,
    f.status ?? "",
    f.type ?? "",
    f.broker ?? "",
    f.name ?? "",
    f.searchField ?? "",
    f.scope ?? "",
    f.sort ?? "name",
    f.direction ?? "asc",
  ] as const;
}

export const observerQueries = {
  all: () => ["observers"] as const,
  list: (f: ObserverListFilters): PagedOptions<ObserverSummary, SortablePageParam> =>
    infiniteQueryOptions<
      CursorPage<ObserverSummary>,
      Error,
      InfiniteData<CursorPage<ObserverSummary>>,
      QueryKey,
      SortablePageParam
    >({
      queryKey: observerListKey(f),
      queryFn: ({ pageParam }) =>
        getObserversPage(f.iatas, {
          cursor: typeof pageParam === "number" ? pageParam : undefined,
          pageToken: typeof pageParam === "string" ? pageParam : undefined,
          sort: f.sort ?? "name",
          direction: f.direction ?? "asc",
          status: f.status || undefined,
          type: f.type || undefined,
          broker: f.broker || undefined,
          name: f.searchField === "name" ? f.name || undefined : undefined,
          scope: f.scope || undefined,
        }),
      getNextPageParam: (last) => last.nextPageToken ?? last.nextCursor ?? undefined,
      initialPageParam: undefined,
      staleTime: 60_000,
    }),
  detail: (id: string) =>
    queryOptions({
      queryKey: ["observer", id] as const,
      queryFn: () => getObserver(id),
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    }),
  adverts: (id: string) =>
    queryOptions({
      queryKey: ["observer-adverts", id] as const,
      queryFn: () => getObserverAdverts(id, { limit: 50 }),
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    }),
};

// ── observer telemetry ───────────────────────────────────────────────────────────────────────
// Go time.ParseDuration strings the telemetry endpoint expects, per selected range — kept next
// to the factory so the cache key and the request always agree.

const TELEMETRY_RANGE_PARAM: Record<StatsRange, string> = {
  "24h": "24h",
  "7d": "168h",
  "30d": "720h",
};
const TELEMETRY_INTERVAL_PARAM: Record<StatsRange, string> = {
  "24h": "1h",
  "7d": "6h",
  "30d": "24h",
};

export const telemetryQueries = {
  detail: (id: string) => observerQueries.detail(id),
  range: (id: string, range: StatsRange) =>
    queryOptions({
      queryKey: [
        "observer-telemetry",
        id,
        range,
        TELEMETRY_INTERVAL_PARAM[range],
      ] as const,
      queryFn: () =>
        getObserverTelemetry(
          id,
          TELEMETRY_RANGE_PARAM[range],
          TELEMETRY_INTERVAL_PARAM[range],
        ),
      enabled: !!id,
      staleTime: 30_000,
      placeholderData: keepPreviousData,
      refetchOnWindowFocus: false,
    }),
};

// ── packets ──────────────────────────────────────────────────────────────────────────────────

export const packetQueries = {
  all: () => ["packets"] as const,
  // 2-element key when unfiltered (cache survives filter toggling; prefix resets match both shapes)
  list: (args: {
    regionKey: string;
    iatas?: string[];
    filter?: PacketServerFilter | null;
  }): PagedOptions<PacketSummary> =>
    infiniteQueryOptions<
      CursorPage<PacketSummary>,
      Error,
      InfiniteData<CursorPage<PacketSummary>>,
      QueryKey,
      number | undefined
    >({
      queryKey: args.filter
        ? (["packets", args.regionKey, args.filter] as const)
        : (["packets", args.regionKey] as const),
      queryFn: ({ pageParam }) =>
        getPackets(args.iatas, { cursor: pageParam, ...(args.filter ?? {}), includeResolvedPath: true }),
      getNextPageParam: (last) => last.nextCursor ?? undefined,
      initialPageParam: undefined,
      staleTime: 15_000,
      maxPages: 20,
    }),
  detail: (hash: string | null) =>
    queryOptions({
      queryKey: ["packet-detail", hash] as const,
      queryFn: () => getPacketDetail(hash!),
      enabled: !!hash,
      // PacketList and the expansion mount in succession for a cold deep-link. Keep that one
      // response fresh briefly so both consumers share it instead of issuing identical requests;
      // incoming observations still invalidate the query immediately.
      staleTime: 5_000,
    }),
};

// ── channels ─────────────────────────────────────────────────────────────────────────────────

export const channelQueries = {
  all: () => ["channels"] as const,
  list: (args: { regionKey: string; iatas?: string[] }) =>
    queryOptions({
      queryKey: ["channels", args.regionKey] as const,
      queryFn: () => getChannels({ iatas: args.iatas }),
      staleTime: 60_000,
    }),
  messages: (args: {
    channelId: number | undefined;
    regionKey: string;
    iatas?: string[];
  }): PagedOptions<ChannelMessage> =>
    infiniteQueryOptions<
      CursorPage<ChannelMessage>,
      Error,
      InfiniteData<CursorPage<ChannelMessage>>,
      QueryKey,
      number | undefined
    >({
      queryKey: ["channel-messages", args.channelId, args.regionKey] as const,
      queryFn: ({ pageParam }) => {
        if (args.channelId === undefined) {
          return Promise.resolve({
            items: [],
            nextCursor: null,
            hasMore: false,
          });
        }
        return getChannelMessagesPage(args.channelId, {
          iatas: args.iatas,
          cursor: pageParam,
        });
      },
      getNextPageParam: (last) => last.nextCursor ?? undefined,
      initialPageParam: undefined,
      enabled: args.channelId !== undefined,
    }),
};

// ── known routes ─────────────────────────────────────────────────────────────────────────────

export const routeQueries = {
  all: () => ["routes"] as const,
  list: (args: { iatas?: string[]; hopCount?: number; sort: string; direction: "asc" | "desc" }): PagedOptions<KnownRoute, string | undefined> =>
    infiniteQueryOptions<
      CursorPage<KnownRoute>,
      Error,
      InfiniteData<CursorPage<KnownRoute>>,
      QueryKey,
      string | undefined
    >({
      queryKey: ["routes", args.iatas?.slice().sort().join(",") ?? "", args.hopCount ?? "", args.sort, args.direction] as const,
      queryFn: ({ pageParam }) =>
        getKnownRoutesPage({
          iatas: args.iatas,
          hopCount: args.hopCount,
          pageToken: pageParam,
          sort: args.sort,
          direction: args.direction,
        }),
      getNextPageParam: (last) => last.nextPageToken ?? undefined,
      initialPageParam: undefined,
      staleTime: Infinity,
    }),
  search: (args: { iata: string; from: string; to: string } | null) =>
    queryOptions({
      queryKey: ["routes-search", args?.iata, args?.from, args?.to] as const,
      queryFn: () => searchKnownRoutes(args!.iata, args!.from, args!.to),
      enabled: args !== null,
      staleTime: 60_000,
    }),
  // Cross-IATA search fans out over every directed (from, to) IATA pair — we don't know which
  // region holds the source vs destination hash, so all directions are tried and flattened.
  cross: (args: { iatas: string[]; fromHash: string; toHash: string } | null) =>
    queryOptions({
      queryKey: [
        "routes-cross",
        args ? args.iatas.slice().sort().join(",") : null,
        args?.fromHash,
        args?.toHash,
      ] as const,
      queryFn: async () => {
        const pairs: [string, string][] = [];
        for (const a of args!.iatas) {
          for (const b of args!.iatas) {
            if (a !== b) pairs.push([a, b]);
          }
        }
        const results = await Promise.all(
          pairs.map(([fromIata, toIata]) =>
            searchCrossIATARoutes(
              args!.fromHash,
              fromIata,
              args!.toHash,
              toIata,
            ),
          ),
        );
        return results.flat();
      },
      enabled: args !== null,
      staleTime: 60_000,
    }),
};

// ── traces ───────────────────────────────────────────────────────────────────────────────────

export const traceQueries = {
  all: () => ["traces"] as const,
  list: (args: {
    regionKey: string;
    iatas?: string[];
    type?: string;
    limit?: number;
  }) =>
    queryOptions({
      queryKey: ["traces", args.regionKey, args.type ?? ""] as const,
      queryFn: () =>
        getTraces(args.iatas, {
          limit: args.limit,
          type: (args.type || undefined) as TraceType | undefined,
        }),
      staleTime: 30_000,
    }),
  detail: (tag: string) =>
    queryOptions({
      queryKey: ["trace", tag] as const,
      queryFn: () => getTraceDetail(tag),
      staleTime: 30_000,
    }),
};

// ── stats ────────────────────────────────────────────────────────────────────────────────────
// Shared cache policy: 30s stale, keep previous data so region/range switches don't flash.
// `since` is computed inside queryFn so refetches use a fresh window without churning the key.

const statsCommon = {
  staleTime: 30_000,
  refetchOnWindowFocus: false,
  placeholderData: keepPreviousData,
} as const;

const RANGE_MS_VALUES: Record<StatsRange, number> = {
  "24h": 24 * 60 * 60_000,
  "7d": 7 * 24 * 60 * 60_000,
  "30d": 30 * 24 * 60 * 60_000,
};

const sinceFor = (range: StatsRange) => Date.now() - RANGE_MS_VALUES[range];

export const statsQueries = {
  all: () => ["stats"] as const,
  overview: (regionKey: string, iatas?: string[]) =>
    queryOptions({
      queryKey: ["stats-overview", regionKey] as const,
      queryFn: () => getStatsOverview(iatas),
      ...statsCommon,
      // self-correct the WS-accumulated live counters against the server
      refetchInterval: 60_000,
    }),
  observations: (
    regionKey: string,
    iatas: string[] | undefined,
    range: StatsRange,
  ) =>
    queryOptions({
      queryKey: ["stats-observations", regionKey, range] as const,
      queryFn: () => getStatsObservations(iatas, sinceFor(range)),
      ...statsCommon,
      // feeds the observations chart + sparklines and gets no WS bumps, so refetch to stay fresh
      refetchInterval: 60_000,
    }),
  payloadBreakdown: (
    regionKey: string,
    iatas: string[] | undefined,
    range: StatsRange,
  ) =>
    queryOptions({
      queryKey: ["stats-payload", regionKey, range] as const,
      queryFn: () => getPayloadBreakdown(iatas, sinceFor(range)),
      ...statsCommon,
    }),
  topNodes: (regionKey: string, iatas: string[] | undefined, limit = 10) =>
    queryOptions({
      queryKey: ["stats-top-nodes", regionKey, limit] as const,
      queryFn: () => getTopNodes(iatas, limit),
      ...statsCommon,
    }),
  topObservers: (
    regionKey: string,
    iatas: string[] | undefined,
    range: StatsRange,
    limit = 10,
  ) =>
    queryOptions({
      queryKey: ["stats-top-observers", regionKey, range, limit] as const,
      queryFn: () => getTopObservers(iatas, sinceFor(range), limit),
      ...statsCommon,
    }),
  topAdvertisers: (
    regionKey: string,
    iatas: string[] | undefined,
    range: StatsRange,
    limit = 10,
  ) =>
    queryOptions({
      queryKey: ["stats-top-advertisers", regionKey, range, limit] as const,
      queryFn: () => getTopAdvertisers(iatas, sinceFor(range), limit),
      ...statsCommon,
    }),
  topTalkers: (
    regionKey: string,
    iatas: string[] | undefined,
    range: StatsRange,
    limit = 10,
  ) =>
    queryOptions({
      queryKey: ["stats-top-talkers", regionKey, range, limit] as const,
      queryFn: () => getTopTalkers(iatas, sinceFor(range), limit),
      ...statsCommon,
    }),
  radioPresets: (regionKey: string, iatas?: string[]) =>
    queryOptions({
      queryKey: ["stats-radio-presets", regionKey] as const,
      queryFn: () => getRadioPresets(iatas),
      ...statsCommon,
    }),
  // node-types is a population census (no time window), so the key is region-only
  nodeTypes: (regionKey: string, iatas?: string[]) =>
    queryOptions({
      queryKey: ["stats-node-types", regionKey] as const,
      queryFn: () => getStatsNodeTypes(iatas),
      ...statsCommon,
    }),
  // clock drift reflects each node's latest measured drift, not a windowed aggregate, so region-only
  clockDrift: (regionKey: string, iatas?: string[], limit = 100) =>
    queryOptions({
      queryKey: ["stats-clock-drift", regionKey, limit] as const,
      queryFn: () => getClockDrift(iatas, limit),
      ...statsCommon,
    }),
  // scopes are reported globally by the backend (no region filter), so the key is region-independent
  scopes: () =>
    queryOptions({
      queryKey: ["stats-scopes"] as const,
      queryFn: getStatsScopes,
      ...statsCommon,
    }),
  observerSearch: (args: { regionKey: string; iatas?: string[]; q: string }) =>
    queryOptions({
      queryKey: ["observer-search", args.regionKey, args.q] as const,
      queryFn: () => getObserversPage(args.iatas, { name: args.q, limit: 50 }),
      staleTime: 30_000,
      placeholderData: keepPreviousData,
    }),
};
