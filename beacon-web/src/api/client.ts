import { API_BASE, DEFAULT_PAGE_SIZE } from "../lib/constants";
import type { CursorPage, PacketSummary, PacketDetail, IataCode, RegionSummary, Region, BrokerStatus, KnownRoute, CrossIATARoute, TraceTagSummary, TraceType, TraceDetail } from "../types/api";
import type { ChannelSummary, ChannelMessage } from "../features/channels/types";
import type { ObserverSummary, Observer, AdvertObservation } from "../features/observers/types";
import type { NodeSummary, Node, NodeObservation, NodeNeighbor } from "../features/nodes/types";
import type {
  StatsOverview,
  ObservationPoint,
  PayloadBreakdownItem,
  TopNode,
  TopObserver,
  TopAdvertiser,
  TopTalker,
  RadioPreset,
  ScopeStats,
  ObserverTelemetry,
  NodeTypeCount,
  ClockDriftEntry,
} from "../features/stats/types";
import type { Feature, Polygon, MultiPolygon } from "geojson";
import {
  ApiError,
  rawGetBrokers,
  rawGetChannels,
  rawGetChannelsChannelIDMessages,
  rawGetIatas,
  rawGetNodes,
  rawGetNodesNodeId,
  rawGetNodesNodeIdNeighbors,
  rawGetNodesNodeIdObservations,
  rawGetObservers,
  rawGetObserversObserverId,
  rawGetObserversObserverIdAdverts,
  rawGetObserversObserverIdTelemetry,
  rawGetPackets,
  rawGetPacketsPacketHash,
  rawGetRegions,
  rawGetRegionsRegionId,
  rawGetRoutes,
  rawGetRoutesCross,
  rawGetRoutesSearch,
  rawGetScopes,
  rawGetStatsClockDrift,
  rawGetStatsNodeTypes,
  rawGetStatsObservations,
  rawGetStatsOverview,
  rawGetStatsPayloadBreakdown,
  rawGetStatsRadioPresets,
  rawGetStatsScopes,
  rawGetStatsTopAdvertisers,
  rawGetStatsTopNodes,
  rawGetStatsTopObservers,
  rawGetStatsTopTalkers,
  rawGetTraces,
  rawGetTracesTag,
} from "./generated/client";

export type IataBorder = Feature<Polygon | MultiPolygon>;

// The generated transport owns HTTP/error/query serialization. This module is the hand-written
// adapter boundary for app-specific CSV parameters, cursor wrappers, and GeoJSON 204 handling.

// endpoint functions

// The region filter travels as the comma-separated `iatas` param; undefined/empty means all regions.
function iatasParam(iatas?: string[]): string | undefined {
  return iatas && iatas.length > 0 ? iatas.join(",") : undefined;
}

export function getPackets(
  iatas: string[] | undefined,
  params?: { cursor?: number; limit?: number; payloadTypes?: number[]; routeTypes?: number[]; observers?: string[]; scopes?: string[]; search?: string; searchField?: "hash" | "path" | "payload"; includeResolvedPath?: boolean },
): Promise<CursorPage<PacketSummary>> {
  return rawGetPackets({
    iatas: iatasParam(iatas),
    cursor: params?.cursor,
    limit: params?.limit ?? DEFAULT_PAGE_SIZE,
    payloadTypes: params?.payloadTypes?.length ? params.payloadTypes.join(",") : undefined,
    routeTypes: params?.routeTypes?.length ? params.routeTypes.join(",") : undefined,
    observers: params?.observers?.length ? params.observers.join(",") : undefined,
    scopes: params?.scopes?.length ? params.scopes.join(",") : undefined,
    q: params?.search,
    searchField: params?.search ? params.searchField : undefined,
    include: params?.includeResolvedPath ? "resolvedPath" : undefined,
  }) as unknown as Promise<CursorPage<PacketSummary>>;
}

export function getPacketDetail(packetHash: string): Promise<PacketDetail> {
  return rawGetPacketsPacketHash({ packetHash }) as unknown as Promise<PacketDetail>;
}

export function getIatas(): Promise<IataCode[]> {
  return rawGetIatas() as unknown as Promise<IataCode[]>;
}

