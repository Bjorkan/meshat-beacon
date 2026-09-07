import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { createAppRouter } from '../../src/router';

vi.mock('../../src/components/AppShell', () => ({
  AppShell: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('../../src/api/query-ws-bridge', () => ({ QueryWsBridge: () => null }));
vi.mock('../../src/api/ws-instance', () => ({
  wsManager: { connect: vi.fn(), disconnect: vi.fn(), updateSubscription: vi.fn() },
}));
vi.mock('../../src/hooks/useRegion', () => {
  const selection = { regions: [], iatas: [] };
  return {
    RegionProvider: ({ children }: { children: ReactNode }) => children,
    useRegion: () => ({ regionKey: '*', iatas: undefined }),
    useRegionSelection: () => ({ selection }),
  };
});
vi.mock('../../src/api/client', async (original) => ({
  ...(await original<object>()),
  getNode: vi.fn().mockResolvedValue({}),
  getNodeObservations: vi.fn().mockResolvedValue({ items: [] }),
  getNodeNeighbors: vi.fn().mockResolvedValue([]),
}));
vi.mock('../../src/features/nodes/NodeTable', () => ({ NodeTable: () => null }));
vi.mock('../../src/features/map/MapView', () => ({ MapView: () => null }));
vi.mock('../../src/routes/packets-route', () => ({ PacketsRoute: () => null }));
vi.mock('../../src/features/packets/usePacketDetail', () => ({
  usePacketDetail: (hash: string | null) => ({
    data: hash ? { packetHash: hash } : undefined,
    isLoading: false,
  }),
}));
vi.mock('../../src/features/nodes/NodeDetailPanel', () => ({
  NodeDetailPanel: ({
    nodeId,
    onAnalyzePacket,
    onClose,
  }: {
    nodeId: string;
    onAnalyzePacket: (hash: string) => void;
    onClose: () => void;
  }) => (
    <section>
      <span>Node {nodeId}</span>
      <button onClick={() => onAnalyzePacket('packet-a')}>Observation A</button>
      <button onClick={() => onAnalyzePacket('packet-b')}>Observation B</button>
      <button onClick={onClose}>Close node</button>
    </section>
  ),
}));
vi.mock('../../src/features/packets/PacketAnalyzerDrawer', () => ({
  PacketAnalyzerDrawer: ({
    detail,
    onViewNode,
    onClose,
  }: {
    detail?: { packetHash: string };
    onViewNode: (id: string) => void;
    onClose: () => void;
  }) => (
    <section data-testid="analyzer">
      <span>Analyzing {detail?.packetHash}</span>
      <button onClick={() => onViewNode('hop-node')}>Open hop</button>
      <button onClick={onClose}>Close analyzer</button>
    </section>
  ),
}));
async function setup(entry: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createAppRouter(createMemoryHistory({ initialEntries: [entry] }), client);
  await router.load();
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}
describe('node observation analyzer transitions', () => {
  it.each(['/nodes/base-node', '/map?node=base-node'])(
    'replaces one overlay analyzer from %s and closes back to the base node',
    async (entry) => {
      await setup(entry);
      fireEvent.click(await screen.findByRole('button', { name: 'Observation A' }));
      await screen.findByText('Analyzing packet-a');
      fireEvent.click(screen.getByRole('button', { name: 'Open hop' }));
      await screen.findByText('Node hop-node');
      fireEvent.click(screen.getByRole('button', { name: 'Observation B' }));
      await screen.findByText('Analyzing packet-b');
      expect(screen.queryByText('Node hop-node')).toBeNull();
      expect(screen.getAllByTestId('analyzer')).toHaveLength(1);
      // Repeating the cycle never grows an overlay chain.
      fireEvent.click(screen.getByRole('button', { name: 'Open hop' }));
      fireEvent.click(await screen.findByRole('button', { name: 'Observation A' }));
      await screen.findByText('Analyzing packet-a');
      expect(screen.getAllByTestId('analyzer')).toHaveLength(1);
      fireEvent.click(screen.getByRole('button', { name: 'Close analyzer' }));
      expect(screen.queryByTestId('analyzer')).toBeNull();
      expect(screen.getByText('Node base-node')).toBeInTheDocument();
    },
  );
  it('updates the URL-backed analyzer from a node peek and closes deterministically', async () => {
    const router = await setup('/packets?hash=packet-a&analyze=1');
    await screen.findByText('Analyzing packet-a');
    fireEvent.click(screen.getByRole('button', { name: 'Open hop' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Observation B' }));
    await screen.findByText('Analyzing packet-b');
    expect(screen.queryByText('Node hop-node')).toBeNull();
    expect(screen.getAllByTestId('analyzer')).toHaveLength(1);
    expect(router.state.location.search).toMatchObject({ hash: 'packet-b', analyze: '1' });
    fireEvent.click(screen.getByRole('button', { name: 'Close analyzer' }));
    await waitFor(() => expect(screen.queryByTestId('analyzer')).toBeNull());
    expect(router.state.location.search.analyze).toBeUndefined();
  });
});
