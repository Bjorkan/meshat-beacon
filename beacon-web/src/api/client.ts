import { API_BASE, DEFAULT_PAGE_SIZE } from '../lib/constants';
import type {
  CursorPage,
  PacketSummary,
  PacketDetail,
  IataCode,
  RegionSummary,
  Region,
  BrokerStatus,
  KnownRoute,
  CrossIATARoute,
  BestRouteResult,
  TraceTagSummary,
  TraceType,
  TraceDetail,
} from '../types/api';
import type { ChannelPage, ChannelSummary, ChannelMessage } from '../features/channels/types';
import type { ObserverSummary, Observer, AdvertObservation } from '../features/observers/types';
import type { NodeSummary, Node, NodeObservation, NodeNeighbor } from '../features/nodes/types';
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
} from '../features/stats/types';
import type { Feature, Polygon, MultiPolygon } from 'geojson';
import type * as Models from './generated/models';
import {
  ApiError,
  rawGetBrokers,
  rawGetChannels,
  rawGetChannelsChannelIDMessages,
  rawGetIatas,
  rawGetNodes,
  rawGetNodesAmbiguousPrefix2,
  rawGetNodesMeshcoreRegions,
  rawGetNodesNodeId,
  rawGetNodesNodeIdNeighbors,
  rawGetNodesNodeIdObservations,
  rawGetNodesNodeIdPathPackets,
  rawGetObservers,
  rawGetObserversObserverId,
  rawGetObserversObserverIdAdverts,
  rawGetObserversObserverIdTelemetry,
  rawGetPackets,
  rawGetPacketsPacketHash,
  rawGetRegions,
  rawGetRegionsRegionId,
  rawGetRoutes,
  rawGetRoutesBest,
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
} from './generated/client';

export type IataBorder = Feature<Polygon | MultiPolygon>;

// The generated transport owns HTTP/error/query serialization. This module is the hand-written
// adapter boundary for app-specific CSV parameters, cursor wrappers, and GeoJSON 204 handling.

// endpoint functions

// The region filter travels as the comma-separated `iatas` param; undefined/empty means all regions.
function iatasParam(iatas?: string[]): string | undefined {
  return iatas && iatas.length > 0 ? iatas.join(',') : undefined;
}

function requiredField<T>(value: T | undefined, contract: string, field: string): T {
  if (value === undefined) throw new Error(`Invalid ${contract} response: missing ${field}`);
  return value;
}

// These endpoint adapters deliberately project generated wire models into the stricter UI models.
// A schema rename now fails at compile time, while an unexpectedly omitted required field fails at
// the transport boundary instead of leaking an unsafe assertion into feature code.
function toChannelSummary(model: Models.ChannelSummary): ChannelSummary {
  return {
    id: requiredField(model.id, 'ChannelSummary', 'id'),
    name: model.name ?? null,
    channelHash: requiredField(model.channelHash, 'ChannelSummary', 'channelHash'),
    lastSeen: requiredField(model.lastSeen, 'ChannelSummary', 'lastSeen'),
    keyKnown: requiredField(model.keyKnown, 'ChannelSummary', 'keyKnown'),
    kind: requiredField(model.kind, 'ChannelSummary', 'kind'),
  };
}

function toChannelMessage(model: Models.ChannelMessage): ChannelMessage {
  return {
    id: requiredField(model.id, 'ChannelMessage', 'id'),
    packetHash: requiredField(model.packetHash, 'ChannelMessage', 'packetHash'),
    channelHash: requiredField(model.channelHash, 'ChannelMessage', 'channelHash'),
    senderName: requiredField(model.senderName, 'ChannelMessage', 'senderName'),
    content: requiredField(model.content, 'ChannelMessage', 'content'),
    sentAt: requiredField(model.sentAt, 'ChannelMessage', 'sentAt'),
    observationCount: model.observationCount,
  };
}

