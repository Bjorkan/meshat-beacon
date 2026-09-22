import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { createMemoryHistory } from '@tanstack/react-router';
import { App } from '../src/App';
import { getChannelMessagesPage } from '../src/api/client';
import { queryClient } from '../src/api/query-client';
import { createAppRouter } from '../src/router';
import type { PacketSummary, PacketDetail } from '../src/types/api';

// The Packets tab's URL contract, exercised through a real App: ?hash expands a row, ?analyze=1 adds
// the drawer on top of it, and a mobile tab change leaves neither behind. Only the network boundary
// and the virtualizer (needs layout/ResizeObserver jsdom doesn't have) are faked.

vi.mock('../src/api/ws-manager', () => {
  class WsManager {
    connect() {}
    disconnect() {}
    updateSubscription() {}
    setResolvePath() {}
    onPacketObservation() {
      return () => {};
    }
    onLagged() {
      return () => {};
    }
    onChannelMessage() {
      return () => {};
    }
    onObserverStatus() {
      return () => {};
    }
    onNodeUpdate() {
      return () => {};
    }
    onStatusChange() {
      return () => {};
    }
    getStatus() {
      return 'disconnected';
    }
    getLastEventTimestamp() {
      return Date.now();
    }
  }
  return { WsManager };
});

vi.mock('../src/api/client', () => ({
  getRegions: async () => [],
  getRegion: async () => ({ id: 0, slug: '', displayName: '', iatas: [] }),
  getIatas: async () => [],
  getScopes: async () => [],
  getChannels: async () => ({ items: [], nextCursor: null, hasMore: false, unknownCount: 0 }),
  getChannel: async (id: number) => ({
    id,
    name: 'Linked channel',
    channelHash: '11',
    keyKnown: true,
    kind: 'hashtag',
    lastSeen: 1000,
  }),
  getChannelMessagesPage: vi.fn(async () => ({ items: [], nextCursor: null, hasMore: false })),
}));

const packet: PacketSummary = {
  packetHash: 'AA11',
  payloadType: 1,
  payloadTypeName: 'ADVERT',
  routeType: 1,
  routeTypeName: 'FLOOD',
  firstHeardAt: 1700000000000,
  lastHeardAt: 1700000002000,
  observationCount: 1,
};

const detail = {
  packetHash: 'AA11',
  header: {
    raw: '12',
    routeType: 1,
    routeTypeName: 'FLOOD',
    payloadType: 1,
    payloadTypeName: 'ADVERT',
    payloadVersion: 1,
  },
  firstHeardAt: 1700000000000,
  lastHeardAt: 1700000002000,
  firstToLastMs: 2000,
  observationCount: 1,
  rawPayload: '',
  decrypted: false,
  observations: [
    {
      id: 1,
      observerId: 'obs1',
      observerName: 'Observer One',
      iata: 'YOW',
      heardAt: 1700000000000,
      sourceBroker: 'b1',
      pathLength: { raw: '00', hashSize: 1, hopCount: 0 },
      resolvedPath: [],
    },
  ],
} as unknown as PacketDetail;

let currentDetail = detail;

vi.mock('../src/features/packets/usePackets', () => ({
  usePackets: () => ({
    allPackets: [packet],
    observerOptions: [],
    newPacketCount: 0,
    acknowledgeNewPackets: () => {},
    fetchNextPage: () => {},
    hasNextPage: false,
    isFetchingNextPage: false,
    isLoading: false,
    isError: false,
    observersByHash: new Map(),
    handlePacketObservation: () => {},
    handleLagged: () => {},
    laggedCount: 0,
    dismissLagged: () => {},
  }),
}));

vi.mock('../src/features/packets/usePacketDetail', () => ({
  usePacketDetail: (hash: string | null) => ({
    data: hash === 'AA11' ? currentDetail : undefined,
    isLoading: false,
    isError: false,
    refetch: () => {},
  }),
}));

interface MockVirtualListProps {
  packets: PacketSummary[];
  expandedHash: string | null;
  onToggleExpand: (hash: string) => void;
  onOpenAnalyzer: () => void;
  onViewPath: () => void;
  selectedObservationId: number | null;
  onSelectObservation: (id: number) => void;
}

// Stands in for the virtualizer while keeping the real PacketExpansion mounted, so what ?hash
// expands is the genuine component and not a test stub.
vi.mock('../src/features/packets/PacketVirtualList', async () => {
  const { PacketExpansion } = await import('../src/features/packets/PacketExpansion');
  return {
    PacketVirtualList: ({
      packets,
      expandedHash,
      onToggleExpand,
      onOpenAnalyzer,
      onViewPath,
      selectedObservationId,
      onSelectObservation,
    }: MockVirtualListProps) => (
      <div>
        {packets.map((p) => (
          <div key={p.packetHash}>
            <button type="button" onClick={() => onToggleExpand(p.packetHash)}>
              {p.packetHash}
            </button>
            {expandedHash === p.packetHash && (
              <PacketExpansion
                packet={p}
                onOpenAnalyzer={onOpenAnalyzer}
                onViewPath={onViewPath}
                selectedObservationId={selectedObservationId}
                onSelectObservation={onSelectObservation}
              />
            )}
          </div>
        ))}
      </div>
    ),
  };
});

