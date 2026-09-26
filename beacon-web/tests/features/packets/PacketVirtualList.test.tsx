import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { PacketVirtualList } from '../../../src/features/packets/PacketVirtualList';
import { GRID_MIN_WIDTH, PACKET_TABLE_X_PADDING } from '../../../src/features/packets/packet-grid';
import type { PacketSummary } from '../../../src/types/api';

// PacketExpansion fetches through usePacketDetail; stub it so the list renders without a query client.
const usePacketDetail = vi.fn(() => ({
  data: { packetHash: 'AA11', header: { payloadType: 1 }, observations: [] },
}));
vi.mock('../../../src/features/packets/usePacketDetail', () => ({
  usePacketDetail: (h: string | null) => usePacketDetail(h),
}));

// Rows resolve region names through the shared iatas query; provide one client for every render.
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
function renderWithClient(ui: React.ReactElement) {
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const VIEWPORT_H = 1300;
const ROW_H = 60;
const EXPANDED_H = 400;

// jsdom has no layout and no ResizeObserver, so feed the virtualizer both: offsetHeight answers for
// the viewport and for each measured item (taller once it holds an expansion), and flushResize()
// stands in for the browser noticing a row changed height.
type Observed = { cb: ResizeObserverCallback; targets: Set<Element> };
const observers: Observed[] = [];

class StubResizeObserver {
  private entry: Observed;
  constructor(cb: ResizeObserverCallback) {
    this.entry = { cb, targets: new Set() };
    observers.push(this.entry);
  }
  observe(target: Element) {
    this.entry.targets.add(target);
  }
  unobserve(target: Element) {
    this.entry.targets.delete(target);
  }
  disconnect() {
    this.entry.targets.clear();
  }
}
vi.stubGlobal('ResizeObserver', StubResizeObserver);

function flushResize() {
  act(() => {
    for (const o of observers) {
      const entries = [...o.targets].map((target) => ({
        target,
      })) as unknown as ResizeObserverEntry[];
      if (entries.length > 0) o.cb(entries, {} as ResizeObserver);
    }
  });
}

Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
  configurable: true,
  get(this: HTMLElement) {
    if (!this.hasAttribute('data-index')) return VIEWPORT_H;
    return this.querySelector("[data-testid='packet-expansion']") ? EXPANDED_H : ROW_H;
  },
});

const pkt = (hash: string): PacketSummary => ({
  packetHash: hash,
  payloadType: 1,
  payloadTypeName: 'ADVERT',
  routeType: 1,
  routeTypeName: 'FLOOD',
  firstHeardAt: 1700000000,
  lastHeardAt: 1700000000,
  observationCount: 1,
});

const many = (n: number) => Array.from({ length: n }, (_, i) => pkt(`AA${i}`));

function makeHandlers() {
  return {
    hasNextPage: false,
    isFetching: false,
    fetchNextPage: vi.fn(),
    onScrollAwayFromTop: vi.fn(),
    onAtTopChange: vi.fn(),
    onToggleExpand: vi.fn(),
    onOpenAnalyzer: vi.fn(),
    onViewPath: vi.fn(),
    selectedObservationId: null,
    onSelectObservation: vi.fn(),
  };
}

// the scroll container is the component's root; on desktop a min-width wrapper inside it keeps
// the header and the virtualized rows on one shared horizontal overflow region
const scroller = (container: HTMLElement) => container.firstElementChild as HTMLElement;
const gridWrapper = (container: HTMLElement) => scroller(container).lastElementChild as HTMLElement;
function totalSize(container: HTMLElement) {
  const spacer = gridWrapper(container).lastElementChild as HTMLElement;
  const height = parseFloat(spacer.style.height);
  expect(Number.isFinite(height)).toBe(true);
  return height;
}

function setScrollMetrics(
  el: HTMLElement,
  {
    scrollHeight,
    clientHeight,
    scrollTop,
  }: {
    scrollHeight: number;
    clientHeight: number;
    scrollTop: number;
  },
) {
  Object.defineProperty(el, 'scrollHeight', { configurable: true, value: scrollHeight });
  Object.defineProperty(el, 'clientHeight', { configurable: true, value: clientHeight });
  el.scrollTop = scrollTop;
}

beforeEach(() => {
  observers.length = 0;
  usePacketDetail.mockReturnValue({
    data: { packetHash: 'AA11', header: { payloadType: 1 }, observations: [] },
  });
});

