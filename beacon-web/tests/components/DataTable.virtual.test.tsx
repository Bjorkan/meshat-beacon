import { act, fireEvent, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DataTable, type Column } from "../../src/components/DataTable";

interface Row {
  id: string;
  name: string;
}

const rows = Array.from({ length: 2_000 }, (_, index) => ({
  id: `row-${index}`,
  name: `Row ${index}`,
}));
const columns: Column<Row>[] = [{ header: "Name", cell: (row) => row.name }];

type Observed = { callback: ResizeObserverCallback; targets: Set<Element> };
const observed: Observed[] = [];

class StubResizeObserver {
  private entry: Observed;

  constructor(callback: ResizeObserverCallback) {
    this.entry = { callback, targets: new Set() };
    observed.push(this.entry);
  }

  observe(target: Element) { this.entry.targets.add(target); }
  unobserve(target: Element) { this.entry.targets.delete(target); }
  disconnect() { this.entry.targets.clear(); }
}

vi.stubGlobal("ResizeObserver", StubResizeObserver);

Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
  configurable: true,
  get(this: HTMLElement) {
    return this.hasAttribute("data-index") ? 40 : 400;
  },
});

function flushResize() {
  act(() => {
    for (const entry of observed) {
      const entries = [...entry.targets].map((target) => ({ target })) as unknown as ResizeObserverEntry[];
      if (entries.length > 0) entry.callback(entries, {} as ResizeObserver);
    }
  });
}

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
  observed.length = 0;
  setMobile(false);
});

describe("DataTable virtualization", () => {
  it("keeps a large desktop table to a bounded number of DOM rows", () => {
    const { container } = render(
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        selectedKey={null}
        onSelect={() => {}}
        emptyLabel="none"
        virtualize
      />,
    );
    flushResize();

    const rendered = container.querySelectorAll("tbody tr[data-index]");
    expect(rendered.length).toBeGreaterThan(0);
    expect(rendered.length).toBeLessThan(50);
    expect(container.querySelector("[data-virtualized='true']")).not.toBeNull();
  });

  it("virtualizes mobile cards and preserves row selection", () => {
    setMobile(true);
    const onSelect = vi.fn();
    const { container } = render(
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        selectedKey={null}
        onSelect={onSelect}
        emptyLabel="none"
        virtualize
        renderCard={(row) => row.name}
      />,
    );
    flushResize();

    const rendered = container.querySelectorAll("button[data-index]");
    expect(rendered.length).toBeGreaterThan(0);
    expect(rendered.length).toBeLessThan(50);
    fireEvent.click(rendered[0]!);
    expect(onSelect).toHaveBeenCalledWith("row-0");
  });

  it("does not preload rendered virtual rows, but forwards hover, focus, and touch intent", () => {
    const onRowIntent = vi.fn();
    const { container } = render(
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        selectedKey={null}
        onSelect={() => {}}
        onRowIntent={onRowIntent}
        emptyLabel="none"
        virtualize
      />,
    );
    flushResize();

    const row = container.querySelector("tbody tr[data-index]")!;
    expect(row).not.toBeNull();
    expect(onRowIntent).not.toHaveBeenCalled();

    fireEvent.mouseEnter(row);
    fireEvent.focus(row);
    fireEvent.touchStart(row);
    expect(onRowIntent).toHaveBeenNthCalledWith(1, "row-0");
    expect(onRowIntent).toHaveBeenNthCalledWith(2, "row-0");
    expect(onRowIntent).toHaveBeenNthCalledWith(3, "row-0");
  });
});
