import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { PacketVirtualList } from "../../../src/features/packets/PacketVirtualList";
import type { PacketSummary } from "../../../src/types/api";

// PacketExpansion fetches through usePacketDetail; stub it so the list renders without a query client.
const usePacketDetail = vi.fn(() => ({ data: { packetHash: "AA11", header: { payloadType: 1 }, observations: [] } }));
vi.mock("../../../src/features/packets/usePacketDetail", () => ({
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
  observe(target: Element) { this.entry.targets.add(target); }
  unobserve(target: Element) { this.entry.targets.delete(target); }
  disconnect() { this.entry.targets.clear(); }
}
vi.stubGlobal("ResizeObserver", StubResizeObserver);

function flushResize() {
  act(() => {
    for (const o of observers) {
      const entries = [...o.targets].map((target) => ({ target })) as unknown as ResizeObserverEntry[];
      if (entries.length > 0) o.cb(entries, {} as ResizeObserver);
    }
  });
}

Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
  configurable: true,
  get(this: HTMLElement) {
    if (!this.hasAttribute("data-index")) return VIEWPORT_H;
    return this.querySelector("[data-testid='packet-expansion']") ? EXPANDED_H : ROW_H;
  },
});

const pkt = (hash: string): PacketSummary => ({
  packetHash: hash, payloadType: 1, payloadTypeName: "ADVERT",
  routeType: 1, routeTypeName: "FLOOD",
  firstHeardAt: 1700000000, lastHeardAt: 1700000000, observationCount: 1,
});

const many = (n: number) => Array.from({ length: n }, (_, i) => pkt(`AA${i}`));