describe('PacketVirtualList expansion', () => {
  it('mounts the expansion inside the measured wrapper', () => {
    renderWithClient(
      <PacketVirtualList packets={[pkt('AA11')]} expandedHash="AA11" {...makeHandlers()} />,
    );

    const wrapper = screen.getByTestId('packet-item-AA11');
    expect(wrapper).toHaveAttribute('data-index', '0');
    expect(wrapper.querySelector("[data-testid='packet-expansion']")).not.toBeNull();
  });

  it('expands only the row named by expandedHash', () => {
    renderWithClient(
      <PacketVirtualList packets={many(30)} expandedHash="AA3" {...makeHandlers()} />,
    );

    expect(screen.getAllByTestId('packet-expansion')).toHaveLength(1);
    expect(
      screen.getByTestId('packet-item-AA3').querySelector("[data-testid='packet-expansion']"),
    ).not.toBeNull();
  });

  it('renders no expansion when nothing is expanded', () => {
    renderWithClient(
      <PacketVirtualList packets={many(30)} expandedHash={null} {...makeHandlers()} />,
    );

    expect(screen.queryByTestId('packet-expansion')).toBeNull();
  });

  it("counts the expanded height in the virtualizer's total size", () => {
    const packets = many(30);
    const handlers = makeHandlers();
    const { container, rerender } = renderWithClient(
      <PacketVirtualList packets={packets} expandedHash={null} {...handlers} />,
    );
    const collapsed = totalSize(container);

    rerender(
      <QueryClientProvider client={client}>
        <PacketVirtualList packets={packets} expandedHash="AA3" {...handlers} />
      </QueryClientProvider>,
    );
    flushResize();

    expect(totalSize(container)).toBe(collapsed + (EXPANDED_H - ROW_H));
  });

  it("forwards the expansion's actions", () => {
    const hop = (id: string, lng: number, lat: number) => ({
      confidence: 'high' as const,
      nodes: [{ id, publicKey: 'pk', longitude: lng, latitude: lat }],
    });
    usePacketDetail.mockReturnValue({
      data: {
        packetHash: 'AA11',
        header: { payloadType: 1 },
        observations: [
          {
            id: 1,
            observerId: 'o1',
            iata: 'YOW',
            heardAt: 0,
            sourceBroker: 'b',
            pathLength: { raw: '02', hashSize: 1, hopCount: 2 },
            resolvedPath: [hop('a', -79, 43), hop('b', -75, 45)],
          },
        ],
      },
    });
    const handlers = makeHandlers();
    renderWithClient(
      <PacketVirtualList packets={[pkt('AA11')]} expandedHash="AA11" {...handlers} />,
    );

    // clicking an observation is what opens the analyzer now — there is no button for it
    fireEvent.click(screen.getByText('o1'));
    fireEvent.click(screen.getByRole('button', { name: 'View path on map' }));

    expect(handlers.onSelectObservation).toHaveBeenCalledWith(1);
    expect(handlers.onOpenAnalyzer).toHaveBeenCalledTimes(1);
    expect(handlers.onViewPath).toHaveBeenCalledTimes(1);
  });
});

describe('PacketVirtualList header', () => {
  it('renders the sticky header once, outside measured item space', () => {
    const { container } = renderWithClient(
      <PacketVirtualList packets={many(30)} expandedHash={null} {...makeHandlers()} />,
    );

    const headings = screen.getAllByText('Hash');
    expect(headings).toHaveLength(1);
    const header = headings[0]!.parentElement as HTMLElement;
    expect(header.closest('[data-index]')).toBeNull();
    // the header and the virtualized rows share one wrapper so they cannot scroll apart
    expect(header.parentElement).toBe(gridWrapper(container));
    expect(header.previousElementSibling).toBeNull();
  });
});

// The desktop grid has a real minimum width (fixed tracks + gaps + padding). These tests pin the
// containment contract from issue #82: overflow belongs to the list's own scroll region, the
// header and rows stay on one shared wrapper, and mobile cards keep the page-level layout.
describe('PacketVirtualList horizontal containment', () => {
  it('lets the scroll region own horizontal overflow at desktop width', () => {
    const { container } = renderWithClient(
      <PacketVirtualList packets={many(30)} expandedHash={null} {...makeHandlers()} />,
    );

    const root = scroller(container);
    expect(root).toHaveClass('overflow-x-auto');
    expect(root).toHaveClass('overflow-y-auto');
  });

  it('gives the header and rows a wrapper matching the grid minimum width', () => {
    const { container } = renderWithClient(
      <PacketVirtualList packets={many(30)} expandedHash={null} {...makeHandlers()} />,
    );

    const wrapper = gridWrapper(container);
    expect(wrapper.style.minWidth).toBe(GRID_MIN_WIDTH);
    // both the sticky header and the virtualized spacer live inside the wrapper
    const header = screen.getAllByText('Hash')[0]!.parentElement as HTMLElement;
    const spacer = wrapper.lastElementChild as HTMLElement;
    expect(header.parentElement).toBe(wrapper);
    expect(spacer.parentElement).toBe(wrapper);
    // every rendered row is positioned within the same spacer the header scrolls with
    const row = screen.getByTestId('packet-item-AA0');
    expect(row.parentElement).toBe(spacer);
  });

  it('keeps mobile cards free of the desktop grid wrapper', () => {
    setMobile(true);
    try {
      const { container } = renderWithClient(
        <PacketVirtualList packets={[pkt('AA11')]} expandedHash={null} {...makeHandlers()} />,
      );

      const root = scroller(container);
      expect(root).toHaveClass('px-4');
      expect(root).not.toHaveClass('overflow-x-auto');
      const wrapper = gridWrapper(container);
      expect(wrapper.style.minWidth).toBe('');
    } finally {
      setMobile(false);
    }
  });
});

