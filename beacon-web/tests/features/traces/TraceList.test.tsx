import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { TraceList } from '../../../src/features/traces/TraceList';
import { RegionProvider } from '../../../src/hooks/useRegion';
import { ALL_REGIONS } from '../../../src/hooks/region-selection';
import { getTraces, getTraceDetail, getRegions } from '../../../src/api/client';
import { timeAgoMs } from '../../../src/lib/formatters';
import type { TraceTagSummary, TraceDetail } from '../../../src/types/api';

// jsdom has no viewport geometry; retain the real virtualizer with a measured viewport.
vi.mock('@tanstack/react-virtual', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-virtual')>();
  return {
    ...actual,
    useVirtualizer: (options: Parameters<typeof actual.useVirtualizer>[0]) =>
      actual.useVirtualizer({
        ...options,
        observeElementRect: (_, callback) => {
          callback({ width: 1200, height: 800 });
          return () => {};
        },
        measureElement: () => 84,
      }),
  };
});

vi.mock('../../../src/api/client', () => ({
  getTraces: vi.fn(),
  getTraceDetail: vi.fn(),
  getRegions: vi.fn(),
}));

const mockGetTraces = vi.mocked(getTraces);
const mockGetTraceDetail = vi.mocked(getTraceDetail);
const mockGetRegions = vi.mocked(getRegions);

function tag(
  traceTag: string,
  packetCount = 1,
  extra: Partial<TraceTagSummary> = {},
): TraceTagSummary {
  return {
    traceTag,
    firstHeardAt: 1,
    lastHeardAt: 2,
    packetCount,
    iataCount: 1,
    traceType: 'TRACE',
    pathHashes: [],
    snrValues: [],
    ...extra,
  };
}

const detail: TraceDetail = {
  traceTag: '3f2a11c0',
  packets: [
    {
      packetHash: 'hash-aaa',
      routeType: 1,
      routeTypeName: 'ROUTE_REQUEST',
      firstHeardAt: 1,
      lastHeardAt: 2,
      rawPath: [],
      resolvedRoute: [],
    },
    {
      packetHash: 'hash-bbb',
      routeType: 1,
      routeTypeName: 'ROUTE_REQUEST',
      firstHeardAt: 1,
      lastHeardAt: 2,
      rawPath: [],
      resolvedRoute: [],
    },
  ],
};

function renderTraces(onAnalyze = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <RegionProvider defaultSelection={ALL_REGIONS}>{children}</RegionProvider>
    </QueryClientProvider>
  );
  function TraceHarness() {
    const [typeFilter, setTypeFilter] = useState<'' | 'TRACE' | 'PING'>('');
    return (
      <TraceList onAnalyze={onAnalyze} typeFilter={typeFilter} onTypeFilterChange={setTypeFilter} />
    );
  }
  const result = render(<TraceHarness />, { wrapper });
  return { onAnalyze, ...result };
}

beforeEach(() => {
  mockGetTraces.mockReset();
  mockGetTraceDetail.mockReset();
  mockGetRegions.mockReset();
  mockGetRegions.mockResolvedValue([]);
});