// An IATA's GeoJSON border, or null when none is configured. Can't use request(): the endpoint
// answers 204 (empty body) or a literal `null` for "no border", and request() always parses JSON.
export async function getIataBorder(iata: string): Promise<IataBorder | null> {
  const url = new URL(`${API_BASE}/iatas/${iata}/border`, window.location.origin);
  const res = await fetch(url.toString());
  if (res.status === 204) return null;
  if (!res.ok) throw new ApiError(res.status, "unknown", res.statusText);
  const body = await res.json();
  return (body ?? null) as IataBorder | null;
}

export function getRegions(): Promise<RegionSummary[]> {
  return rawGetRegions() as unknown as Promise<RegionSummary[]>;
}

export function getRegion(regionId: number): Promise<Region> {
  return rawGetRegionsRegionId({ regionId }) as unknown as Promise<Region>;
}

// /channels only honors a singular `iata`, so a one-IATA region goes through it; multi-IATA regions
// still send `iatas` (ignored server-side, effectively global) until the backend supports it.
export async function getChannels(params?: { iatas?: string[]; limit?: number }): Promise<ChannelSummary[]> {
  const iatas = params?.iatas ?? [];
  const page = await rawGetChannels({
    iata: iatas.length === 1 ? iatas[0] : undefined,
    iatas: iatas.length > 1 ? iatasParam(iatas) : undefined,
    limit: params?.limit,
  }) as unknown as { items: ChannelSummary[] };
  return page.items;
}

// Channel messages come back as { items } ordered id DESC, so the last row is the page's oldest
// (smallest) id — the cursor for the next, older batch (the backend pages by id < cursor). Wrapped into
// a CursorPage so MessagePanel can load older history on demand via useInfiniteQuery.
export async function getChannelMessagesPage(
  channelId: number,
  params?: { iatas?: string[]; cursor?: number; limit?: number },
): Promise<CursorPage<ChannelMessage>> {
  const limit = params?.limit ?? DEFAULT_PAGE_SIZE;
  const page = await rawGetChannelsChannelIDMessages({
    channelID: channelId,
    iatas: iatasParam(params?.iatas),
    cursor: params?.cursor,
    limit,
  }) as unknown as { items: ChannelMessage[] };
  return toCursorPage(page.items, limit, (m) => m.id);
}

export function getBrokers(): Promise<BrokerStatus[]> {
  return rawGetBrokers() as unknown as Promise<BrokerStatus[]>;
}

// The authoritative list of configured transport scope names (e.g. "#bc", "#west"), used to populate
// the scope filter dropdowns. The no-param /scopes endpoint returns the names directly.
export function getScopes(): Promise<string[]> {
  return rawGetScopes({}) as unknown as Promise<string[]>;
}

// Wrap a bare-array endpoint into a CursorPage so it can drive the cursor-paginated hooks. A page that
// fills the limit may have more behind it; the next cursor is the last (boundary) row's sort key.
function toCursorPage<T>(items: T[], limit: number, cursorOf: (last: T) => number): CursorPage<T> {
  const hasMore = items.length === limit;
  return { items, nextCursor: hasMore ? cursorOf(items[items.length - 1]!) : null, hasMore };
}

// Known routes use an opaque keyset cursor bound to the requested backend ordering.
export async function getKnownRoutesPage(
  params?: { iatas?: string[]; hopCount?: number; pageToken?: string; sort?: string; direction?: "asc" | "desc"; limit?: number },
): Promise<CursorPage<KnownRoute>> {
  return rawGetRoutes({
    iatas: iatasParam(params?.iatas),
    hopCount: params?.hopCount,
    pageToken: params?.pageToken,
    sort: params?.sort,
    direction: params?.direction,
    limit: params?.limit ?? DEFAULT_PAGE_SIZE,
  }) as unknown as Promise<CursorPage<KnownRoute>>;
}

// Search known routes for a path between two node hash prefixes within a single IATA. All three params
// are required by the server.
export function searchKnownRoutes(iata: string, from: string, to: string): Promise<KnownRoute[]> {
  return rawGetRoutesSearch({ iata, from, to }) as unknown as Promise<KnownRoute[]>;
}