// The table surface contract from issue #84: the desktop scroll region runs full-bleed (no dead
// gutter — see #76) while header and row CONTENT share the toolbar's px-4 gutter via one token.
// Backgrounds and separators stay on the outer elements so they reach the true surface edge, and
// the grid minimum width accounts for the wider gutter.
describe('PacketVirtualList desktop surface', () => {
  it('keeps the desktop scroll region edge-to-edge with no container padding', () => {
    const { container } = renderWithClient(
      <PacketVirtualList packets={many(30)} expandedHash={null} {...makeHandlers()} />,
    );

    const root = scroller(container);
    expect(root).not.toHaveClass('px-4');
    expect(root).not.toHaveClass('px-2');
  });

  it('applies the shared content gutter to header and rows, not the scroll container', () => {
    const { container } = renderWithClient(
      <PacketVirtualList packets={[pkt('AA11')]} expandedHash={null} {...makeHandlers()} />,
    );

    const header = screen.getAllByText('Hash')[0]!.parentElement as HTMLElement;
    const row = screen.getByRole('button');
    expect(header).toHaveClass(PACKET_TABLE_X_PADDING);
    expect(row).toHaveClass(PACKET_TABLE_X_PADDING);
    // the gutter belongs inside the surface: the scroll region itself must stay clean
    const root = scroller(container);
    for (const cls of root.className.split(/\s+/)) {
      if (cls.startsWith('px-')) throw new Error(`scroll container must not carry ${cls}`);
    }
  });

  it('applies the shared content gutter to the expansion surface', () => {
    renderWithClient(
      <PacketVirtualList packets={[pkt('AA11')]} expandedHash="AA11" {...makeHandlers()} />,
    );

    expect(screen.getByTestId('packet-expansion')).toHaveClass(PACKET_TABLE_X_PADDING);
  });

  it('sizes GRID_MIN_WIDTH for the shared gutter', () => {
    // 41.5rem of fixed/minmax tracks + 8 × 0.5rem gaps + the 2rem gutter
    expect(GRID_MIN_WIDTH).toBe('47.5rem');
  });
});

