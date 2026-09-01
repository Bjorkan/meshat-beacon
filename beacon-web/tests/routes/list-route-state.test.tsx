import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const routeState = vi.hoisted(() => ({
  search: {} as Record<string, unknown>,
  navigate: vi.fn(),
  preloadRoute: vi.fn(),
}));

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    Outlet: () => null,
    useNavigate: () => routeState.navigate,
    useParams: () => ({}),
    useRouter: () => ({ preloadRoute: routeState.preloadRoute }),
    useSearch: () => routeState.search,
  };
});

vi.mock("../../src/routes/overlays", () => ({
  useOverlays: () => ({ analyze: vi.fn(), setOverlayPacketHash: vi.fn(), setOverlayNodeId: vi.fn() }),
}));

vi.mock("../../src/features/nodes/NodeTable", () => ({
  NodeTable: (props: {
    viewState: unknown;
    onViewStateChange: (patch: Record<string, unknown>, options?: { replace?: boolean }) => void;
  }) => (
    <div>
      <output data-testid="node-state">{JSON.stringify(props.viewState)}</output>
      <button onClick={() => props.onViewStateChange({ search: "typed" }, { replace: true })}>node-search</button>
      <button onClick={() => props.onViewStateChange({ sort: { header: "Radio", direction: "desc" } })}>node-sort</button>
    </div>
  ),
}));

vi.mock("../../src/features/observers/ObserverTable", () => ({
  ObserverTable: (props: {
    viewState: unknown;
    onViewStateChange: (patch: Record<string, unknown>, options?: { replace?: boolean }) => void;
  }) => (
    <div>
      <output data-testid="observer-state">{JSON.stringify(props.viewState)}</output>
      <button onClick={() => props.onViewStateChange({ search: "typed" }, { replace: true })}>observer-search</button>
    </div>
  ),
}));

vi.mock("../../src/features/channels/ChannelList", () => ({
  ChannelList: (props: {
    viewState: unknown;
    onViewStateChange: (patch: Record<string, unknown>, options?: { replace?: boolean }) => void;
  }) => (
    <div>
      <output data-testid="channel-state">{JSON.stringify(props.viewState)}</output>
      <button onClick={() => props.onViewStateChange({ search: "typed" }, { replace: true })}>channel-search</button>
    </div>
  ),
}));

vi.mock("../../src/features/traces/TraceList", () => ({
  TraceList: (props: { typeFilter: string; onTypeFilterChange: (value: "" | "TRACE" | "PING") => void }) => (
    <div>
      <output data-testid="trace-state">{props.typeFilter}</output>
      <button onClick={() => props.onTypeFilterChange("PING")}>trace-ping</button>
    </div>
  ),
}));

vi.mock("../../src/api/ws-instance", () => ({ wsManager: {} }));

import { NodesRoute } from "../../src/routes/nodes-route";
import { ObserversRoute } from "../../src/routes/observers-route";
import { ChannelsRoute } from "../../src/routes/channels-route";
import { TracesRoute } from "../../src/routes/traces-route";

function latestNavigation() {
  return routeState.navigate.mock.calls.at(-1)?.[0] as {
    replace?: boolean;
    search: (previous: Record<string, unknown>) => Record<string, unknown>;
  };
}

beforeEach(() => {
  routeState.search = {};
  routeState.navigate.mockReset();
  routeState.preloadRoute.mockReset();
});

describe("controlled list route state", () => {
  it("drives Nodes state from search params and serializes text/sort changes", () => {
    routeState.search = { nq: "alice", nsf: "pubkey", nt: "REPEATER", np: "true", ntr: "false", ns: "#east", nsort: "radio", ndir: "desc" };
    render(<NodesRoute />);

    expect(JSON.parse(screen.getByTestId("node-state").textContent!)).toMatchObject({
      search: "alice",
      searchField: "pubkey",
      typeFilter: "REPEATER",
      pathsFilter: "true",
      tracesFilter: "false",
      scopeFilter: "#east",
      sort: { header: "Radio", direction: "desc" },
    });

    fireEvent.click(screen.getByText("node-search"));
    expect(latestNavigation().replace).toBe(true);
    expect(latestNavigation().search(routeState.search).nq).toBe("typed");

    fireEvent.click(screen.getByText("node-sort"));
    expect(latestNavigation().replace).toBeUndefined();
    expect(latestNavigation().search(routeState.search)).toMatchObject({ nsort: "radio", ndir: "desc" });
  });

  it("drives Observers state from URL and replaces text-search history", () => {
    routeState.search = { oq: "raven", ost: "offline", ot: "mqtt", ob: "broker", os: "#west", osort: "status", odir: "desc" };
    render(<ObserversRoute />);

    expect(JSON.parse(screen.getByTestId("observer-state").textContent!)).toMatchObject({
      search: "raven",
      statusFilter: "offline",
      typeFilter: "mqtt",
      brokerFilter: "broker",
      scopeFilter: "#west",
      sort: { header: "Status", direction: "desc" },
    });
    fireEvent.click(screen.getByText("observer-search"));
    expect(latestNavigation().replace).toBe(true);
    expect(latestNavigation().search(routeState.search).oq).toBe("typed");
  });

  it("controls Channels and Traces filters through their route params", () => {
    routeState.search = { cq: "ops", csf: "hash", ck: "known", ch: "false" };
    const channels = render(<ChannelsRoute />);
    expect(JSON.parse(screen.getByTestId("channel-state").textContent!)).toEqual({
      search: "ops", searchField: "hash", keyFilter: "known", hashtagFilter: "false",
    });
    fireEvent.click(screen.getByText("channel-search"));
    expect(latestNavigation().replace).toBe(true);
    expect(latestNavigation().search(routeState.search).cq).toBe("typed");
    channels.unmount();

    routeState.search = { tt: "PING" };
    render(<TracesRoute />);
    expect(screen.getByTestId("trace-state")).toHaveTextContent("PING");
    fireEvent.click(screen.getByText("trace-ping"));
    expect(latestNavigation().search(routeState.search).tt).toBe("PING");
  });
});
