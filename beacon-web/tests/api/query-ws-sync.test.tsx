import { act, renderHook, waitFor } from "@testing-library/react";
import {
  QueryClient,
  QueryClientProvider,
  useInfiniteQuery,
  type InfiniteData,
} from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import {
  healLiveQueryCaches,
  syncNodeUpdate,
  syncObserverStatus,
  syncPacketObservation,
} from "../../src/api/query-ws-sync";
import { channelQueries, nodeQueries, observerQueries, packetQueries } from "../../src/api/queries";
import type { NodeSummary } from "../../src/features/nodes/types";
import type { ObserverSummary } from "../../src/features/observers/types";
import type { CursorPage, PacketSummary } from "../../src/types/api";
import type { WsNodeUpdate, WsObserverStatus, WsPacketObservation } from "../../src/types/ws";

function page<T>(items: T[]): InfiniteData<CursorPage<T>> {
  return { pages: [{ items, nextCursor: null }], pageParams: [undefined] };
}

const node: NodeSummary = {
  id: "node-1",
  publicKey: "aa11",
  nodeType: 1,
  nodeTypeName: "REPEATER",
  name: "Alpha",
  lat: 45,
  lng: -75,
  iatas: [{ iata: "YOW", lastHeard: 1 }],
  knownNeighborCount: 2,
  isObserver: false,
};

function nodeUpdate(overrides: Partial<WsNodeUpdate["data"]> = {}): WsNodeUpdate["data"] {
  return {
    nodeId: node.id,
    publicKey: node.publicKey,
    name: node.name!,
    nodeType: node.nodeType,
    nodeTypeName: node.nodeTypeName,
    iata: "YOW",
    lat: node.lat!,
    lng: node.lng!,
    isObserver: false,
    iatas: node.iatas,
    ...overrides,
  };
}

const observer: ObserverSummary = {
  id: "observer-1",
  displayName: "Raven",
  observerType: "mqtt",
  iata: "YOW",
  status: "online",
  scopes: ["#east"],
};

function observerStatus(overrides: Partial<WsObserverStatus["data"]> = {}): WsObserverStatus["data"] {
  return {
    observerId: observer.id,
    displayName: observer.displayName!,
    observerType: observer.observerType,
    iata: observer.iata,
    online: true,
    scopes: observer.scopes!,
    uptimeSeconds: 1,
    lastStatusAt: 2,
    ...overrides,
  };
}