describe('PacketVirtualList scrolling', () => {
  it.each([0, 1])('can manually page with %i visible rows and no scrollbar', (count) => {
    const handlers = makeHandlers();
    const { rerender } = render(
      <PacketVirtualList packets={many(count)} expandedHash={null} {...handlers} hasNextPage />,
    );

    expect(handlers.fetchNextPage).not.toHaveBeenCalled();
    if (count === 0) expect(screen.getByText('No matching packets loaded.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Load older packets' }));
    expect(handlers.fetchNextPage).toHaveBeenCalledTimes(1);

    // A still-empty result after the page arrives must not start scanning further pages.
    rerender(<PacketVirtualList packets={[]} expandedHash={null} {...handlers} hasNextPage />);
    flushResize();
    expect(handlers.fetchNextPage).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Load older packets' }));
    expect(handlers.fetchNextPage).toHaveBeenCalledTimes(2);
  });

  it('disables manual paging during a request and allows retry afterward', () => {
    const handlers = makeHandlers();
    const { rerender } = render(
      <PacketVirtualList packets={[]} expandedHash={null} {...handlers} hasNextPage isFetching />,
    );
    const pending = screen.getByRole('button', { name: 'Loading packets...' });
    expect(pending).toBeDisabled();
    fireEvent.click(pending);
    expect(handlers.fetchNextPage).not.toHaveBeenCalled();

    rerender(<PacketVirtualList packets={[]} expandedHash={null} {...handlers} hasNextPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Load older packets' }));
    expect(handlers.fetchNextPage).toHaveBeenCalledTimes(1);
  });

  it('removes manual paging when the history cursor is exhausted', () => {
    const handlers = makeHandlers();
    const { rerender } = render(
      <PacketVirtualList packets={[]} expandedHash={null} {...handlers} hasNextPage />,
    );
    expect(screen.getByRole('button', { name: 'Load older packets' })).toBeEnabled();
    rerender(<PacketVirtualList packets={[]} expandedHash={null} {...handlers} />);
    expect(screen.queryByRole('button', { name: 'Load older packets' })).not.toBeInTheDocument();
    expect(handlers.fetchNextPage).not.toHaveBeenCalled();
  });

  it('pages when scrolled near the bottom', () => {
    const handlers = makeHandlers();
    const { container } = renderWithClient(
      <PacketVirtualList packets={many(30)} expandedHash={null} {...handlers} hasNextPage />,
    );

    const el = scroller(container);
    setScrollMetrics(el, { scrollHeight: 5000, clientHeight: 1000, scrollTop: 3800 });
    fireEvent.scroll(el);

    expect(handlers.fetchNextPage).toHaveBeenCalled();
  });

  it('does not page while a page is already in flight', () => {
    const handlers = makeHandlers();
    const { container } = renderWithClient(
      <PacketVirtualList
        packets={many(30)}
        expandedHash={null}
        {...handlers}
        hasNextPage
        isFetching
      />,
    );

    const el = scroller(container);
    setScrollMetrics(el, { scrollHeight: 5000, clientHeight: 1000, scrollTop: 3800 });
    fireEvent.scroll(el);

    expect(handlers.fetchNextPage).not.toHaveBeenCalled();
  });

  it('reports at-top and scrolled-away as the scroll position moves', () => {
    const handlers = makeHandlers();
    const { container } = renderWithClient(
      <PacketVirtualList packets={many(30)} expandedHash={null} {...handlers} />,
    );

    const el = scroller(container);
    setScrollMetrics(el, { scrollHeight: 5000, clientHeight: 1000, scrollTop: 150 });
    fireEvent.scroll(el);
    expect(handlers.onAtTopChange).toHaveBeenLastCalledWith(false);
    expect(handlers.onScrollAwayFromTop).toHaveBeenLastCalledWith(true);

    setScrollMetrics(el, { scrollHeight: 5000, clientHeight: 1000, scrollTop: 0 });
    fireEvent.scroll(el);
    expect(handlers.onAtTopChange).toHaveBeenLastCalledWith(true);
    expect(handlers.onScrollAwayFromTop).toHaveBeenLastCalledWith(false);
  });

  it('does not page when a row collapses near the bottom', () => {
    const packets = many(30);
    const handlers = makeHandlers();
    const { rerender } = renderWithClient(
      <PacketVirtualList packets={packets} expandedHash="AA29" {...handlers} hasNextPage />,
    );
    handlers.fetchNextPage.mockClear();

    rerender(
      <QueryClientProvider client={client}>
        <PacketVirtualList packets={packets} expandedHash={null} {...handlers} hasNextPage />
      </QueryClientProvider>,
    );
    flushResize();

    expect(handlers.fetchNextPage).not.toHaveBeenCalled();
  });
});

// mirrors DataTable.test.tsx's mobile stub, keeping the max-width query the only configurable one
// so hover-driven components (e.g. Tooltip, used by PacketRow) keep their default hover behaviour
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

describe('PacketVirtualList responsive row', () => {
  afterEach(() => {
    setMobile(false); // back to the desktop default so later tests in this file aren't affected
  });

  it('renders the card row below lg', () => {
    setMobile(true);
    const handlers = makeHandlers();
    const { container } = renderWithClient(
      <PacketVirtualList packets={[pkt('AA11')]} expandedHash={null} {...handlers} />,
    );

    expect(container.firstElementChild).toHaveClass('px-4');
    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'false');
    const card = container.querySelector('button.w-full');
    expect(card).not.toBeNull();

    fireEvent.click(card!);
    expect(handlers.onToggleExpand).toHaveBeenCalledWith('AA11');
  });

  it('renders the grid row at lg and up', () => {
    const { container } = renderWithClient(
      <PacketVirtualList packets={[pkt('AA11')]} expandedHash={null} {...makeHandlers()} />,
    );

    expect(container.firstElementChild).not.toHaveClass('px-4');
    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'false');
    expect(container.querySelector('[aria-pressed]')).toBeNull();
  });

  it('expands the card row below lg', () => {
    setMobile(true);
    renderWithClient(
      <PacketVirtualList packets={[pkt('AA11')]} expandedHash="AA11" {...makeHandlers()} />,
    );

    expect(screen.getByTestId('packet-expansion')).toBeInTheDocument();
  });
});
