import { describe, expect, it, vi, afterEach } from "vitest";
import { render, fireEvent, screen, within } from "@testing-library/react";
import { DataTable, type Column } from "../../src/components/DataTable";

interface Row {
  id: string;
}
const rows: Row[] = [{ id: "a" }, { id: "b" }];
const columns: Column<Row>[] = [{ header: "ID", cell: (r) => r.id }];

// Force the mobile media query to match so DataTable enters card mode.
function setMobile(matches: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

afterEach(() => {
  vi.restoreAllMocks();
});

// jsdom does no layout, so the scroll metrics are stubbed onto the scroll container directly.
function setScroll(el: HTMLElement, { scrollTop, clientHeight, scrollHeight }: { scrollTop: number; clientHeight: number; scrollHeight: number }) {
  Object.defineProperty(el, "scrollTop", { value: scrollTop, configurable: true });
  Object.defineProperty(el, "clientHeight", { value: clientHeight, configurable: true });
  Object.defineProperty(el, "scrollHeight", { value: scrollHeight, configurable: true });
}

function renderTable(onEndReached?: () => void) {
  const { container } = render(
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(r) => r.id}
      selectedKey={null}
      onSelect={() => {}}
      emptyLabel="none"
      onEndReached={onEndReached}
    />,
  );
  return container.querySelector(".overflow-y-auto") as HTMLElement;
}

describe("DataTable onEndReached", () => {
  it("fires onEndReached when scrolled near the bottom", () => {
    const onEndReached = vi.fn();
    const scroller = renderTable(onEndReached);
    setScroll(scroller, { scrollTop: 400, clientHeight: 500, scrollHeight: 1000 }); // 100px from bottom
    fireEvent.scroll(scroller);
    expect(onEndReached).toHaveBeenCalledTimes(1);
  });

  it("does not fire onEndReached when far from the bottom", () => {
    const onEndReached = vi.fn();
    const scroller = renderTable(onEndReached);
    setScroll(scroller, { scrollTop: 0, clientHeight: 500, scrollHeight: 1000 }); // 500px from bottom
    fireEvent.scroll(scroller);
    expect(onEndReached).not.toHaveBeenCalled();
  });
});

describe("DataTable card mode", () => {
  it("automatically renders labelled cards for a wide table on mobile", () => {
    setMobile(true);
    const { container } = render(
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        selectedKey={null}
        onSelect={() => {}}
        emptyLabel="none"
      />,
    );
    expect(container.querySelector("table")).toBeNull();
    expect(screen.getAllByText("ID")).toHaveLength(2);
    expect(screen.getByText("a")).toBeInTheDocument();
  });

  it("renders cards instead of a table when mobile and renderCard is provided", () => {
    setMobile(true);
    const { container } = render(
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        selectedKey={null}
        onSelect={() => {}}
        emptyLabel="none"
        renderCard={(r) => <span>card-{r.id}</span>}
      />,
    );
    expect(container.querySelector("table")).toBeNull();
    expect(screen.getByText("card-a")).toBeInTheDocument();
    expect(screen.getByText("card-b")).toBeInTheDocument();
  });

  it("still renders a table on desktop even with renderCard provided", () => {
    setMobile(false);
    const { container } = render(
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        selectedKey={null}
        onSelect={() => {}}
        emptyLabel="none"
        renderCard={(r) => <span>card-{r.id}</span>}
      />,
    );
    expect(container.querySelector("table")).not.toBeNull();
    expect(screen.queryByText("card-a")).toBeNull();
  });

  it("selects a card on click in card mode", () => {
    setMobile(true);
    const onSelect = vi.fn();
    render(
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        selectedKey={null}
        onSelect={onSelect}
        emptyLabel="none"
        renderCard={(r) => <span>card-{r.id}</span>}
      />,
    );
    fireEvent.click(screen.getByText("card-a"));
    expect(onSelect).toHaveBeenCalledWith("a");
  });

  it("still fires onEndReached in card mode", () => {
    setMobile(true);
    const onEndReached = vi.fn();
    const { container } = render(
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        selectedKey={null}
        onSelect={() => {}}
        emptyLabel="none"
        onEndReached={onEndReached}
        renderCard={(r) => <span>card-{r.id}</span>}
      />,
    );
    const scroller = container.querySelector(".overflow-y-auto") as HTMLElement;
    setScroll(scroller, { scrollTop: 400, clientHeight: 500, scrollHeight: 1000 });
    fireEvent.scroll(scroller);
    expect(onEndReached).toHaveBeenCalledTimes(1);
  });

  it("keeps TanStack sorting available above the mobile cards", () => {
    setMobile(true);
    const unsorted: Row[] = [{ id: "b" }, { id: "a" }];
    const { container } = render(
      <DataTable
        columns={[{ header: "ID", cell: (r: Row) => r.id, sortValue: (r: Row) => r.id }]}
        rows={unsorted}
        rowKey={(r) => r.id}
        selectedKey={null}
        onSelect={() => {}}
        emptyLabel="none"
      />,
    );

    expect([...container.querySelectorAll("dd")].map((cell) => cell.textContent)).toEqual(["b", "a"]);
    fireEvent.click(within(screen.getByLabelText(/Sort/)).getByRole("button", { name: /ID/ }));
    expect([...container.querySelectorAll("dd")].map((cell) => cell.textContent)).toEqual(["a", "b"]);
  });
});