// Search routes that cross IATA boundaries, from a hash in one IATA to a hash in another. All four
// params are required by the server.
export function searchCrossIATARoutes(
  fromHash: string,
  fromIata: string,
  toHash: string,
  toIata: string,
): Promise<CrossIATARoute[]> {
  return rawGetRoutesCross({ fromHash, fromIata, toHash, toIata }) as unknown as Promise<CrossIATARoute[]>;
}

// Trace tags. /traces returns a bare array of per-tag summaries (ordered newest-heard first, cursor is
// the last item's lastHeardAt); /traces/{tag} returns the tag's packets with resolved routes.
export function getTraces(
  iatas: string[] | undefined,
  params?: { scope?: string; type?: TraceType; since?: number; until?: number; cursor?: number; limit?: number },
): Promise<TraceTagSummary[]> {
  return rawGetTraces({
    iatas: iatasParam(iatas),
    scope: params?.scope,
    type: params?.type,
    since: params?.since,
    until: params?.until,
    cursor: params?.cursor,
    limit: params?.limit,
  }) as unknown as Promise<TraceTagSummary[]>;
}

export function getTraceDetail(tag: string): Promise<TraceDetail> {
  return rawGetTracesTag({ tag }) as unknown as Promise<TraceDetail>;
}

export function getObserver(observerId: string): Promise<Observer> {
  return rawGetObserversObserverId({ observerId }) as unknown as Promise<Observer>;
}

export function getObserverAdverts(
  observerId: string,
  params?: { cursor?: number; limit?: number },
): Promise<CursorPage<AdvertObservation>> {
  return rawGetObserversObserverIdAdverts({
    observerId,
    cursor: params?.cursor,
    limit: params?.limit ?? DEFAULT_PAGE_SIZE,
  }) as unknown as Promise<CursorPage<AdvertObservation>>;
}

// Paginated /nodes: returns the full cursor page so the caller can chain pages (cursor = the last
// node's lastSeen). Used by the map (iatas only) and the Nodes table (with its server-side filters).
export function getNodesPage(
  iatas: string[] | undefined,
  params?: {
    cursor?: number;
    pageToken?: string;
    limit?: number;
    sort?: string;
    direction?: "asc" | "desc";
    type?: string;
    name?: string;
    pubkeyPrefix?: string; // case-insensitive hex prefix; server matches and validates
    supportsMultibytePaths?: "true" | "false";
    supportsMultibyteTraces?: "true" | "false";
    scope?: string;
    neighbors?: boolean; // include each node's neighborIds (?neighbors=true)
  },
): Promise<CursorPage<NodeSummary>> {
  return rawGetNodes({
    iatas: iatasParam(iatas),
    cursor: params?.cursor,
    pageToken: params?.pageToken,
    limit: params?.limit ?? DEFAULT_PAGE_SIZE,
    sort: params?.sort,
    direction: params?.direction,
    typeName: params?.type,
    name: params?.name,
    pubkeyPrefix: params?.pubkeyPrefix,
    supportsMultibytePaths: params?.supportsMultibytePaths === "true" ? true : params?.supportsMultibytePaths === "false" ? false : undefined,
    supportsMultibyteTraces: params?.supportsMultibyteTraces === "true" ? true : params?.supportsMultibyteTraces === "false" ? false : undefined,
    scope: params?.scope,
    neighbors: params?.neighbors || undefined,
  }) as unknown as Promise<CursorPage<NodeSummary>>;
}

// Paginated /observers, mirroring getNodesPage; used by the Observers table.
export function getObserversPage(
  iatas: string[] | undefined,
  params?: {
    cursor?: number;
    pageToken?: string;
    limit?: number;
    sort?: string;
    direction?: "asc" | "desc";
    type?: string;
    broker?: string;
    status?: string;
    name?: string;
    scope?: string;
  },
): Promise<CursorPage<ObserverSummary>> {
  return rawGetObservers({
    iatas: iatasParam(iatas),
    cursor: params?.cursor,
    pageToken: params?.pageToken,
    limit: params?.limit ?? DEFAULT_PAGE_SIZE,
    sort: params?.sort,
    direction: params?.direction,
    type: params?.type,
    broker: params?.broker,
    status: params?.status,
    name: params?.name,
    scope: params?.scope,
  }) as unknown as Promise<CursorPage<ObserverSummary>>;
}

