import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { WsPacketObservation } from '../../../src/types/ws';
import { LivePacketFeed } from '../../../src/features/map/LivePacketFeed';
import { livePacketEntry, pushLivePacket, buildLiveFlowCandidate } from '../../../src/features/map/live-packet-feed';
import { packetFlowColor } from '../../../src/features/map/packet-flow-colors';

function locatedHop(id: string, lng: number, lat: number) {
  return { confidence: 'high' as const, nodes: [{ id, publicKey: 'pk', longitude: lng, latitude: lat }] };
}

function eligibleObservation(
  hash: string,
  over: Partial<WsPacketObservation['data']> = {},
): WsPacketObservation['data'] {
  const base = observation(hash);
  return {
    ...base,
    ...over,
    observation: {
      ...base.observation,
      pathLength: { raw: '82', hashSize: 2, hopCount: 2 },
      resolvedPath: [locatedHop('a', 16.5, 59.6), locatedHop('b', 16.6, 59.61)],
      ...(over.observation ?? {}),
    },
  };
}

function observation(
  hash: string,
  over: Partial<WsPacketObservation['data']> = {},
): WsPacketObservation['data'] {
  return {
    packetHash: hash,
    packet: {
      payloadType: 5,
      payloadTypeName: 'GROUP_TEXT',
      routeType: 1,
      routeTypeName: 'FLOOD',
      isFirstObservation: true,
      observationCount: 2,
      scope: 'GOT',
    },
    observation: {
      observerId: 'observer-1',
      observerName: 'Observer',
      iata: 'GOT',
      heardAt: Date.now(),
      rssi: -90,
      snr: 7,
      sourceBroker: 'test',
      pathLength: { raw: '02', hashSize: 1, hopCount: 2 },
    },
    ...over,
  };
}

describe('LivePacketFeed', () => {
  it('deduplicates packets, keeps newest first, and caps the feed', () => {
    let entries = ['a', 'b', 'c', 'd', 'e'].map((hash) => livePacketEntry(observation(hash)));
    entries = pushLivePacket(
      entries,
      livePacketEntry(
        observation('a', {
          packet: { ...observation('a').packet, observationCount: 4 },
        }),
      ),
    );
    entries = pushLivePacket(entries, livePacketEntry(observation('f')));
    expect(entries.map((entry) => entry.packetHash)).toEqual(['f', 'a', 'b', 'c', 'd']);
    expect(entries[1]?.observationCount).toBe(4);
  });

  it('uses the map packet color and opens the packet viewer', () => {
    let handler: ((data: WsPacketObservation['data']) => void) | undefined;
    const wsManager = {
      onPacketObservation: vi.fn((next) => {
        handler = next;
        return () => {};
      }),
    };
    const onOpenPacket = vi.fn();
    const { container } = render(
      <LivePacketFeed
        active
        resetKey="all"
        selectedIatas={['GOT']}
        wsManager={wsManager as never}
        onOpenPacket={onOpenPacket}
      />,
    );

    act(() => handler?.(eligibleObservation('packet-a')));
    const row = screen.getByText('GRP_TXT').closest('div.group');
    expect(row).toHaveAttribute('data-packet-color', packetFlowColor('packet-a'));
    expect(row?.getAttribute('style')).toContain(packetFlowColor('packet-a'));
    fireEvent.click(screen.getByRole('button', { name: /packet-a/i }));
    expect(onOpenPacket).toHaveBeenCalledWith('packet-a');
    expect(container).toHaveTextContent('GOT');
  });

  it('can be dismissed and reopened, and disappears outside live mode', () => {
    let handler: ((data: WsPacketObservation['data']) => void) | undefined;
    const wsManager = {
      onPacketObservation: (next: (data: WsPacketObservation['data']) => void) => {
        handler = next;
        return () => {};
      },
    };
    const props = {
      selectedIatas: undefined,
      wsManager: wsManager as never,
      onOpenPacket: () => {},
    };
    const view = render(<LivePacketFeed active resetKey="all:1" {...props} />);

    expect(screen.getByText(/waiting for packets/i)).toBeInTheDocument();
    act(() => handler?.(eligibleObservation('packet-a')));
    fireEvent.click(screen.getByRole('button', { name: /hide live packets/i }));
    expect(screen.queryByRole('region', { name: /live packets/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /show live packets/i }));
    expect(screen.getByRole('region', { name: /live packets/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /hide live packets/i }));
    view.rerender(<LivePacketFeed active={false} resetKey="all:1" {...props} />);
    expect(screen.queryByText('GRP_TXT')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /show live packets/i })).not.toBeInTheDocument();

    view.rerender(<LivePacketFeed active resetKey="all:2" {...props} />);
    act(() => handler?.(eligibleObservation('packet-b')));
    expect(screen.getByRole('button', { name: /show live packets/i })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /live packets/i })).not.toBeInTheDocument();
  });

  it('ignores observations outside the page-wide IATA selection', () => {
    let handler: ((data: WsPacketObservation['data']) => void) | undefined;
    const wsManager = {
      onPacketObservation: (next: (data: WsPacketObservation['data']) => void) => {
        handler = next;
        return () => {};
      },
    };
    render(
      <LivePacketFeed
        active
        resetKey="got"
        selectedIatas={['GOT']}
        wsManager={wsManager as never}
        onOpenPacket={() => {}}
      />,
    );

    act(() =>
      handler?.(
        eligibleObservation('outside', {
          observation: { ...eligibleObservation('outside').observation, iata: 'ARN' },
        }),
      ),
    );
    expect(screen.queryByText('GRP_TXT')).not.toBeInTheDocument();
  });

  it('drops packets that fail the shared map eligibility gate', () => {
    let handler: ((data: WsPacketObservation['data']) => void) | undefined;
    const wsManager = {
      onPacketObservation: (next: (data: WsPacketObservation['data']) => void) => {
        handler = next;
        return () => {};
      },
    };
    render(
      <LivePacketFeed
        active
        resetKey="got"
        selectedIatas={['GOT']}
        wsManager={wsManager as never}
        onOpenPacket={() => {}}
      />,
    );

    // missing resolved path
    act(() => handler?.(eligibleObservation('no-path', { observation: { ...eligibleObservation('no-path').observation, resolvedPath: null } })));
    // 1-byte hashes
    act(() => handler?.(eligibleObservation('tiny', { observation: { ...eligibleObservation('tiny').observation, pathLength: { raw: '02', hashSize: 1, hopCount: 2 } } })));
    // fewer than two located nodes
    act(() =>
      handler?.(
        eligibleObservation('single', {
          observation: {
            ...eligibleObservation('single').observation,
            resolvedPath: [locatedHop('a', 16.5, 59.6)],
          },
        }),
      ),
    );
    expect(screen.queryByText('GRP_TXT')).not.toBeInTheDocument();
    expect(screen.getByText(/waiting for packets/i)).toBeInTheDocument();
  });

  it('shares one eligibility helper with the map renderer', () => {
    // missing path / 1-byte hashes / single located node are all ineligible
    expect(buildLiveFlowCandidate(observation('x').observation)).toBeNull();
    expect(
      buildLiveFlowCandidate(eligibleObservation('x', { observation: { ...eligibleObservation('x').observation, pathLength: { raw: '02', hashSize: 1, hopCount: 2 } } }).observation),
    ).toBeNull();
    // valid 2-byte path with two located nodes is eligible
    const candidate = buildLiveFlowCandidate(eligibleObservation('ok').observation);
    expect(candidate).not.toBeNull();
    expect(candidate!.coords).toHaveLength(2);
  });
});
