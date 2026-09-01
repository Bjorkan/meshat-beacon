import { createMemoryHistory } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";
import { createAppRouter } from "../src/router";

async function routerAt(entry: string) {
  const router = createAppRouter(createMemoryHistory({ initialEntries: [entry] }));
  await router.load();
  return router;
}

function routeSearch(router: Awaited<ReturnType<typeof routerAt>>) {
  return router.state.matches.at(-1)?.search ?? {};
}

describe("application routes", () => {
  it("opens entity deep links directly", async () => {
    const router = await routerAt("/nodes/node-123?iata=yvr,yyj");

    expect(router.state.location.pathname).toBe("/nodes/node-123");
    expect(routeSearch(router).iata).toEqual(["YVR", "YYJ"]);
  });

  it("normalizes historical tab and entity params once", async () => {
    const router = await routerAt("/?tab=Observers&observer=observer-7&region=yvr");

    expect(router.state.location.pathname).toBe("/observers/observer-7");
    expect(routeSearch(router).iata).toEqual(["YVR"]);
    expect(routeSearch(router).tab).toBeUndefined();
    expect(routeSearch(router).observer).toBeUndefined();
  });

  it("keeps the old Stats name compatible", async () => {
    const router = await routerAt("/?tab=Stats&statsTab=observer&observerId=observer-9&range=7d");

    expect(router.state.location.pathname).toBe("/analytics");
    expect(routeSearch(router)).toMatchObject({
      statsTab: "observer",
      observerId: "observer-9",
      range: "7d",
    });
  });

  it("validates map state at the route boundary", async () => {
    const router = await routerAt("/map?lat=59.33&lng=18.07&zoom=9&clustering=off&node_type=repeater&flow=on");

    expect(routeSearch(router)).toMatchObject({
      lat: 59.33,
      lng: 18.07,
      zoom: 9,
      clustering: false,
      node_type: "repeater",
      flow: true,
    });
  });

  it("validates Map and Analytics state at their own route boundaries", async () => {
    // Unknown raw query keys remain in TanStack Router's merged search object, but only the owning
    // route validator coerces them. This guards against moving Map/Analytics parsing back to root.
    const nodeRouter = await routerAt("/nodes?lat=59.33&lng=18.07");
    expect(routeSearch(nodeRouter).lat).toBe("59.33");

    const mapRouter = await routerAt("/map?lat=59.33&lng=18.07&zoom=9");
    expect(routeSearch(mapRouter)).toMatchObject({ lat: 59.33, lng: 18.07, zoom: 9 });

    const analyticsRouter = await routerAt("/analytics?statsTab=observer&observerId=o1&range=7d");
    expect(routeSearch(analyticsRouter)).toMatchObject({ statsTab: "observer", observerId: "o1", range: "7d" });
  });

  it("serializes multi-value filters with the established CSV contract", async () => {
    const router = await routerAt("/packets");
    await router.navigate({
      to: "/packets",
      search: (prev) => ({ ...prev, types: [2, 4], scope: ["#north", "#west"] }),
    });

    expect(router.state.location.href).toContain("types=2%2C4");
    expect(router.state.location.href).toContain("scope=%23north%2C%23west");
    expect(routeSearch(router).types).toEqual([2, 4]);
  });

  it("restores route state through browser back navigation", async () => {
    const router = await routerAt("/packets?types=4");
    await router.navigate({ to: "/nodes/node-1", search: (prev) => ({ ...prev }) });
    expect(router.state.location.pathname).toBe("/nodes/node-1");

    router.history.back();
    await router.load();

    expect(router.state.location.pathname).toBe("/packets");
    expect(routeSearch(router).types).toEqual([4]);
  });

  it("validates Nodes, Observers, Channels, and Traces list state from URLs", async () => {
    const nodes = await routerAt("/nodes?nq=alice&nsf=pubkey&nt=REPEATER&np=true&ntr=false&ns=%23east&nsort=radio&ndir=desc");
    expect(routeSearch(nodes)).toMatchObject({
      nq: "alice", nsf: "pubkey", nt: "REPEATER", np: "true", ntr: "false",
      ns: "#east", nsort: "radio", ndir: "desc",
    });

    const observers = await routerAt("/observers?oq=raven&ost=offline&ot=mqtt&ob=broker-1&os=%23west&osort=status&odir=desc");
    expect(routeSearch(observers)).toMatchObject({
      oq: "raven", ost: "offline", ot: "mqtt", ob: "broker-1", os: "#west",
      osort: "status", odir: "desc",
    });

    const channels = await routerAt("/channels?cq=ops&csf=hash&ck=known&ch=false");
    expect(routeSearch(channels)).toMatchObject({ cq: "ops", csf: "hash", ck: "known", ch: "false" });

    const traces = await routerAt("/traces?tt=PING");
    expect(routeSearch(traces).tt).toBe("PING");
  });

  it("falls back safely for invalid list params", async () => {
    const nodes = await routerAt("/nodes?nsf=anything&np=maybe&ntr=yes&nsort=last_seen&ndir=sideways");
    expect(routeSearch(nodes)).toMatchObject({
      nsf: undefined,
      np: undefined,
      ntr: undefined,
      nsort: undefined,
      ndir: undefined,
    });

    const observers = await routerAt("/observers?ost=away&osort=unknown&odir=sideways");
    expect(routeSearch(observers)).toMatchObject({ ost: undefined, osort: undefined, odir: undefined });
    const channels = await routerAt("/channels?csf=id&ck=maybe&ch=yes");
    expect(routeSearch(channels)).toMatchObject({ csf: undefined, ck: undefined, ch: undefined });
    const traces = await routerAt("/traces?tt=UNKNOWN");
    expect(routeSearch(traces).tt).toBeUndefined();
  });

  it("reproduces configured list state after reload", async () => {
    const first = await routerAt("/nodes");
    await first.navigate({
      to: "/nodes",
      search: (prev) => ({ ...prev, nq: "alice", nt: "REPEATER", nsort: "radio", ndir: "desc" }),
    });

    const reloaded = await routerAt(first.state.location.href);
    expect(routeSearch(reloaded)).toMatchObject({ nq: "alice", nt: "REPEATER", nsort: "radio", ndir: "desc" });
  });

  it("restores list filters and sorting through Back and Forward", async () => {
    const router = await routerAt("/nodes");
    await router.navigate({ to: "/nodes", search: (prev) => ({ ...prev, nt: "REPEATER" }) });
    await router.navigate({ to: "/nodes", search: (prev) => ({ ...prev, nsort: "radio", ndir: "desc" }) });

    router.history.back();
    await router.load();
    expect(routeSearch(router)).toMatchObject({ nt: "REPEATER", nsort: undefined, ndir: undefined });

    router.history.forward();
    await router.load();
    expect(routeSearch(router)).toMatchObject({ nt: "REPEATER", nsort: "radio", ndir: "desc" });
  });

  it("keeps repeated text-search replacements out of browser history", async () => {
    const router = await routerAt("/nodes");
    await router.navigate({ to: "/nodes", search: (prev) => ({ ...prev, nt: "REPEATER" }) });
    for (const nq of ["a", "al", "ali", "alice"]) {
      await router.navigate({ to: "/nodes", replace: true, search: (prev) => ({ ...prev, nq }) });
    }

    router.history.back();
    await router.load();
    expect(routeSearch(router).nt).toBeUndefined();
    expect(routeSearch(router).nq).toBeUndefined();
  });
});