export function getNode(nodeId: string): Promise<Node> {
  return rawGetNodesNodeId({ nodeId }) as unknown as Promise<Node>;
}

export function getNodeObservations(
  nodeId: string,
  params?: { cursor?: number; limit?: number },
): Promise<CursorPage<NodeObservation>> {
  return rawGetNodesNodeIdObservations({
    nodeId,
    cursor: params?.cursor,
    limit: params?.limit ?? DEFAULT_PAGE_SIZE,
  }) as unknown as Promise<CursorPage<NodeObservation>>;
}

export function getNodeNeighbors(nodeId: string): Promise<NodeNeighbor[]> {
  return rawGetNodesNodeIdNeighbors({ nodeId }) as unknown as Promise<NodeNeighbor[]>;
}

// stats endpoints

export function getStatsOverview(iatas?: string[]): Promise<StatsOverview> {
  return rawGetStatsOverview({ iatas: iatasParam(iatas) }) as unknown as Promise<StatsOverview>;
}

export function getStatsObservations(iatas?: string[], since?: number): Promise<ObservationPoint[]> {
  return rawGetStatsObservations({ iatas: iatasParam(iatas), since }) as unknown as Promise<ObservationPoint[]>;
}

export function getPayloadBreakdown(iatas?: string[], since?: number): Promise<PayloadBreakdownItem[]> {
  return rawGetStatsPayloadBreakdown({ iatas: iatasParam(iatas), since }) as unknown as Promise<PayloadBreakdownItem[]>;
}

export function getTopNodes(iatas?: string[], limit = 10): Promise<TopNode[]> {
  return rawGetStatsTopNodes({ iatas: iatasParam(iatas), limit }) as unknown as Promise<TopNode[]>;
}

export function getTopObservers(iatas?: string[], since?: number, limit = 10): Promise<TopObserver[]> {
  return rawGetStatsTopObservers({ iatas: iatasParam(iatas), since, limit }) as unknown as Promise<TopObserver[]>;
}

export function getTopAdvertisers(iatas?: string[], since?: number, limit = 10): Promise<TopAdvertiser[]> {
  return rawGetStatsTopAdvertisers({ iatas: iatasParam(iatas), since, limit }) as unknown as Promise<TopAdvertiser[]>;
}

export function getTopTalkers(iatas?: string[], since?: number, limit = 10): Promise<TopTalker[]> {
  return rawGetStatsTopTalkers({ iatas: iatasParam(iatas), since, limit }) as unknown as Promise<TopTalker[]>;
}

export function getRadioPresets(iatas?: string[]): Promise<RadioPreset[]> {
  return rawGetStatsRadioPresets({ iatas: iatasParam(iatas) }) as unknown as Promise<RadioPreset[]>;
}

export function getStatsNodeTypes(iatas?: string[]): Promise<NodeTypeCount[]> {
  return rawGetStatsNodeTypes({ iatas: iatasParam(iatas) }) as unknown as Promise<NodeTypeCount[]>;
}

// Repeaters/room servers whose clock has drifted past the server threshold, worst-first. Not
// time-windowed and top-N only (no cursor), so callers pass a generous limit and page client-side.
export function getClockDrift(iatas?: string[], limit = 100): Promise<ClockDriftEntry[]> {
  return rawGetStatsClockDrift({ iatas: iatasParam(iatas), limit }) as unknown as Promise<ClockDriftEntry[]>;
}

// renamed from getScopes to avoid colliding with the /scopes name list; this is the /stats/scopes
// aggregate (packet/observer/node counts), reported globally regardless of the active region.
export function getStatsScopes(): Promise<ScopeStats[]> {
  return rawGetStatsScopes() as unknown as Promise<ScopeStats[]>;
}

export function getObserverTelemetry(
  observerId: string,
  range: string,
  interval?: string,
  afterId?: number,
): Promise<ObserverTelemetry> {
  return rawGetObserversObserverIdTelemetry({ observerId, range, interval, afterId }) as unknown as Promise<ObserverTelemetry>;
}

export { ApiError };