function setMobile(matches: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: /max-width/.test(query) ? matches : /hover/.test(query),
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
  currentDetail = detail;
  queryClient.clear();
  vi.mocked(getChannelMessagesPage)
    .mockReset()
    .mockResolvedValue({ items: [], nextCursor: null, hasMore: false });
  vi.stubGlobal('localStorage', {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
    clear: () => {},
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function renderApp(url: string) {
  const appRouter = createAppRouter(createMemoryHistory({ initialEntries: [url] }));
  render(<App appRouter={appRouter} />);
  return appRouter;
}

describe('Packets deep links', () => {
  it('restores the expanded row and the drawer from ?hash&analyze=1', async () => {
    renderApp('/?tab=Packets&hash=AA11&analyze=1');

    expect(await screen.findByTestId('packet-expansion')).toBeInTheDocument();
    expect(screen.getByTestId('packet-analyzer-drawer')).toBeInTheDocument();
  });

  it('expands the row without the drawer from ?hash alone', async () => {
    renderApp('/?tab=Packets&hash=AA11');

    expect(await screen.findByTestId('packet-expansion')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByTestId('packet-analyzer-drawer')).not.toBeInTheDocument(),
    );
  });

  it('opens nothing when ?analyze=1 arrives without a hash', async () => {
    renderApp('/?tab=Packets&analyze=1');

    expect(await screen.findByRole('button', { name: 'AA11' })).toBeInTheDocument();
    expect(screen.queryByTestId('packet-expansion')).not.toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByTestId('packet-analyzer-drawer')).not.toBeInTheDocument(),
    );
  });
});

describe('leaving the Packets tab', () => {
  // The drawer is full-screen below lg, and it renders on Channels too — so a mobile tab change has
  // to drop ?analyze or the analyzer covers the tab the user just asked for.
  it('closes the analyzer on mobile', async () => {
    setMobile(true);
    renderApp('/?tab=Packets&hash=AA11&analyze=1');
    expect(await screen.findByTestId('packet-analyzer-drawer')).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('tab', { name: 'Channels' })[0]!);

    await waitFor(() =>
      expect(screen.queryByTestId('packet-analyzer-drawer')).not.toBeInTheDocument(),
    );
  });

  it('keeps the analyzer open on desktop', async () => {
    setMobile(false);
    renderApp('/?tab=Packets&hash=AA11&analyze=1');
    expect(await screen.findByTestId('packet-analyzer-drawer')).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('tab', { name: 'Channels' })[0]!);

    await waitFor(() => expect(screen.getByTestId('packet-analyzer-drawer')).toBeInTheDocument());
  });
});

it.each([false, true])(
  'opens the exact channel and scrolls to an older packet message (mobile=%s)',
  async (mobile) => {
    setMobile(mobile);
    const scroll = vi.fn();
    window.HTMLElement.prototype.scrollIntoView = scroll;
    currentDetail = {
      ...detail,
      header: { ...detail.header, payloadType: 5 },
      parsedPayload: {
        decrypted: { sender: 'Alice', content: 'Linked message', sentAt: 1000, channelId: 42 },
      },
    };
    const getPage = vi.mocked(getChannelMessagesPage);
    getPage
      .mockResolvedValueOnce({
        items: [
          {
            id: 2,
            packetHash: 'bb22',
            channelHash: '11',
            senderName: 'Bob',
            content: 'Newer message',
            sentAt: 2000,
          },
        ],
        nextCursor: 2,
        hasMore: true,
      })
      .mockResolvedValueOnce({
        items: [
          {
            id: 1,
            packetHash: 'aa11',
            channelHash: '11',
            senderName: 'Alice',
            content: 'Linked message',
            sentAt: 1000,
          },
        ],
        nextCursor: null,
        hasMore: false,
      });
    const router = renderApp('/packets?hash=AA11');
    expect(await screen.findByText('Linked message')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('link', { name: 'Open in Channels' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/channels'));
    expect(router.state.location.search).toMatchObject({ channel: '42', message: 'aa11' });
    expect(router.state.location.search.analyze).toBeUndefined();
    expect(await screen.findByText('Newer message')).toBeInTheDocument();
    const message = await screen.findByText('Linked message');
    expect(message.closest('[data-highlighted]')).toHaveAttribute('data-highlighted', 'true');
    expect(scroll).toHaveBeenCalledWith({ block: 'center' });
    expect(getPage).toHaveBeenLastCalledWith(42, { iatas: undefined, cursor: 2 });
  },
);

it('restores a channel message directly from its URL', async () => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.mocked(getChannelMessagesPage).mockResolvedValueOnce({
    items: [
      {
        id: 1,
        packetHash: 'cc33',
        channelHash: '11',
        senderName: 'Alice',
        content: 'Restored message',
        sentAt: 1000,
      },
    ],
    nextCursor: null,
    hasMore: false,
  });
  renderApp('/channels?channel=43&message=CC33');
  const message = await screen.findByText('Restored message');
  expect(message.closest('[data-highlighted]')).toHaveAttribute('data-highlighted', 'true');
  expect(window.HTMLElement.prototype.scrollIntoView).toHaveBeenCalledWith({ block: 'center' });
});
