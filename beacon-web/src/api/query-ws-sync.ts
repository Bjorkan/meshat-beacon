import type { InfiniteData, QueryClient, QueryKey } from "@tanstack/react-query";
import { channelQueries, nodeQueries, observerQueries, packetQueries } from "./queries";
import { patchInfinitePages } from "../lib/infinite-pages";
import { nodeListUpdateRequiresRefetch, patchNodeTableSummary, upsertNodePages } from "../features/nodes/node-updates";
import { observerListUpdateRequiresRefetch, patchObserverSummary } from "../features/observers/observer-updates";
import type { NodeSummary } from "../features/nodes/types";
import type { ObserverSummary } from "../features/observers/types";
import type { ChannelMessage, ChannelSummary } from "../features/channels/types";
import type { CursorPage } from "../types/api";
import type { WsChannelMessage, WsNodeUpdate, WsObserverStatus, WsPacketObservation } from "../types/ws";

function iatasFromRegionKey(value: unknown): string[] | undefined {
  if (typeof value !== "string" || value === "*") return undefined;
  return value.split(",").filter(Boolean);
}

function intersects(selected: readonly string[] | undefined, values: readonly string[]): boolean {
  if (!selected?.length) return true;
  const set = new Set(selected.map((value) => value.toUpperCase()));
  return values.some((value) => set.has(value.toUpperCase()));
}

function invalidateExact(queryClient: QueryClient, queryKey: QueryKey) {
  void queryClient.invalidateQueries({ queryKey, exact: true, refetchType: "active" });
}

function nodeCoordinatesChanged(
  previous: { lat?: number | null; lng?: number | null } | undefined,
  data: WsNodeUpdate["data"],
): boolean {
  if (!previous) return false;
  return (data.lat !== undefined && data.lat !== previous.lat)
    || (data.lng !== undefined && data.lng !== previous.lng);
}

export function syncNodeUpdate(queryClient: QueryClient, data: WsNodeUpdate["data"]): void {
  let coordinatesChanged = false;

  // A focused neighbor may sit outside the currently loaded map region, so its only cached copy can
  // be inside another node's detailed neighbor response. Inspect those before patching map/list data.
  for (const [, neighbors] of queryClient.getQueriesData<Array<{ id: string; lat?: number; lng?: number }>>({ queryKey: ["node-neighbors"] })) {
    coordinatesChanged ||= nodeCoordinatesChanged(neighbors?.find((node) => node.id === data.nodeId), data);
  }

  // Map caches exist per region. Keep known/current-region entries hot; invalidate a cache when
  // membership may have changed instead of ever inserting an out-of-region node.
  for (const [queryKey, cached] of queryClient.getQueriesData<InfiniteData<CursorPage<NodeSummary>>>({ queryKey: ["map-nodes"] })) {
    const regionIatas = iatasFromRegionKey(queryKey[1]);
    const old = cached?.pages.flatMap((page) => page.items).find((node) => node.id === data.nodeId);
    coordinatesChanged ||= nodeCoordinatesChanged(old, data);
    const belongs = intersects(regionIatas, data.iatas.map((entry) => entry.iata));
    if (old && !belongs) {
      invalidateExact(queryClient, queryKey);
    } else if (belongs) {
      queryClient.setQueryData<InfiniteData<CursorPage<NodeSummary>>>(queryKey, (current) => upsertNodePages(current, data));
    }
  }

  for (const [queryKey, cached] of queryClient.getQueriesData<InfiniteData<CursorPage<NodeSummary>>>({ queryKey: nodeQueries.all() })) {
    if (queryKey[0] !== "nodes") continue;
    const previous = cached?.pages.flatMap((page) => page.items).find((node) => node.id === data.nodeId);
    coordinatesChanged ||= nodeCoordinatesChanged(previous, data);
    const regionIatas = iatasFromRegionKey(queryKey[1]);
    if (!previous) {
      if (intersects(regionIatas, data.iatas.map((entry) => entry.iata))) invalidateExact(queryClient, queryKey);
      continue;
    }
    const context = {
      type: String(queryKey[2] ?? "") || undefined,
      name: String(queryKey[5] ?? "") || undefined,
      pubkeyPrefix: String(queryKey[6] ?? "") || undefined,
      scope: String(queryKey[7] ?? "") || undefined,
      sort: (String(queryKey[8] ?? "name") || "name") as "name" | "type" | "radio" | "neighbors" | "last_seen",
      iatas: regionIatas,
    };
    const hasUnsupportedCapabilityFilter = Boolean(queryKey[3] || queryKey[4]);
    if (hasUnsupportedCapabilityFilter || nodeListUpdateRequiresRefetch(previous, data, context)) {
      invalidateExact(queryClient, queryKey);
    } else {
      queryClient.setQueryData<InfiniteData<CursorPage<NodeSummary>>>(
        queryKey,
        (current) => patchInfinitePages(current, (items) => patchNodeTableSummary(items, data) ?? items),
      );
    }
  }

  invalidateExact(queryClient, nodeQueries.detail(data.nodeId).queryKey);
  if (coordinatesChanged) {
    // A moved node can be present in any other node's cached neighbor response. Invalidate the
    // whole family so focused map markers and edges cannot retain its previous coordinates.
    void queryClient.invalidateQueries({ queryKey: ["node-neighbors"], refetchType: "active" });
  } else {
    invalidateExact(queryClient, nodeQueries.neighbors(data.nodeId).queryKey);
  }
}

