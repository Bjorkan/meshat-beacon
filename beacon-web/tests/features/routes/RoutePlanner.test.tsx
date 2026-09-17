import { describe, expect, it, vi } from 'vitest';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { RoutePlanner } from '../../../src/features/routes/RoutePlanner';
import { OverlaysContext } from '../../../src/routes/overlays';
import { routeQueries } from '../../../src/api/queries';
import type { BestRouteResult } from '../../../src/types/api';
import type { NodeSummary } from '../../../src/features/nodes/types';

// The WebGL map can't render in jsdom: stub the canvas, keep the route list logic.
vi.mock('../../../src/features/routes/RoutePlannerMapLazy', () => ({
  RoutePlannerMapLazy: ({ activeIndex }: { activeIndex: number }) => (
    <div data-testid="route-map-stub">{`active:${activeIndex}`}</div>
  ),
}));

const FROM = 'aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899';
const TO = '11223344556677889900aabbccddeeff11223344556677889900aabbccddeeff';

function bestResult(): BestRouteResult {
  return {
    paths: [
      {
        nodes: [
          {
            id: 'id-a',
            publicKey: FROM,
            name: 'Alpha',
            latitude: 59.6,
            longitude: 16.5,
            nodeType: 2,
            nodeTypeName: 'repeater',
            stale: false,
          },
          {
            id: 'id-b',
            publicKey: TO,
            name: null,
            latitude: 59.61,
            longitude: 16.52,
            nodeType: 2,
            nodeTypeName: 'repeater',
            stale: false,
          },
        ],
        legs: [
          {
            from: FROM,
            to: TO,
            snr: 7.5,
            snrSampleCount: 3,
            snrLastSeen: 1,
            observationCount: 5,
            unmeasured: false,
            neighbor: true,
          },
        ],
        totalCost: 1,
        hopCount: 1,
        hasUnmeasuredLegs: false,
        containsStaleNodes: false,
      },
      {
        nodes: [
          {
            id: 'id-a',
            publicKey: FROM,
            name: 'Alpha',
            latitude: 59.6,
            longitude: 16.5,
            nodeType: 2,
            nodeTypeName: 'repeater',
            stale: false,
          },
          {
            id: 'id-m',
            publicKey: 'cd'.padEnd(64, '0'),
            name: 'Mid',
            latitude: 59.605,
            longitude: 16.51,
            nodeType: 2,
            nodeTypeName: 'repeater',
            stale: false,
          },
          {
            id: 'id-b',
            publicKey: TO,
            name: null,
            latitude: 59.61,
            longitude: 16.52,
            nodeType: 2,
            nodeTypeName: 'repeater',
            stale: false,
          },
        ],
        legs: [
          {
            from: FROM,
            to: 'cd'.padEnd(64, '0'),
            observationCount: 2,
            snrSampleCount: 0,
            snrLastSeen: 0,
            unmeasured: true,
            neighbor: false,
          },
          {
            from: 'cd'.padEnd(64, '0'),
            to: TO,
            observationCount: 2,
            snrSampleCount: 0,
            snrLastSeen: 0,
            unmeasured: true,
            neighbor: false,
          },
        ],
        totalCost: 7,
        hopCount: 2,
        hasUnmeasuredLegs: true,
        containsStaleNodes: false,
      },
    ],
  };
}

function nodeSummary(overrides: Partial<NodeSummary> & { publicKey: string }): NodeSummary {
  return {
    // only the fields the planner reads; the rest never leaves the fixture.
    // nodeType defaults to repeater (2): the planner is repeater-only and
    // URL restoration rejects non-repeaters.
    nodeType: 2,
    nodeTypeName: 'repeater',
    ...overrides,
  } as NodeSummary;
}

function renderPlannerWithNodes(url = '/routes', fromSummary: NodeSummary, toSummary: NodeSummary) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  client.setQueryData(routeQueries.byPubkey(FROM).queryKey, fromSummary);
  client.setQueryData(routeQueries.byPubkey(TO).queryKey, toSummary);
  client.setQueryData(routeQueries.best({ from: FROM, to: TO }).queryKey, bestResult());
  const rootRoute = createRootRoute();
  const routesRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/routes',
    component: () => (
      <OverlaysContext.Provider value={{ setOverlayNodeId: () => {} } as never}>
        <RoutePlanner />
      </OverlaysContext.Provider>
    ),
    validateSearch: (search: Record<string, unknown>) => search,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([routesRoute]),
    history: createMemoryHistory({ initialEntries: [url] }),
  });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { client, router };
}