// Nested schema models retain required fields and enum unions from the generated contract.
function toPage<T>(page: {
  items: T[];
  hasMore: boolean;
  nextCursor?: number | null;
  nextPageToken?: string | null;
}): CursorPage<T> {
  return { ...page, nextCursor: page.nextCursor ?? null };
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function record(value: unknown, contract: string): Record<string, unknown> | undefined {
  if (value == null) return undefined;
  if (!isRecord(value)) throw new Error(`Invalid ${contract} response: expected object`);
  return value;
}
function toNodeSummary(model: Models.NodeSummary): NodeSummary {
  return { ...model, name: model.name ?? null, lat: model.lat ?? null, lng: model.lng ?? null };
}
function toNode(model: Models.Node): Node {
  return {
    ...model,
    ...toNodeSummary(model),
    locationSource: model.locationSource ?? null,
    lastAdvertAt: model.lastAdvertAt ?? null,
    minFirmwareVersion: model.minFirmwareVersion ?? null,
    metadata: record(model.metadata, 'Node.metadata') ?? null,
  };
}
function toObserverSummary(model: Models.ObserverSummary): ObserverSummary {
  return model;
}
function toObserver(model: Models.Observer): Observer {
  return { ...model, statusMetadata: record(model.statusMetadata, 'Observer.statusMetadata') };
}
function toPacketDetail(model: Models.Packet): PacketDetail {
  return {
    ...model,
    parsedPayload:
      typeof model.parsedPayload === 'string'
        ? model.parsedPayload
        : record(model.parsedPayload, 'Packet.parsedPayload'),
    observations: model.observations.map((observation) => ({
      ...observation,
      propagationTimeMs: observation.propagationTimeMs ?? undefined,
    })),
  };
}

export function getPackets(
  iatas: string[] | undefined,
  params?: {
    cursor?: number;
    limit?: number;
    payloadTypes?: number[];
    routeTypes?: number[];
    observers?: string[];
    scopes?: string[];
    search?: string;
    searchField?: 'hash' | 'path' | 'payload';
    includeResolvedPath?: boolean;
  },
): Promise<CursorPage<PacketSummary>> {
  return rawGetPackets({
    iatas: iatasParam(iatas),
    cursor: params?.cursor,
    limit: params?.limit ?? DEFAULT_PAGE_SIZE,
    payloadTypes: params?.payloadTypes?.length ? params.payloadTypes.join(',') : undefined,
    routeTypes: params?.routeTypes?.length ? params.routeTypes.join(',') : undefined,
    observers: params?.observers?.length ? params.observers.join(',') : undefined,
    scopes: params?.scopes?.length ? params.scopes.join(',') : undefined,
    q: params?.search,
    searchField: params?.search ? params.searchField : undefined,
    include: params?.includeResolvedPath ? 'resolvedPath' : undefined,
  }).then(toPage);
}

export function getPacketDetail(packetHash: string): Promise<PacketDetail> {
  return rawGetPacketsPacketHash({ packetHash }).then(toPacketDetail);
}

export function getIatas(): Promise<IataCode[]> {
  return rawGetIatas();
}

// An IATA's GeoJSON border, or null when none is configured. Can't use request(): the endpoint
// answers 204 (empty body) or a literal `null` for "no border", and request() always parses JSON.
function isIataBorder(value: unknown): value is IataBorder {
  if (!isRecord(value) || value.type !== 'Feature' || !isRecord(value.geometry)) return false;
  if (value.properties !== null && !isRecord(value.properties)) return false;
  if (value.id !== undefined && typeof value.id !== 'string' && typeof value.id !== 'number')
    return false;
  const numbers = (v: unknown): v is number[] =>
    Array.isArray(v) && v.every((n: unknown) => typeof n === 'number' && Number.isFinite(n));
  if (value.bbox !== undefined && (!numbers(value.bbox) || ![4, 6].includes(value.bbox.length)))
    return false;
  const ring = (v: unknown) =>
    Array.isArray(v) && v.every((p: unknown) => numbers(p) && p.length >= 2);
  const polygon = (v: unknown) => Array.isArray(v) && v.every(ring);
  return value.geometry.type === 'Polygon'
    ? polygon(value.geometry.coordinates)
    : value.geometry.type === 'MultiPolygon' &&
        Array.isArray(value.geometry.coordinates) &&
        value.geometry.coordinates.every(polygon);
}

export async function getIataBorder(iata: string): Promise<IataBorder | null> {
  const url = new URL(`${API_BASE}/iatas/${iata}/border`, window.location.origin);
  const res = await fetch(url.toString());
  if (res.status === 204) return null;
  if (!res.ok) throw new ApiError(res.status, 'unknown', res.statusText);
  const body: unknown = await res.json();
  if (body == null) return null;
  if (!isIataBorder(body))
    throw new Error('Invalid IATA border response: expected Polygon or MultiPolygon feature');
  return body;
}

export function getRegions(): Promise<RegionSummary[]> {
  return rawGetRegions();
}

export function getRegion(regionId: number): Promise<Region> {
  return rawGetRegionsRegionId({ regionId });
}

export async function getChannels(params?: {
  iatas?: string[];
  limit?: number;
  cursor?: number;
  hash?: string;
  key?: 'known' | 'unknown' | 'all';
}): Promise<ChannelPage> {
  const iatas = params?.iatas ?? [];
  const page = await rawGetChannels({
    iata: iatas.length === 1 ? iatas[0] : undefined,
    iatas: iatas.length > 1 ? iatasParam(iatas) : undefined,
    limit: params?.limit,
    cursor: params?.cursor,
    hash: params?.hash,
    key: params?.key,
  });
  return {
    items: requiredField(page.items, 'ChannelSummary page', 'items').map(toChannelSummary),
    nextCursor: page.nextCursor ?? null,
    hasMore: requiredField(page.hasMore, 'ChannelSummary page', 'hasMore'),
    unknownCount: requiredField(page.unknownCount, 'ChannelSummary page', 'unknownCount'),
  };
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
  });
  const items = requiredField(page.items, 'ChannelMessage page', 'items').map(toChannelMessage);
  return toCursorPage(items, limit, (m) => m.id);
}

