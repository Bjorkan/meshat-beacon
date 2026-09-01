import { QueryClient } from "@tanstack/react-query";
import { createMemoryHistory } from "@tanstack/react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAppRouter } from "../src/router";

const getNode = vi.fn();
const getNodeObservations = vi.fn();
const getNodeNeighbors = vi.fn();
const getObserver = vi.fn();
const getObserverAdverts = vi.fn();

vi.mock("../src/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/api/client")>();
  return {
    ...actual,
    getNode: (...args: unknown[]) => getNode(...args),
    getNodeObservations: (...args: unknown[]) => getNodeObservations(...args),
    getNodeNeighbors: (...args: unknown[]) => getNodeNeighbors(...args),
    getObserver: (...args: unknown[]) => getObserver(...args),
    getObserverAdverts: (...args: unknown[]) => getObserverAdverts(...args),
  };
});

async function routerAt(entry: string, client: QueryClient) {
  const router = createAppRouter(createMemoryHistory({ initialEntries: [entry] }), client);
  await router.load();
  return router;
}

beforeEach(() => {
  getNode.mockReset().mockResolvedValue({ id: "node-1" });
  getNodeObservations.mockReset().mockResolvedValue([]);
  getNodeNeighbors.mockReset().mockResolvedValue([]);
  getObserver.mockReset().mockResolvedValue({ id: "observer-1" });
  getObserverAdverts.mockReset().mockResolvedValue([]);
});

describe("route Query intent preload", () => {
  it("starts node detail queries on intent and Query-deduplicates repeated preload/navigation", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const router = await routerAt("/nodes", client);
    expect(getNode).not.toHaveBeenCalled();

    await Promise.all([
      router.preloadRoute({ to: "/nodes/$nodeId", params: { nodeId: "node-1" }, search: {} }),
      router.preloadRoute({ to: "/nodes/$nodeId", params: { nodeId: "node-1" }, search: {} }),
    ]);
    await vi.waitFor(() => {
      expect(getNode).toHaveBeenCalledTimes(1);
      expect(getNodeObservations).toHaveBeenCalledTimes(1);
      expect(getNodeNeighbors).toHaveBeenCalledTimes(1);
    });

    await router.navigate({ to: "/nodes/$nodeId", params: { nodeId: "node-1" }, search: {} });
    expect(getNode).toHaveBeenCalledTimes(1);
    expect(getNodeObservations).toHaveBeenCalledTimes(1);
    expect(getNodeNeighbors).toHaveBeenCalledTimes(1);
  });

  it("preloads observer core data and keeps direct deep links functional without prior intent", async () => {
    const intentClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const router = await routerAt("/observers", intentClient);
    await router.preloadRoute({ to: "/observers/$observerId", params: { observerId: "observer-1" }, search: {} });
    await vi.waitFor(() => {
      expect(getObserver).toHaveBeenCalledTimes(1);
      expect(getObserverAdverts).toHaveBeenCalledTimes(1);
    });

    getNode.mockClear();
    getNodeObservations.mockClear();
    getNodeNeighbors.mockClear();
    const directClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await routerAt("/nodes/node-direct", directClient);
    await vi.waitFor(() => {
      expect(getNode).toHaveBeenCalledWith("node-direct");
      expect(getNodeObservations).toHaveBeenCalledWith("node-direct", { limit: 50 });
      expect(getNodeNeighbors).toHaveBeenCalledWith("node-direct");
    });
  });

  it("does not let secondary preload failures block detail navigation", async () => {
    getNodeNeighbors.mockRejectedValueOnce(new Error("neighbors unavailable"));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const router = await routerAt("/nodes", client);

    await expect(router.navigate({ to: "/nodes/$nodeId", params: { nodeId: "node-1" }, search: {} })).resolves.toBeUndefined();
    expect(router.state.location.pathname).toBe("/nodes/node-1");
  });
});
