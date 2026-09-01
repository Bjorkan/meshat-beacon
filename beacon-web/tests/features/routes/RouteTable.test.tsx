import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { RouteTable } from "../../../src/features/routes/RouteTable";
import { RegionProvider } from "../../../src/hooks/useRegion";
import { ALL_REGIONS } from "../../../src/hooks/region-selection";
import {
  getKnownRoutesPage,
  searchKnownRoutes,
  searchCrossIATARoutes,
  getIatas,
  getRegions,
} from "../../../src/api/client";
import type { KnownRoute, CrossIATARoute } from "../../../src/types/api";

vi.mock("../../../src/api/client", () => ({
  getKnownRoutesPage: vi.fn(),
  searchKnownRoutes: vi.fn(),
  searchCrossIATARoutes: vi.fn(),
  getIatas: vi.fn(),
  getRegions: vi.fn(),
}));

const mockGetKnownRoutesPage = vi.mocked(getKnownRoutesPage);
const mockSearchKnownRoutes = vi.mocked(searchKnownRoutes);
const mockSearchCrossIATARoutes = vi.mocked(searchCrossIATARoutes);
const mockGetIatas = vi.mocked(getIatas);
const mockGetRegions = vi.mocked(getRegions);

const node = (id: string, name: string) => ({ id, name, publicKey: "deadbeef" });

function renderTable(selection = ALL_REGIONS) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <RegionProvider defaultSelection={selection}>{children}</RegionProvider>
    </QueryClientProvider>
  );
  render(<RouteTable />, { wrapper });
}

const openIataPicker = () => fireEvent.click(screen.getByText("IATA"));
const checkIata = (code: string) => fireEvent.click(screen.getByRole("option", { name: new RegExp(code) }));

beforeEach(() => {
  mockGetKnownRoutesPage.mockReset();
  mockSearchKnownRoutes.mockReset();
  mockSearchCrossIATARoutes.mockReset();
  mockGetIatas.mockReset();
  mockGetRegions.mockReset();
  mockGetKnownRoutesPage.mockResolvedValue({ items: [], nextCursor: null, hasMore: false });
  mockSearchKnownRoutes.mockResolvedValue([]);
  mockSearchCrossIATARoutes.mockResolvedValue([]);
  mockGetRegions.mockResolvedValue([]);
  mockGetIatas.mockResolvedValue([
    { iata: "AAA", displayName: "Alpha" },
    { iata: "BBB", displayName: "Beta" },
  ]);
});

describe("RouteTable search", () => {
  it("allows the route root to shrink inside the mobile flex chain", async () => {
    renderTable();
    await screen.findByText("Find path");
    const root = screen.getByText("Find path").closest(".flex.flex-col.flex-1");
    expect(root).toHaveClass("min-w-0", "w-full");
  });

  it("searches within a single IATA when exactly one IATA is selected", async () => {
    renderTable();
    await screen.findByText("Find path");

    fireEvent.change(screen.getByPlaceholderText("from hash"), { target: { value: "aa11" } });
    fireEvent.change(screen.getByPlaceholderText("to hash"), { target: { value: "bb22" } });
    openIataPicker();
    checkIata("AAA");
    fireEvent.click(screen.getByText("Search"));

    await waitFor(() => expect(mockSearchKnownRoutes).toHaveBeenCalledWith("AAA", "aa11", "bb22"));
    expect(mockSearchCrossIATARoutes).not.toHaveBeenCalled();
  });

  it("searches cross-IATA when two IATAs are selected, rendering the segmented chain", async () => {
    const cross: CrossIATARoute = {
      sourceSegment: [{ nodeId: "n1", hashBytes: "aa11", node: node("n1", "Src Node") }],
      crossHop: { fromNode: node("n1", "Src Node"), toNode: node("n2", "Dst Node"), fromIata: "AAA", toIata: "BBB", lastSeen: 2 },
      targetSegment: [{ nodeId: "n2", hashBytes: "bb22", node: node("n2", "Dst Node") }],
      totalHops: 3,
    };
    mockSearchCrossIATARoutes.mockImplementation((_f, fromIata, _t, toIata) =>
      Promise.resolve(fromIata === "AAA" && toIata === "BBB" ? [cross] : []),
    );

    renderTable();
    await screen.findByText("Find path");

    fireEvent.change(screen.getByPlaceholderText("from hash"), { target: { value: "aa11" } });
    fireEvent.change(screen.getByPlaceholderText("to hash"), { target: { value: "bb22" } });
    openIataPicker();
    checkIata("AAA");
    checkIata("BBB");
    fireEvent.click(screen.getByText("Search"));

    await waitFor(() =>
      expect(mockSearchCrossIATARoutes).toHaveBeenCalledWith("aa11", "AAA", "bb22", "BBB"),
    );
    expect(mockSearchKnownRoutes).not.toHaveBeenCalled();
    expect((await screen.findAllByText("Src Node")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Dst Node").length).toBeGreaterThan(0);
  });

  it("sends every selected region IATA to the backend", async () => {
    const wanted: KnownRoute = { id: 2, iata: "AAA", hopCount: 2, hops: [], firstSeen: 1, lastSeen: 3, observationCount: 17 };
    mockGetKnownRoutesPage.mockResolvedValue({ items: [wanted], nextPageToken: null, nextCursor: null, hasMore: false });

    renderTable({ regions: [], iatas: ["AAA", "BBB"] });

    expect(await screen.findByText("17")).toBeInTheDocument();
    expect(mockGetKnownRoutesPage).toHaveBeenCalledWith(expect.objectContaining({
      iatas: ["AAA", "BBB"],
      sort: "last_seen",
      direction: "desc",
    }));
  });

  it("requests a newly sorted page instead of sorting loaded rows locally", async () => {
    const route: KnownRoute = { id: 3, iata: "AAA", hopCount: 3, hops: [], firstSeen: 1, lastSeen: 2, observationCount: 8 };
    mockGetKnownRoutesPage.mockResolvedValue({ items: [route], nextPageToken: null, nextCursor: null, hasMore: false });
    renderTable();
    await screen.findByText("8");

    fireEvent.click(screen.getByRole("button", { name: /Hops/ }));

    await waitFor(() => expect(mockGetKnownRoutesPage).toHaveBeenLastCalledWith(expect.objectContaining({
      sort: "hops",
      direction: "asc",
    })));
  });

  it("shows a route's observation count in the list", async () => {
    const route: KnownRoute = {
      id: 7,
      iata: "AAA",
      hopCount: 2,
      hops: [],
      firstSeen: 1,
      lastSeen: 2,
      observationCount: 42,
    };
    mockGetKnownRoutesPage.mockResolvedValue({ items: [route], nextCursor: null, hasMore: false });

    renderTable();

    expect(await screen.findByText("42")).toBeInTheDocument();
  });
});
