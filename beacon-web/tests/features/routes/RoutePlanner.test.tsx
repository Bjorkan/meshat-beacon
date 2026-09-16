import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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
            publicKey: 'mid'.padEnd(64, '0'),
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
            to: 'mid'.padEnd(64, '0'),
            observationCount: 2,
            snrSampleCount: 0,
            snrLastSeen: 0,
            unmeasured: true,
            neighbor: false,
          },
          {
            from: 'mid'.padEnd(64, '0'),
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
    // only the fields the planner reads; the rest never leaves the fixture
    ...overrides,
  } as NodeSummary;
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
    fireEvent.click(screen.getByText('Alternative 1'));
    await waitFor(() =>
      expect(screen.getByTestId('route-map-stub').textContent).toContain('active:1'),
    );
  });
});