export function syncObserverStatus(queryClient: QueryClient, data: WsObserverStatus["data"]): void {
  for (const [queryKey, cached] of queryClient.getQueriesData<InfiniteData<CursorPage<ObserverSummary>>>({ queryKey: observerQueries.all() })) {
    if (queryKey[0] !== "observers") continue;
    const previous = cached?.pages.flatMap((page) => page.items).find((observer) => observer.id === data.observerId);
    const regionIatas = iatasFromRegionKey(queryKey[1]);
    if (!previous) {
      if (intersects(regionIatas, [data.iata])) invalidateExact(queryClient, queryKey);
      continue;
    }
    const context = {
      status: String(queryKey[2] ?? "") || undefined,
      type: String(queryKey[3] ?? "") || undefined,
      name: String(queryKey[5] ?? "") || undefined,
      scope: String(queryKey[7] ?? "") || undefined,
      sort: (String(queryKey[8] ?? "name") || "name") as "name" | "type" | "radio" | "iata" | "status" | "last_seen",
      iatas: regionIatas,
    };
    if (observerListUpdateRequiresRefetch(previous, data, context)) {
      invalidateExact(queryClient, queryKey);
    } else {
      queryClient.setQueryData<InfiniteData<CursorPage<ObserverSummary>>>(
        queryKey,
        (current) => patchInfinitePages(current, (items) => patchObserverSummary(items, data) ?? items),
      );
    }
  }

  invalidateExact(queryClient, observerQueries.detail(data.observerId).queryKey);
  // All ranges share this prefix; active telemetry self-heals without route-owned WS listeners.
  void queryClient.invalidateQueries({ queryKey: ["observer-telemetry", data.observerId], refetchType: "active" });
}

export function syncChannelMessage(queryClient: QueryClient, data: WsChannelMessage["data"], currentRegionKey: string): void {
  let channelId: number | undefined;
  for (const [queryKey, channels] of queryClient.getQueriesData<ChannelSummary[]>({ queryKey: channelQueries.all() })) {
    if (queryKey[0] !== "channels" || queryKey[1] !== currentRegionKey || !channels) continue;
    const index = channels.findIndex((channel) => channel.channelHash === data.channelHash);
    if (index < 0) {
      invalidateExact(queryClient, queryKey);
      continue;
    }
    channelId = channels[index]!.id;
    const next = [...channels];
    next[index] = { ...next[index]!, lastSeen: data.sentAt };
    queryClient.setQueryData(queryKey, next);
  }

  if (channelId === undefined) return;
  const messageKey = channelQueries.messages({ channelId, regionKey: currentRegionKey }).queryKey;
  queryClient.setQueryData<InfiniteData<CursorPage<ChannelMessage>>>(messageKey, (old) => {
    if (!old || old.pages.some((page) => page.items.some((message) => message.packetHash === data.packetHash))) return old;
    const pages = old.pages.map((page, index) => index === 0 ? { ...page, items: [...page.items, data] } : page);
    return { ...old, pages };
  });
}

export function syncPacketObservation(queryClient: QueryClient, data: WsPacketObservation["data"]): void {
  // The mounted packet route keeps its high-volume live buffer locally, so refetching history for
  // every event would be wasteful. Mark every history variant stale without refetching instead:
  // inactive routes then self-heal immediately on remount, while the mounted route stays responsive.
  void queryClient.invalidateQueries({ queryKey: packetQueries.all(), refetchType: "none" });
  invalidateExact(queryClient, packetQueries.detail(data.packetHash).queryKey);
}

export function healLiveQueryCaches(queryClient: QueryClient): void {
  // Packets can hold many history pages; reset them so reconnect healing fetches one fresh first page
  // instead of replaying every cached cursor. Other live families only need to be marked stale.
  void queryClient.resetQueries({ queryKey: packetQueries.all() });
  void queryClient.invalidateQueries({ queryKey: nodeQueries.all(), refetchType: "active" });
  void queryClient.invalidateQueries({ queryKey: ["map-nodes"], refetchType: "active" });
  void queryClient.invalidateQueries({ queryKey: observerQueries.all(), refetchType: "active" });
  void queryClient.invalidateQueries({ queryKey: channelQueries.all(), refetchType: "active" });
}