function makeHandlers() {
  return {
    hasNextPage: false,
    isFetchingNextPage: false,
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

// the scroll container is the component's root; the spacer under it carries the virtualizer's total size
const scroller = (container: HTMLElement) => container.firstElementChild as HTMLElement;
function totalSize(container: HTMLElement) {
  const spacer = scroller(container).lastElementChild as HTMLElement;
  const height = parseFloat(spacer.style.height);
  expect(Number.isFinite(height)).toBe(true);
  return height;
}

function setScrollMetrics(el: HTMLElement, { scrollHeight, clientHeight, scrollTop }: {
  scrollHeight: number; clientHeight: number; scrollTop: number;
}) {
  Object.defineProperty(el, "scrollHeight", { configurable: true, value: scrollHeight });
  Object.defineProperty(el, "clientHeight", { configurable: true, value: clientHeight });
  el.scrollTop = scrollTop;
}

beforeEach(() => {
  observers.length = 0;
  usePacketDetail.mockReturnValue({ data: { packetHash: "AA11", header: { payloadType: 1 }, observations: [] } });
});

describe("PacketVirtualList expansion", () => {
  it("mounts the expansion inside the measured wrapper", () => {
    renderWithClient(<PacketVirtualList packets={[pkt("AA11")]} expandedHash="AA11" {...makeHandlers()} />);

    const wrapper = screen.getByTestId("packet-item-AA11");
    expect(wrapper).toHaveAttribute("data-index", "0");
    expect(wrapper.querySelector("[data-testid='packet-expansion']")).not.toBeNull();
  });

  it("expands only the row named by expandedHash", () => {
    renderWithClient(<PacketVirtualList packets={many(30)} expandedHash="AA3" {...makeHandlers()} />);

    expect(screen.getAllByTestId("packet-expansion")).toHaveLength(1);
    expect(screen.getByTestId("packet-item-AA3").querySelector("[data-testid='packet-expansion']")).not.toBeNull();
  });

  it("renders no expansion when nothing is expanded", () => {
    renderWithClient(<PacketVirtualList packets={many(30)} expandedHash={null} {...makeHandlers()} />);

    expect(screen.queryByTestId("packet-expansion")).toBeNull();
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
    const hop = (id: string, lng: number, lat: number) => ({ confidence: "high" as const, nodes: [{ id, publicKey: "pk", longitude: lng, latitude: lat }] });
    usePacketDetail.mockReturnValue({
      data: {
        packetHash: "AA11",
        header: { payloadType: 1 },
        observations: [{ id: 1, observerId: "o1", iata: "YOW", heardAt: 0, sourceBroker: "b", pathLength: { raw: "02", hashSize: 1, hopCount: 2 }, resolvedPath: [hop("a", -79, 43), hop("b", -75, 45)] }],
      },
    });
    const handlers = makeHandlers();
    renderWithClient(<PacketVirtualList packets={[pkt("AA11")]} expandedHash="AA11" {...handlers} />);

    // clicking an observation is what opens the analyzer now — there is no button for it
    fireEvent.click(screen.getByText("o1"));
    fireEvent.click(screen.getByRole("button", { name: "View path on map" }));

    expect(handlers.onSelectObservation).toHaveBeenCalledWith(1);
    expect(handlers.onOpenAnalyzer).toHaveBeenCalledTimes(1);
    expect(handlers.onViewPath).toHaveBeenCalledTimes(1);
  });
});

describe("PacketVirtualList header", () => {
  it("renders the sticky header once, outside measured item space", () => {
    const { container } = renderWithClient(
      <PacketVirtualList packets={many(30)} expandedHash={null} {...makeHandlers()} />,
    );

    const headings = screen.getAllByText("Hash");
    expect(headings).toHaveLength(1);
    const header = headings[0]!.parentElement as HTMLElement;
    expect(header.closest("[data-index]")).toBeNull();
    expect(header.parentElement).toBe(scroller(container));
    expect(header.previousElementSibling).toBeNull();
  });
});

describe("PacketVirtualList scrolling", () => {
  it("pages when scrolled near the bottom", () => {
    const handlers = makeHandlers();
    const { container } = renderWithClient(
      <PacketVirtualList packets={many(30)} expandedHash={null} {...handlers} hasNextPage />,
    );

    const el = scroller(container);
    setScrollMetrics(el, { scrollHeight: 5000, clientHeight: 1000, scrollTop: 3800 });
    fireEvent.scroll(el);

    expect(handlers.fetchNextPage).toHaveBeenCalled();
  });

  it("does not page while a page is already in flight", () => {
    const handlers = makeHandlers();
    const { container } = renderWithClient(
      <PacketVirtualList packets={many(30)} expandedHash={null} {...handlers} hasNextPage isFetchingNextPage />,
    );

    const el = scroller(container);
    setScrollMetrics(el, { scrollHeight: 5000, clientHeight: 1000, scrollTop: 3800 });
    fireEvent.scroll(el);

    expect(handlers.fetchNextPage).not.toHaveBeenCalled();
  });

  it("reports at-top and scrolled-away as the scroll position moves", () => {
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

  it("does not page when a row collapses near the bottom", () => {
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

describe("PacketVirtualList responsive row", () => {
  afterEach(() => {
    setMobile(false); // back to the desktop default so later tests in this file aren't affected
  });

  it("renders the card row below lg", () => {
    setMobile(true);
    const handlers = makeHandlers();
    const { container } = renderWithClient(
      <PacketVirtualList packets={[pkt("AA11")]} expandedHash={null} {...handlers} />,
    );

    // PacketRow has no button role; PacketTableRow's toggle is a real <button>
    expect(screen.queryByRole("button")).toBeNull();
    const card = container.querySelector("[aria-pressed]");
    expect(card).not.toBeNull();

    fireEvent.click(card!);
    expect(handlers.onToggleExpand).toHaveBeenCalledWith("AA11");
  });

  it("renders the grid row at lg and up", () => {
    const { container } = renderWithClient(
      <PacketVirtualList packets={[pkt("AA11")]} expandedHash={null} {...makeHandlers()} />,
    );

    expect(screen.getByRole("button")).toHaveAttribute("aria-expanded", "false");
    expect(container.querySelector("[aria-pressed]")).toBeNull();
  });

  it("expands the card row below lg", () => {
    setMobile(true);
    renderWithClient(<PacketVirtualList packets={[pkt("AA11")]} expandedHash="AA11" {...makeHandlers()} />);

    expect(screen.getByTestId("packet-expansion")).toBeInTheDocument();
  });
});