describe("DataTable controlled sorting", () => {
  const sortableColumns: Column<Row>[] = [
    { header: "ID", cell: (r) => r.id, sortValue: (r) => r.id },
  ];

  it("keeps server page order while a global sort is incomplete, then sorts the complete set", () => {
    setMobile(false);
    const unsorted: Row[] = [{ id: "b" }, { id: "a" }];
    const props = {
      columns: sortableColumns,
      rows: unsorted,
      rowKey: (r: Row) => r.id,
      selectedKey: null,
      onSelect: () => {},
      emptyLabel: "none",
      sort: { header: "ID", direction: "asc" as const },
      onSortChange: () => {},
    };
    const { container, rerender } = render(<DataTable {...props} sortReady={false} />);

    const cellText = () => [...container.querySelectorAll("tbody td")].map((td) => td.textContent);
    expect(cellText()).toEqual(["b", "a"]);
    expect(screen.getByRole("button", { name: /ID/ })).toHaveAttribute("aria-busy", "true");

    rerender(<DataTable {...props} sortReady />);
    expect(cellText()).toEqual(["a", "b"]);
    expect(screen.getByRole("button", { name: /ID/ })).not.toHaveAttribute("aria-busy");
  });

  it("keeps API order in server mode while preserving sortable header controls", () => {
    setMobile(false);
    const onSortChange = vi.fn();
    const unsorted: Row[] = [{ id: "b" }, { id: "a" }];
    const { container } = render(
      <DataTable
        columns={sortableColumns}
        rows={unsorted}
        rowKey={(r) => r.id}
        selectedKey={null}
        onSelect={() => {}}
        emptyLabel="none"
        sort={{ header: "ID", direction: "asc" }}
        onSortChange={onSortChange}
        sortMode="server"
      />,
    );

    expect([...container.querySelectorAll("tbody td")].map((td) => td.textContent)).toEqual(["b", "a"]);
    fireEvent.click(screen.getByRole("button", { name: /ID/ }));
    expect(onSortChange).toHaveBeenCalledWith({ header: "ID", direction: "desc" });
  });

  it("reports sort changes to a controlled caller instead of mutating local state", () => {
    setMobile(false);
    const onSortChange = vi.fn();
    render(
      <DataTable
        columns={sortableColumns}
        rows={rows}
        rowKey={(r) => r.id}
        selectedKey={null}
        onSelect={() => {}}
        emptyLabel="none"
        sort={{ header: "", direction: "asc" }}
        onSortChange={onSortChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /ID/ }));
    expect(onSortChange).toHaveBeenCalledWith({ header: "ID", direction: "asc" });
  });
});