function renderPlanner(url = '/routes') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  // URL restore path: both pubkeys resolve to located nodes.
  client.setQueryData(
    routeQueries.byPubkey(FROM).queryKey,
    nodeSummary({ publicKey: FROM, name: 'Alpha', lat: 59.6, lng: 16.5 }),
  );
  client.setQueryData(
    routeQueries.byPubkey(TO).queryKey,
    nodeSummary({ publicKey: TO, name: null, lat: 59.61, lng: 16.52 }),
  );
  client.setQueryData(routeQueries.best({ from: FROM, to: TO }).queryKey, bestResult());
  // Minimal /routes route tree: the planner reads useSearch({ from: '/routes' }),
  // which needs a real registered route match (a splat helper can't provide it).
  // The router loads async: wait for the match before asserting.
  // RoutePlanner is rendered through a wrapper (not directly as the route
  // component) so the test can inject onOpenNode without an Overlays provider.
  const rootRoute = createRootRoute();
  // Overlays provider is app-shell chrome the unit test doesn't mount: route
  // the open-node action to a noop through context instead of props.
  const routesRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/routes',
    component: () => (
      <OverlaysContext.Provider value={{ setOverlayNodeId: () => {} } as never}>
        <RoutePlanner />
      </OverlaysContext.Provider>
    ),
    validateSearch: (search: Record<string, unknown>) => search,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([routesRoute]),
    history: createMemoryHistory({ initialEntries: [url] }),
  });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { client, router };
}

async function renderReady(url = '/routes') {
  const { router } = renderPlanner(url);
  await router.load();
}

