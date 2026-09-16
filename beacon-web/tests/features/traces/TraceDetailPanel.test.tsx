import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TraceDetailPanel } from '../../../src/features/traces/TraceDetailPanel';
import { traceQueries } from '../../../src/api/queries';
import type { TracePacket } from '../../../src/types/api';

// The WebGL map can't render in jsdom: stub the canvas, keep the packet list + selector logic.
vi.mock('../../../src/features/traces/TracePathMapLazy', () => ({
  TracePathMapLazy: ({ selectedKey }: { selectedKey: string | null }) => (
    <div data-testid="trace-map">{selectedKey ?? 'all'}</div>
  ),
}));

function packet(overrides: Partial<TracePacket> = {}): TracePacket {
  return {
    packetHash: 'old',
    routeType: 1,
    routeTypeName: 'FLOOD',
    firstHeardAt: 1,
    lastHeardAt: 2,
    rawPath: [],
    resolvedRoute: [],
    ...overrides,
  };
}

function renderDetail(packets: TracePacket[]) {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
  client.setQueryData(traceQueries.detail('abcd').queryKey, { traceTag: 'abcd', packets });
  const onAnalyze = vi.fn();
  const onViewNode = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <TraceDetailPanel
        tag="abcd"
        onClose={vi.fn()}
        onAnalyze={onAnalyze}
        onViewNode={onViewNode}
      />
    </QueryClientProvider>,
  );
  return { onAnalyze, onViewNode };
}

describe('TraceDetailPanel', () => {
  it('renders the packet-path section with a hop list and an explicit analyze action', () => {
    const { onAnalyze } = renderDetail([
      packet({
        rawPath: [{ hash: 'aa' }, { hash: 'bb', snr: -7.5 }],
        resolvedRoute: [
          { confidence: 'high', nodes: [{ id: 'gateway', name: 'Gateway', publicKey: 'aa' }] },
          { confidence: 'none', nodes: [] },
        ],
      }),
    ]);
    expect(screen.getByText('Packet path')).toBeInTheDocument();
    // nothing located: the map stays out of the way and explains why
    expect(screen.queryByTestId('trace-map')).not.toBeInTheDocument();
    expect(screen.getByText('No verified route to display')).toBeInTheDocument();
    // the packet's compact hop list reads like the packet-path view: resolved hop first,
    // then the link SNR entering it (SNR[1] = the AA→BB link)
    expect(screen.getByText('Gateway')).toBeInTheDocument();
    expect(screen.getByText('BB')).toBeInTheDocument();
    expect(screen.getByText('-7.50 dB')).toBeInTheDocument();
    const analyze = screen.getByRole('button', { name: /Analyze/ });
    fireEvent.click(analyze);
    expect(onAnalyze).toHaveBeenCalledExactlyOnceWith('old');
  });

  it('keeps newest-first ordering and optional scope per packet', () => {
    const { onAnalyze } = renderDetail([
      packet(),
      packet({ packetHash: 'new', lastHeardAt: 9, scope: 'EU' }),
      packet({ packetHash: 'middle', lastHeardAt: 5 }),
    ]);
    const packets = screen.getAllByRole('article');
    expect(packets.map((p) => p.getAttribute('aria-label'))).toEqual(['NEW', 'MIDDLE', 'OLD']);
    expect(within(packets[0]).getByText('EU')).toBeInTheDocument();
    expect(within(packets[1]).queryByText('EU')).not.toBeInTheDocument();
    for (const p of packets) fireEvent.click(within(p).getByRole('button', { name: /Analyze/ }));
    expect(onAnalyze.mock.calls).toEqual([['new'], ['middle'], ['old']]);
  });

  it('isolates a packet on the map when its hash is clicked and keeps node navigation separate', () => {
    const { onAnalyze, onViewNode } = renderDetail([
      packet({
        packetHash: 'pkt-one',
        rawPath: [{ hash: 'aa' }, { hash: 'bb' }, { hash: 'cc', snr: -7.5 }],
        resolvedRoute: [
          {
            confidence: 'high',
            nodes: [
              { id: 'gateway', name: 'Gateway', publicKey: 'aa', longitude: 16.5, latitude: 59.6 },
            ],
          },
          {
            confidence: 'high',
            nodes: [
              { id: 'relay', name: 'Relay', publicKey: 'bb', longitude: 16.52, latitude: 59.61 },
            ],
          },
          { confidence: 'none', nodes: [] },
        ],
      }),
      packet({ packetHash: 'pkt-two' }),
    ]);
    // the first packet resolved two located hops: the map draws with an All selector.
    // Isolating it filters both the map and the packet list down to that packet.
    expect(screen.getByTestId('trace-map')).toHaveTextContent('all');
    expect(screen.getByRole('button', { name: 'All paths' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'PKT-ONE' }));
    expect(screen.getByTestId('trace-map')).toHaveTextContent('pkt-one');
    expect(screen.queryByText('PKT-TWO')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Gateway' }));
    expect(onViewNode).toHaveBeenCalledExactlyOnceWith('gateway');
    expect(onAnalyze).not.toHaveBeenCalled();
  });

  it('shows every hop of a long path without truncation', () => {
    renderDetail([
      packet({
        rawPath: Array.from({ length: 40 }, (_, i) => ({
          hash: `p${i.toString(16).padStart(2, '0')}`,
        })),
      }),
    ]);
    expect(screen.getByText('P00')).toBeInTheDocument();
    expect(screen.getByText('P27')).toBeInTheDocument();
    expect(screen.getByText('#40')).toBeInTheDocument();
  });

  it('shows the empty state without packets', () => {
    renderDetail([]);
    expect(screen.getByText('No packets')).toBeInTheDocument();
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
  });
});