export function getBrokers(): Promise<BrokerStatus[]> {
  return rawGetBrokers();
}

// The authoritative list of configured transport scope names (e.g. "#bc", "#west"), used to populate
// the scope filter dropdowns. The no-param /scopes endpoint returns the names directly.
export function getScopes(): Promise<string[]> {
  return rawGetScopes({}).then((value: unknown) => {
    if (
      !Array.isArray(value) ||
      !value.every((item: unknown): item is string => typeof item === 'string')
    ) {
      throw new Error('Invalid scope names response: expected string array');
    }
    return value;
  });
}

// Wrap a bare-array endpoint into a CursorPage so it can drive the cursor-paginated hooks. A page that
// fills the limit may have more behind it; the next cursor is the last (boundary) row's sort key.
function toCursorPage<T>(items: T[], limit: number, cursorOf: (last: T) => number): CursorPage<T> {
  const hasMore = items.length === limit;
  return { items, nextCursor: hasMore ? cursorOf(items[items.length - 1]!) : null, hasMore };
}

// Known routes use an opaque keyset cursor bound to the requested backend ordering.
export async function getKnownRoutesPage(params?: {
  iatas?: string[];
  hopCount?: number;
  pageToken?: string;
  sort?: string;
  direction?: 'asc' | 'desc';
  limit?: number;
}): Promise<CursorPage<KnownRoute>> {
  return rawGetRoutes({
    iatas: iatasParam(params?.iatas),
    hopCount: params?.hopCount,
    pageToken: params?.pageToken,
    sort: params?.sort,
    direction: params?.direction,
    limit: params?.limit ?? DEFAULT_PAGE_SIZE,
  }).then(toPage);
}

// Search known routes for a path between two node hash prefixes within a single IATA. All three params
// are required by the server.
export function searchKnownRoutes(iata: string, from: string, to: string): Promise<KnownRoute[]> {
  return rawGetRoutesSearch({ iata, from, to });
}

// Search routes that cross IATA boundaries, from a hash in one IATA to a hash in another. All four
// params are required by the server.
export function searchCrossIATARoutes(
  fromHash: string,
  fromIata: string,
  toHash: string,
  toIata: string,
): Promise<CrossIATARoute[]> {
  return rawGetRoutesCross({ fromHash, fromIata, toHash, toIata });
}

// Plan best routes between two nodes by full public key (lowercase hex).
// Alternatives beyond the best path: 0-2 (server default 2).
export function planBestRoute(
  from: string,
  to: string,
  alternatives = 2,
): Promise<BestRouteResult> {
  return rawGetRoutesBest({ from: from.toLowerCase(), to: to.toLowerCase(), alternatives });
}