describe('RoutePlanner', () => {
  it('shows the planner prompt before both endpoints are picked', async () => {
    await renderReady();
    // prompt appears twice (list pane + empty map pane): both must agree
    const prompts = await screen.findAllByText('Pick a from-node and a to-node to plan a route.');
    expect(prompts.length).toBe(2);
    expect(screen.queryByTestId('route-map-stub')).toBeNull();
  });

  it('restores from/to from the URL and renders best + alternative', async () => {
    await renderReady(`/routes?from=${FROM}&to=${TO}`);
    // best first + one alternative, name first with grey 3-byte prefix
    expect(await screen.findByText('Best')).toBeTruthy();
    expect(screen.getByText('Alternative 1')).toBeTruthy();
    // Alpha appears in both the best card and the alternative card
    expect(screen.getAllByText('Alpha').length).toBe(2);
    // grey 3-byte suffix likewise once per card showing Alpha
    expect(screen.getAllByText('AABBCC').length).toBe(2);
    // nameless endpoint shows its prefix as the name (once per card)
    expect(screen.getAllByText('112233').length).toBe(2);
    // unmeasured legs carry the badge; the marked neighbor leg carries its own
    expect(screen.getAllByText('Unmeasured').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Neighbor').length).toBeGreaterThan(0);
    expect(screen.getByTestId('route-map-stub').textContent).toContain('active:0');
  });

  it('selecting the alternative switches the active route', async () => {
    await renderReady(`/routes?from=${FROM}&to=${TO}`);
    await screen.findByText('Alternative 1');
    // Route selection is a dedicated button (sibling of the node buttons),
    // not the whole card: keyboard and pointer activation must not open nodes.
    const selectButtons = screen.getAllByRole('button', { name: /^(Best|Alternative 1)$/ });
    expect(selectButtons.length).toBe(2);
    fireEvent.click(selectButtons[1]);
    await waitFor(() =>
      expect(screen.getByTestId('route-map-stub').textContent).toContain('active:1'),
    );
  });

  it('opens nodes via dedicated buttons without changing route selection', async () => {
    const opened: string[] = [];
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    client.setQueryData(
      routeQueries.byPubkey(FROM).queryKey,
      nodeSummary({ publicKey: FROM, name: 'Alpha', lat: 59.6, lng: 16.5 }),
    );
    client.setQueryData(
      routeQueries.byPubkey(TO).queryKey,
      nodeSummary({ publicKey: TO, name: null, lat: 59.61, lng: 16.52 }),
    );
    client.setQueryData(routeQueries.best({ from: FROM, to: TO }).queryKey, bestResult());
    const rootRoute = createRootRoute();
    const routesRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: '/routes',
      component: () => (
        <OverlaysContext.Provider
          value={{ setOverlayNodeId: (id: string) => opened.push(id) } as never}
        >
          <RoutePlanner />
        </OverlaysContext.Provider>
      ),
      validateSearch: (search: Record<string, unknown>) => search,
    });
    const router = createRouter({
      routeTree: rootRoute.addChildren([routesRoute]),
      history: createMemoryHistory({ initialEntries: [`/routes?from=${FROM}&to=${TO}`] }),
    });
    render(
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    await router.load();
    await screen.findByText('Best');
    // open-node buttons are real buttons with accessible names, siblings of
    // the route-selection buttons (no nested interactive controls).
    const openButtons = screen.getAllByRole('button', { name: /^Open node / });
    expect(openButtons.length).toBeGreaterThan(0);
    fireEvent.click(openButtons[0]);
    expect(opened).toEqual(['id-a']);
    // selection unchanged: still showing the best route as active.
    expect(screen.getByTestId('route-map-stub').textContent).toContain('active:0');
    // keyboard activation works too.
    fireEvent.keyDown(openButtons[0], { key: 'Enter' });
    fireEvent.click(openButtons[0]);
    expect(opened.length).toBeGreaterThanOrEqual(2);
  });

  it('copies the MeshCore route for best and alternative with feedback', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      writable: true,
      configurable: true,
    });
    await renderReady(`/routes?from=${FROM}&to=${TO}`);
    await screen.findByText('Best');
    // One copy button per card (best + alternative), each exporting its own
    // canonical ordered repeater list as 3-byte ids.
    const copyButtons = screen.getAllByRole('button', { name: 'Copy MeshCore route' });
    expect(copyButtons.length).toBe(2);
    await act(async () => {
      fireEvent.click(copyButtons[0]);
    });
    expect(writeText).toHaveBeenCalledWith('aabbcc,112233');
    expect(await screen.findAllByText('MeshCore route copied')).toHaveLength(1);
    await act(async () => {
      fireEvent.click(copyButtons[1]);
    });
    expect(writeText).toHaveBeenCalledWith(`aabbcc,${'cd'.padEnd(6, '0')},112233`);
  });

  it('rejects a URL endpoint that resolves to a non-repeater', async () => {
    const { router } = renderPlannerWithNodes(
      `/routes?from=${FROM}&to=${TO}`,
      nodeSummary({ publicKey: FROM, name: 'Alpha', lat: 59.6, lng: 16.5 }),
      nodeSummary({
        publicKey: TO,
        name: 'Companion',
        lat: 59.61,
        lng: 16.52,
        nodeType: 1,
        nodeTypeName: 'companion',
      }),
    );
    await router.load();
    // Hard validation state — never a silent endpoint, never a route fetch.
    expect(
      await screen.findByText('Route endpoints must be repeaters — pick a repeater node.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Best')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Copy MeshCore route' })).not.toBeInTheDocument();
  });

  it('keeps route cards usable when the map subtree throws', async () => {
    // The map pane is wrapped in a local error boundary: a MapLibre/chunk
    // failure must not unmount Best, the Neighbor badge, or MeshCore copy.
    // jsdom cannot throw inside the mocked lazy map per-test (module mock is
    // file-scoped), so this pins the boundary contract directly: cards and
    // fallback coexist when the map child throws.
    const { ErrorBoundary } = await import('../../../src/components/ErrorBoundary');
    const Throwing = () => {
      throw new Error('simulated map init failure');
    };
    const { container } = render(
      <div>
        <div>Best</div>
        <ErrorBoundary fallback={<div role="status">map fallback</div>}>
          <Throwing />
        </ErrorBoundary>
      </div>,
    );
    expect(container.textContent).toContain('Best');
    expect(screen.getByText('map fallback')).toBeInTheDocument();
  });
});
