import { StrictMode } from "react";
import { act, render } from "@testing-library/react";
import { QueryClient, QueryClientProvider, type InfiniteData } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import type { NodeSummary } from "../../src/features/nodes/types";
import type { CursorPage } from "../../src/types/api";
import type { WsNodeUpdate } from "../../src/types/ws";

const listeners = vi.hoisted(() => ({
  packet: new Set<(data: unknown) => void>(),
  lagged: new Set<(data: unknown) => void>(),
  channel: new Set<(data: unknown) => void>(),
  observer: new Set<(data: unknown) => void>(),
  node: new Set<(data: WsNodeUpdate["data"]) => void>(),
}));

function subscribe<T>(set: Set<T>, callback: T) {
  set.add(callback);
  return () => set.delete(callback);
}

vi.mock("../../src/api/ws-instance", () => ({
  wsManager: {
    onPacketObservation: (callback: (data: unknown) => void) => subscribe(listeners.packet, callback),
    onLagged: (callback: (data: unknown) => void) => subscribe(listeners.lagged, callback),
    onChannelMessage: (callback: (data: unknown) => void) => subscribe(listeners.channel, callback),
    onObserverStatus: (callback: (data: unknown) => void) => subscribe(listeners.observer, callback),
    onNodeUpdate: (callback: (data: WsNodeUpdate["data"]) => void) => subscribe(listeners.node, callback),
  },
}));

vi.mock("../../src/hooks/useRegion", () => ({
  useRegion: () => ({ iatas: undefined, regionKey: "*" }),
}));

import { QueryWsBridge } from "../../src/api/query-ws-bridge";
import { nodeQueries } from "../../src/api/queries";

const node: NodeSummary = {
  id: "node-1",
  publicKey: "aa11",
  nodeType: 1,
  nodeTypeName: "REPEATER",
  name: "Alpha",
  lat: 45,
  lng: -75,
  iatas: [{ iata: "YOW", lastHeard: 1 }],
  knownNeighborCount: 0,
  isObserver: false,
};

describe("QueryWsBridge listener lifecycle", () => {
  it("keeps exactly one global listener and synchronizes cache without a feature route mounted", () => {
    const client = new QueryClient();
    const key = nodeQueries.list({ regionKey: "*", sort: "neighbors" }).queryKey;
    client.setQueryData<InfiniteData<CursorPage<NodeSummary>>>(key, {
      pages: [{ items: [node], nextCursor: null }],
      pageParams: [undefined],
    });

    const view = render(
      <StrictMode>
        <QueryClientProvider client={client}>
          <QueryWsBridge />
        </QueryClientProvider>
      </StrictMode>,
    );

    expect(Object.values(listeners).map((set) => set.size)).toEqual([1, 1, 1, 1, 1]);
    act(() => {
      for (const listener of listeners.node) {
        listener({
          nodeId: node.id,
          publicKey: node.publicKey,
          name: node.name!,
          nodeType: node.nodeType,
          nodeTypeName: node.nodeTypeName,
          iata: "YOW",
          lat: 46,
          lng: node.lng!,
          isObserver: false,
          iatas: node.iatas,
        });
      }
    });
    expect(client.getQueryData<InfiniteData<CursorPage<NodeSummary>>>(key)?.pages[0]?.items[0]?.lat).toBe(46);

    view.unmount();
    expect(Object.values(listeners).map((set) => set.size)).toEqual([0, 0, 0, 0, 0]);
  });
});