describe('TraceList', () => {
  it('renders a card per trace tag and no detail panel until one is clicked', async () => {
    mockGetTraces.mockResolvedValue([tag('3f2a11c0', 12), tag('9b40de22', 5)]);

    renderTraces();

    expect(await screen.findByText('3F2A11C0')).toBeInTheDocument();
    expect(screen.getByText('9B40DE22')).toBeInTheDocument();
    // no detail panel yet -> no packet-analysis rows (tag headers stay in the table)
    expect(screen.queryByText('hash-aaa')).not.toBeInTheDocument();
  });

  it("opens the detail panel with a Packets section listing the trace's packets when a card is clicked", async () => {
    mockGetTraces.mockResolvedValue([tag('3f2a11c0', 2)]);
    mockGetTraceDetail.mockResolvedValue(detail);

    renderTraces();

    fireEvent.click(await screen.findByText('3F2A11C0'));

    expect(await screen.findByText('Packets')).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByText('ROUTE_REQUEST')).toHaveLength(2));
    expect(mockGetTraceDetail).toHaveBeenCalledWith('3f2a11c0');
  });

  it("shows each packet's first/last heard with millisecond precision", async () => {
    mockGetTraces.mockResolvedValue([tag('3f2a11c0', 1)]);
    mockGetTraceDetail.mockResolvedValue({
      traceTag: '3f2a11c0',
      packets: [
        {
          packetHash: 'hash-aaa',
          routeType: 1,
          routeTypeName: 'ROUTE_REQUEST',
          firstHeardAt: 1717689045001,
          lastHeardAt: 1717689045123,
          rawPath: [],
          resolvedRoute: [],
        },
      ],
    });

    renderTraces();
    fireEvent.click(await screen.findByText('3F2A11C0'));

    // First/Last show a relative label (same here, 122ms apart); the exact ms is in the hover tooltip
    const labels = await screen.findAllByText(`${timeAgoMs(1717689045001)} ago`);
    expect(labels).toHaveLength(2);
    fireEvent.pointerMove(labels[0], { pointerType: 'mouse' });
    expect((await screen.findByRole('tooltip')).textContent).toMatch(/\.001$/); // First, ms preserved
    fireEvent.pointerLeave(labels[0], { pointerType: 'mouse' });
    fireEvent.pointerMove(labels[1], { pointerType: 'mouse' });
    await waitFor(() => expect(screen.getByRole('tooltip').textContent).toMatch(/\.123$/)); // Last, ms preserved
  });

  it('aborts the superseded filter fetch so a stale 200-row response never commits', async () => {
    let resolveFirst!: (value: TraceTagSummary[]) => void;
    const first = new Promise<TraceTagSummary[]>((resolve) => {
      resolveFirst = resolve;
    });
    mockGetTraces.mockImplementationOnce(() => first);
    mockGetTraces.mockResolvedValue([tag('ping-tag', 1, { traceType: 'PING' })]);

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>
        <RegionProvider defaultSelection={ALL_REGIONS}>{children}</RegionProvider>
      </QueryClientProvider>
    );
    function TraceHarness() {
      const [typeFilter, setTypeFilter] = useState<'' | 'TRACE' | 'PING'>('');
      return (
        <TraceList onAnalyze={vi.fn()} typeFilter={typeFilter} onTypeFilterChange={setTypeFilter} />
      );
    }
    render(<TraceHarness />, { wrapper });

    // switch All -> Ping while the All fetch is still in flight: TanStack must abort it
    fireEvent.click(screen.getByRole('button', { name: 'Ping' }));
    await screen.findByText('PING-TAG');
    resolveFirst([tag('stale-tag', 1)]);
    // let the stale promise settle — it must not clobber the Ping view
    await waitFor(() => expect(screen.queryByText('STALE-TAG')).not.toBeInTheDocument());
    expect(screen.getByText('PING-TAG')).toBeInTheDocument();
  });

  it('renders dense timestamp cells as static text without ticker or tooltip trees', async () => {
    mockGetTraces.mockResolvedValue([
      tag('3f2a11c0', 4, { traceType: 'PING', pathHashes: ['a1', 'b2'], snrValues: [-7.5, -9] }),
    ]);

    renderTraces();

    await screen.findByText('3F2A11C0');
    // static timestamps carry the absolute time as a native title, not a Radix tooltip
    const cells = screen.getAllByTitle(/^\d{4}-\d{2}-\d{2} /);
    expect(cells.length).toBeGreaterThan(0);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('opens Analyze explicitly without making the entire packet row clickable', async () => {
    mockGetTraces.mockResolvedValue([tag('3f2a11c0', 2)]);
    mockGetTraceDetail.mockResolvedValue(detail);

    const { onAnalyze } = renderTraces();

    fireEvent.click(await screen.findByText('3F2A11C0'));
    const rows = await screen.findAllByText('ROUTE_REQUEST');
    fireEvent.click(rows[0]);
    expect(onAnalyze).not.toHaveBeenCalled();
    fireEvent.click(screen.getAllByRole('button', { name: /Analyze/ })[0]);

    expect(onAnalyze).toHaveBeenCalledWith('hash-aaa');
  });

  it("renders each hop's raw path-hash byte and surfaces resolved nodes in the popover", async () => {
    mockGetTraces.mockResolvedValue([tag('3f2a11c0', 1)]);
    mockGetTraceDetail.mockResolvedValue({
      traceTag: '3f2a11c0',
      packets: [
        {
          packetHash: 'hash-aaa',
          routeType: 1,
          routeTypeName: 'ROUTE_REQUEST',
          firstHeardAt: 1,
          lastHeardAt: 2,
          rawPath: [{ hash: 'a1' }, { hash: 'b2', snr: -7.5 }],
          resolvedRoute: [
            { confidence: 'high', nodes: [{ id: 'n1', name: 'GatewayX', publicKey: 'deadbeef' }] },
            { confidence: 'none', nodes: [] },
          ],
        },
      ],
    });

    renderTraces();
    fireEvent.click(await screen.findByText('3F2A11C0'));

    // the packet's compact hop list reads like the packet-path view: step number,
    // resolved hop, then the link SNR entering it (SNR[1] = the A1→B2 link)
    const hopA = await screen.findByText('GatewayX');
    expect(hopA).toBeInTheDocument();
    expect(screen.getByText('B2')).toBeInTheDocument();
    expect(screen.getByText('-7.50 dB')).toBeInTheDocument();

    // raw hash remains available in the resolved hop popover for debugging.
    fireEvent.mouseEnter(hopA);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Hash A1');
  });

  it('tags each card as TRACE or PING and previews the most complete path with per-hop SNR', async () => {
    mockGetTraces.mockResolvedValue([
      tag('3f2a11c0', 4, { traceType: 'PING', pathHashes: ['a1', 'b2'], snrValues: [-7.5, -9] }),
    ]);

    renderTraces();

    expect(await screen.findByText('3F2A11C0')).toBeInTheDocument();
    expect(screen.getByText('PING')).toBeInTheDocument();
    // the path preview shows each hop's hash byte (uppercased); SNR[1] labels the A1→B2 link
    expect(screen.getByText('A1')).toBeInTheDocument();
    expect(screen.getByText('B2')).toBeInTheDocument();
    expect(screen.getByText('-9.00 dB')).toBeInTheDocument();
  });

  it('shows resolved node names in the list preview only for high confidence', async () => {
    mockGetTraces.mockResolvedValue([
      tag('3f2a11c0', 4, {
        traceType: 'TRACE',
        pathHashes: ['a1', 'b2', 'c3'],
        snrValues: [-7.5, -9, -8],
        resolvedPath: [
          { confidence: 'high', nodeName: 'GatewayX' },
          { confidence: 'ambiguous' },
          { confidence: 'none' },
        ],
      }),
    ]);

    renderTraces();

    expect(await screen.findByText('3F2A11C0')).toBeInTheDocument();
    // high-confidence hop shows the node name with the raw prefix retained in the title
    expect(screen.getByText('GatewayX')).toBeInTheDocument();
    // ambiguous and unresolved hops fall back to the raw prefix
    expect(screen.getByText('B2')).toBeInTheDocument();
    expect(screen.getByText('C3')).toBeInTheDocument();
    // SNR[i] labels link i-1 → i: SNR[1] (-9) renders before B2, SNR[2] (-8) before C3
    expect(screen.getByText('-9.00 dB')).toBeInTheDocument();
    expect(screen.getByText('-8.00 dB')).toBeInTheDocument();
  });

  it('places preview SNR on the inbound edge: A → SNR → B → SNR → C (issue #96)', async () => {
    // hashes = [A, B, C], snr = [ignored, 8.5, 6.25]: the first hop must show no SNR
    // and every later SNR must precede its receiving hop in DOM order.
    mockGetTraces.mockResolvedValue([
      tag('3f2a11c0', 4, {
        traceType: 'TRACE',
        pathHashes: ['aa', 'bb', 'cc'],
        snrValues: [99, 8.5, 6.25],
      }),
    ]);

    const { container } = renderTraces();

    expect(await screen.findByText('3F2A11C0')).toBeInTheDocument();
    // SNR[0] (99) has no upstream link and must never render — not even for the origin hop.
    expect(screen.queryByText('99.00 dB')).not.toBeInTheDocument();
    expect(screen.getByText('8.50 dB')).toBeInTheDocument();
    expect(screen.getByText('6.25 dB')).toBeInTheDocument();
    const text = container.textContent ?? '';
    const idxA = text.indexOf('AA');
    const idxSnr1 = text.indexOf('8.50 dB');
    const idxB = text.indexOf('BB');
    const idxSnr2 = text.indexOf('6.25 dB');
    const idxC = text.indexOf('CC');
    expect([idxA, idxSnr1, idxB, idxSnr2, idxC].every((i) => i >= 0)).toBe(true);
    expect(idxA).toBeLessThan(idxSnr1);
    expect(idxSnr1).toBeLessThan(idxB);
    expect(idxB).toBeLessThan(idxSnr2);
    expect(idxSnr2).toBeLessThan(idxC);
    // The inbound edges expose accessible labels tying each SNR to its receiving hop.
    expect(screen.getByRole('group', { name: '8.50 dB inbound to BB' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: '6.25 dB inbound to CC' })).toBeInTheDocument();
  });

  it('renders a real 0 dB preview reading instead of dropping it as missing', async () => {
    mockGetTraces.mockResolvedValue([
      tag('3f2a11c0', 4, {
        traceType: 'TRACE',
        pathHashes: ['aa', 'bb'],
        snrValues: [99, 0],
      }),
    ]);

    renderTraces();

    expect(await screen.findByText('3F2A11C0')).toBeInTheDocument();
    expect(screen.getByText('0.00 dB')).toBeInTheDocument();
    expect(screen.queryByText('99.00 dB')).not.toBeInTheDocument();
  });

  it('refetches with the type param when the trace-type filter changes', async () => {
    mockGetTraces.mockResolvedValue([tag('3f2a11c0', 1)]);

    renderTraces();
    await screen.findByText('3F2A11C0');

    fireEvent.click(screen.getByRole('button', { name: 'Ping' }));

    // the region arg is undefined for "all regions", so assert on the params object directly
    await waitFor(() =>
      expect(mockGetTraces.mock.calls.at(-1)?.[1]).toMatchObject({ type: 'PING' }),
    );
  });

  it('truncates the desktop path preview with a +N remainder', async () => {
    const hashes = Array.from({ length: 9 }, (_, i) => `h${i}`);
    mockGetTraces.mockResolvedValue([
      tag('3f2a11c0', 4, { traceType: 'TRACE', pathHashes: hashes, snrValues: [] }),
    ]);

    renderTraces();

    expect(await screen.findByText('3F2A11C0')).toBeInTheDocument();
    expect(screen.getByText('+5')).toBeInTheDocument();
  });

  it('shows an empty state when there are no traces', async () => {
    mockGetTraces.mockResolvedValue([]);

    renderTraces();

    expect(await screen.findByText('No traces')).toBeInTheDocument();
  });
});
