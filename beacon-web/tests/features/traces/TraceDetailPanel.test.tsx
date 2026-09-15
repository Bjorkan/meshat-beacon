import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TraceDetailPanel } from '../../../src/features/traces/TraceDetailPanel';
import { traceQueries } from '../../../src/api/queries';
import type { TracePacket } from '../../../src/types/api';

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
  it('renders one packet with named columns, no path and an explicit action', () => {
    const { onAnalyze } = renderDetail([packet()]);
    const table = screen.getByRole('table', { name: /1 packet/ });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((el) => el.textContent),
    ).toEqual(['Type / Scope', 'First heard', 'Last heard', 'Path', 'Analyze →']);
    expect(within(table).getByText('No path')).toBeInTheDocument();
    expect(within(table).getAllByRole('row')).toHaveLength(2);
    const row = within(table).getAllByRole('row')[1];
    expect(row).not.toHaveAttribute('tabindex');
    fireEvent.click(within(row).getByText('FLOOD'));
    expect(onAnalyze).not.toHaveBeenCalled();
    fireEvent.click(within(row).getByRole('button', { name: /Analyze/ }));
    expect(onAnalyze).toHaveBeenCalledExactlyOnceWith('old');
  });

  it('keeps newest-first ordering and optional scope per row', () => {
    const { onAnalyze } = renderDetail([
      packet(),
      packet({ packetHash: 'new', lastHeardAt: 9, scope: 'EU' }),
      packet({ packetHash: 'middle', lastHeardAt: 5 }),
    ]);
    const rows = screen.getAllByRole('row').slice(1);
    expect(within(rows[0]).getByText('EU')).toBeInTheDocument();
    expect(within(rows[1]).queryByText('EU')).not.toBeInTheDocument();
    for (const row of rows) fireEvent.click(within(row).getByRole('button', { name: /Analyze/ }));
    expect(onAnalyze.mock.calls).toEqual([['new'], ['middle'], ['old']]);
  });

  it('preserves ordered mixed-confidence hops, measured SNR and separate node navigation', () => {
    const { onAnalyze, onViewNode } = renderDetail([
      packet({
        rawPath: [{ hash: 'aa', snr: 0 }, { hash: 'bb' }, { hash: 'cc', snr: -7.5 }],
        resolvedRoute: [
          { confidence: 'high', nodes: [{ id: 'gateway', name: 'Gateway', publicKey: 'aa' }] },
          {
            confidence: 'ambiguous',
            nodes: [{ id: 'candidate', name: 'Candidate', publicKey: 'bb' }],
          },
          { confidence: 'none', nodes: [] },
        ],
      }),
    ]);
    const path = screen.getByRole('region', { name: 'Path' });
    expect(path.textContent).toBe('Gateway0.00 dB→BB→CC-7.50 dB');
    expect(within(path).queryByText('Candidate')).not.toBeInTheDocument();
    fireEvent.click(within(path).getByRole('button', { name: 'Gateway' }));
    expect(onViewNode).toHaveBeenCalledExactlyOnceWith('gateway');
    expect(onAnalyze).not.toHaveBeenCalled();
  });

  it('retains all hops in long paths in a keyboard-scrollable region', () => {
    renderDetail([
      packet({
        rawPath: Array.from({ length: 40 }, (_, i) => ({ hash: i.toString(16).padStart(2, '0') })),
      }),
    ]);
    const path = screen.getByRole('region', { name: 'Path' });
    expect(path).toHaveAttribute('tabindex', '0');
    expect(within(path).getByText('00')).toBeInTheDocument();
    expect(within(path).getByText('27')).toBeInTheDocument();
  });

  it('shows the empty state without an empty table', () => {
    renderDetail([]);
    expect(screen.getByText('No packets')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});