describe("global WebSocket to Query cache policy", () => {
  it("patches inactive node and observer lists even when their routes are unmounted", () => {
    const client = new QueryClient();
    const nodeKey = nodeQueries.list({ regionKey: "YOW", iatas: ["YOW"], sort: "neighbors" }).queryKey;
    const observerKey = observerQueries.list({ regionKey: "YOW", iatas: ["YOW"], sort: "last_seen" }).queryKey;
    client.setQueryData(nodeKey, page([node]));
    client.setQueryData(observerKey, page([observer]));

    syncNodeUpdate(client, nodeUpdate({ lat: 46 }));
    syncObserverStatus(client, observerStatus({ lastStatusAt: 99 }));

    const updatedNode = client.getQueryData<InfiniteData<CursorPage<NodeSummary>>>(nodeKey)?.pages[0]?.items[0];
    const updatedObserver = client.getQueryData<InfiniteData<CursorPage<ObserverSummary>>>(observerKey)?.pages[0]?.items[0];
    expect(updatedNode?.lat).toBe(46);
    expect(updatedObserver?.lastStatusAt).toBe(99);
    expect(client.getQueryState(nodeKey)?.observers).toBeUndefined();
  });

  it("invalidates every neighbor cache when a node moves", () => {
    const client = new QueryClient();
    const ownNeighborsKey = nodeQueries.neighbors(node.id).queryKey;
    const otherNeighborsKey = nodeQueries.neighbors("node-2").queryKey;
    client.setQueryData(ownNeighborsKey, []);
    client.setQueryData(otherNeighborsKey, [{ ...node }]);

    syncNodeUpdate(client, nodeUpdate());
    expect(client.getQueryState(ownNeighborsKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(otherNeighborsKey)?.isInvalidated).toBe(false);

    syncNodeUpdate(client, nodeUpdate({ lat: 46, lng: -76 }));
    expect(client.getQueryState(otherNeighborsKey)?.isInvalidated).toBe(true);
  });

  it("invalidates server-sorted or filtered lists when a direct patch could break membership/order", () => {
    const client = new QueryClient();
    const nodeKey = nodeQueries.list({ regionKey: "YOW", iatas: ["YOW"], name: "alp", sort: "name" }).queryKey;
    const observerKey = observerQueries.list({ regionKey: "YOW", iatas: ["YOW"], status: "online", sort: "status" }).queryKey;
    client.setQueryData(nodeKey, page([node]));
    client.setQueryData(observerKey, page([observer]));

    syncNodeUpdate(client, nodeUpdate({ name: "Zulu" }));
    syncObserverStatus(client, observerStatus({ online: false }));

    expect(client.getQueryState(nodeKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(observerKey)?.isInvalidated).toBe(true);
    // The server remains authoritative for order/membership until the query is consumed again.
    expect(client.getQueryData<InfiniteData<CursorPage<NodeSummary>>>(nodeKey)?.pages[0]?.items[0]?.name).toBe("Alpha");
    expect(client.getQueryData<InfiniteData<CursorPage<ObserverSummary>>>(observerKey)?.pages[0]?.items[0]?.status).toBe("online");
  });

  it("marks packet detail stale on an observation and heals every inactive live family after a gap", async () => {
    const client = new QueryClient();
    const nodeKey = nodeQueries.list({ regionKey: "YOW" }).queryKey;
    const observerKey = observerQueries.list({ regionKey: "YOW" }).queryKey;
    const channelKey = channelQueries.list({ regionKey: "YOW" }).queryKey;
    const packetKey = packetQueries.list({ regionKey: "YOW" }).queryKey;
    const packetDetailKey = packetQueries.detail("AA11").queryKey;
    client.setQueryData(nodeKey, page([node]));
    client.setQueryData(observerKey, page([observer]));
    client.setQueryData(channelKey, []);
    client.setQueryData(packetKey, page<PacketSummary>([]));
    client.setQueryData(packetDetailKey, { packetHash: "AA11" });

    syncPacketObservation(client, { packetHash: "AA11" } as WsPacketObservation["data"]);
    expect(client.getQueryState(packetDetailKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(packetKey)?.isInvalidated).toBe(true);

    healLiveQueryCaches(client);
    await Promise.resolve();

    expect(client.getQueryData(packetKey)).toBeUndefined();
    expect(client.getQueryState(nodeKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(observerKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(channelKey)?.isInvalidated).toBe(true);
  });

  it("reconnect healing refetches only one fresh packet page instead of replaying cached cursors", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const queryKey = packetQueries.list({ regionKey: "YOW" }).queryKey;
    client.setQueryData(queryKey, {
      pages: [
        { items: [], nextCursor: 200 },
        { items: [], nextCursor: 100 },
        { items: [], nextCursor: null },
      ],
      pageParams: [undefined, 200, 100],
    });
    const fetchPage = vi.fn().mockResolvedValue({ items: [], nextCursor: 999 });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    renderHook(() => useInfiniteQuery({
      queryKey,
      queryFn: fetchPage,
      initialPageParam: undefined as number | undefined,
      getNextPageParam: (last: CursorPage<PacketSummary>) => last.nextCursor ?? undefined,
      staleTime: Infinity,
    }), { wrapper });
    expect(fetchPage).not.toHaveBeenCalled();

    act(() => healLiveQueryCaches(client));

    await waitFor(() => expect(fetchPage).toHaveBeenCalledTimes(1));
    await waitFor(() => {
      expect(client.getQueryData<InfiniteData<CursorPage<PacketSummary>>>(queryKey)?.pages).toHaveLength(1);
    });
  });
});