// Resolve one node by exact full public key. Null when unknown (no throw) so
// the planner combobox can distinguish "no match" from transport errors.
export async function getNodeByPubkey(publicKey: string): Promise<NodeSummary | null> {
  const page = await rawGetNodes({ pubkey: publicKey.toLowerCase(), limit: 1 });
  const item = page.items[0];
  return item ? toNodeSummary(item) : null;
}

// Trace tags. /traces returns a bare array of per-tag summaries (ordered newest-heard first, cursor is
// the last item's lastHeardAt); /traces/{tag} returns the tag's packets with resolved routes.
export function getTraces(
  iatas: string[] | undefined,
  params?: {
    scope?: string;
    type?: TraceType;
    since?: number;
    until?: number;
    cursor?: number;
    limit?: number;
  },
  init?: RequestInit,
): Promise<TraceTagSummary[]> {
  return rawGetTraces(
    {
      iatas: iatasParam(iatas),
      scope: params?.scope,
      type: params?.type,
      since: params?.since,
      until: params?.until,
      cursor: params?.cursor,
      limit: params?.limit,
    },
    init,
  );
}

export function getTraceDetail(tag: string): Promise<TraceDetail> {
  return rawGetTracesTag({ tag });
}

export function getObserver(observerId: string): Promise<Observer> {
  return rawGetObserversObserverId({ observerId }).then(toObserver);
}

export function getObserverAdverts(
  observerId: string,
  params?: { cursor?: number; limit?: number },
): Promise<CursorPage<AdvertObservation>> {
  return rawGetObserversObserverIdAdverts({
    observerId,
    cursor: params?.cursor,
    limit: params?.limit ?? DEFAULT_PAGE_SIZE,
  }).then(toPage);
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
    direction?: 'asc' | 'desc';
    type?: string;
    name?: string;
    pubkeyPrefix?: string; // case-insensitive hex prefix; server matches and validates
    supportsMultibytePaths?: 'true' | 'false';
    supportsMultibyteTraces?: 'true' | 'false';
    scope?: string;
    neighbors?: boolean; // include each node's neighborIds (?neighbors=true)
    meshcoreRegion?: string; // confirmed MeshCore region-scope token (exact, server-normalized)
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
    supportsMultibytePaths:
      params?.supportsMultibytePaths === 'true'
        ? true
        : params?.supportsMultibytePaths === 'false'
          ? false
          : undefined,
    supportsMultibyteTraces:
      params?.supportsMultibyteTraces === 'true'
        ? true
        : params?.supportsMultibyteTraces === 'false'
          ? false
          : undefined,
    scope: params?.scope,
    neighbors: params?.neighbors || undefined,
    meshcoreRegion: params?.meshcoreRegion,
  }).then((page) => toPage({ ...page, items: page.items.map(toNodeSummary) }));
}

// Confirmed MeshCore region-scope values (with node counts) for the map's MeshCore Region selector.
export function getMeshCoreRegions(): Promise<Models.MeshCoreRegion[]> {
  return rawGetNodesMeshcoreRegions();
}

// Paginated /observers, mirroring getNodesPage; used by the Observers table.
export function getObserversPage(
  iatas: string[] | undefined,
  params?: {
    cursor?: number;
    pageToken?: string;
    limit?: number;
    sort?: string;
    direction?: 'asc' | 'desc';
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
  }).then((page) => toPage({ ...page, items: page.items.map(toObserverSummary) }));
}

export function getNode(nodeId: string): Promise<Node> {
  return rawGetNodesNodeId({ nodeId }).then(toNode);
}

// Every 2-byte node prefix claimed by more than one infra node, globally, as
// lowercase hex. The path map draws a 2-byte route only when none of its hops'
// prefixes appear here and every hop resolved high-confidence.
export function getAmbiguousPrefix2(): Promise<string[]> {
  return rawGetNodesAmbiguousPrefix2();
}

export function getNodeObservations(
  nodeId: string,
  params?: { cursor?: number; limit?: number },
): Promise<CursorPage<NodeObservation>> {
  return rawGetNodesNodeIdObservations({
    nodeId,
    cursor: params?.cursor,
    limit: params?.limit ?? DEFAULT_PAGE_SIZE,
  }).then(toPage);
}

export function getNodePathPackets(
  nodeId: string,
  params: { iatas?: string[]; pageToken?: string; limit?: number },
): Promise<CursorPage<PacketSummary>> {
  return rawGetNodesNodeIdPathPackets({
    ...params,
    nodeId,
    iatas: iatasParam(params.iatas),
  }).then(toPage);
}

export function getNodeNeighbors(nodeId: string): Promise<NodeNeighbor[]> {
  return rawGetNodesNodeIdNeighbors({ nodeId });
}

// stats endpoints

export function getStatsOverview(iatas?: string[]): Promise<StatsOverview> {
  return rawGetStatsOverview({ iatas: iatasParam(iatas) });
}

export function getStatsObservations(
  iatas?: string[],
  since?: number,
): Promise<ObservationPoint[]> {
  return rawGetStatsObservations({ iatas: iatasParam(iatas), since });
}

export function getPayloadBreakdown(
  iatas?: string[],
  since?: number,
): Promise<PayloadBreakdownItem[]> {
  return rawGetStatsPayloadBreakdown({ iatas: iatasParam(iatas), since });
}

export function getTopNodes(iatas?: string[], limit = 10): Promise<TopNode[]> {
  return rawGetStatsTopNodes({ iatas: iatasParam(iatas), limit }).then((items) =>
    items.map((item) => ({ ...item, nodeName: item.nodeName ?? null })),
  );
}

export function getTopObservers(
  iatas?: string[],
  since?: number,
  limit = 10,
): Promise<TopObserver[]> {
  return rawGetStatsTopObservers({ iatas: iatasParam(iatas), since, limit }).then((items) =>
    items.map((item) => ({
      ...item,
      displayName: item.displayName ?? null,
      observerType: item.observerType ?? null,
    })),
  );
}

export function getTopAdvertisers(
  iatas?: string[],
  since?: number,
  limit = 10,
): Promise<TopAdvertiser[]> {
  return rawGetStatsTopAdvertisers({
    iatas: iatasParam(iatas),
    since,
    limit,
  }).then((items) => items.map((item) => ({ ...item, nodeName: item.nodeName ?? null })));
}

export function getTopTalkers(iatas?: string[], since?: number, limit = 10): Promise<TopTalker[]> {
  return rawGetStatsTopTalkers({ iatas: iatasParam(iatas), since, limit });
}

export function getRadioPresets(iatas?: string[]): Promise<RadioPreset[]> {
  return rawGetStatsRadioPresets({ iatas: iatasParam(iatas) });
}

export function getStatsNodeTypes(iatas?: string[]): Promise<NodeTypeCount[]> {
  return rawGetStatsNodeTypes({ iatas: iatasParam(iatas) });
}

// Repeaters/room servers whose clock has drifted past the server threshold, worst-first. Not
// time-windowed and top-N only (no cursor), so callers pass a generous limit and page client-side.
export function getClockDrift(iatas?: string[], limit = 100): Promise<ClockDriftEntry[]> {
  return rawGetStatsClockDrift({ iatas: iatasParam(iatas), limit }).then((items) =>
    items.map((item) => ({ ...item, nodeName: item.nodeName ?? null })),
  );
}

// renamed from getScopes to avoid colliding with the /scopes name list; this is the /stats/scopes
// aggregate (packet/observer/node counts), reported globally regardless of the active region.
export function getStatsScopes(): Promise<ScopeStats[]> {
  return rawGetStatsScopes();
}

export function getObserverTelemetry(
  observerId: string,
  range: string,
  interval?: string,
  afterId?: number,
): Promise<ObserverTelemetry> {
  return rawGetObserversObserverIdTelemetry({
    observerId,
    range,
    interval,
    afterId,
  }).then((model) => ({
    ...model,
    points: model.points.map((point) => ({
      ...point,
      batteryMv: point.batteryMv ?? null,
      airtimeTxPct: point.airtimeTxPct ?? null,
      airtimeRxPct: point.airtimeRxPct ?? null,
      noiseFloorDb: point.noiseFloorDb ?? null,
      uptimeSeconds: point.uptimeSeconds ?? null,
      queueLength: point.queueLength ?? null,
      receiveErrors: point.receiveErrors ?? null,
    })),
  }));
}

export { ApiError };
