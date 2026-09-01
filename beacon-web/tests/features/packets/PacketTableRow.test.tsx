import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PacketTableRow } from "../../../src/features/packets/PacketTableRow";
import type { LatestObserver, PacketSummary } from "../../../src/types/api";

const pkt = (over: Partial<PacketSummary> = {}): PacketSummary => ({
  packetHash: "AA11BB22", payloadType: 1, payloadTypeName: "ADVERT",
  routeType: 1, routeTypeName: "FLOOD",
  firstHeardAt: 1700000000, lastHeardAt: 1700000000, observationCount: 3, ...over,
});

const observer = (
  over: Partial<LatestObserver> & { hopCount?: number; hashSize?: number } = {},
): LatestObserver => {
  const { hopCount = 2, hashSize = 1, ...rest } = over;
  return { id: "abcdef1234", displayName: "Cypress Peak", iata: "YVR", pathLength: { raw: "1e", hashSize, hopCount }, ...rest };
};

function renderRow(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe("PacketTableRow", () => {
  it("exposes one button carrying the expansion state and toggles on click", () => {
    const onToggle = vi.fn();
    renderRow(<PacketTableRow packet={pkt()} expanded={false} onToggle={onToggle} />);
    const btn = screen.getByRole("button");
    expect(btn).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(btn);
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it("shows observer identity and area inline", () => {
    renderRow(<PacketTableRow packet={pkt({ latestObserver: observer() })} expanded={false} onToggle={() => {}} />);
    expect(screen.getByText("Cypress Peak")).toBeInTheDocument();
    expect(screen.getByText(/· YVR/)).toBeInTheDocument();
  });

  it("falls back to observer id prefix when displayName is absent", () => {
    renderRow(<PacketTableRow packet={pkt({ latestObserver: observer({ displayName: undefined }) })} expanded={false} onToggle={() => {}} />);
    expect(screen.getByText("abcdef12")).toBeInTheDocument();
  });

  it("combines hop count and hash size into one compact diagnostic", () => {
    renderRow(<PacketTableRow packet={pkt({ latestObserver: observer({ hopCount: 5, hashSize: 3 }) })} expanded={false} onToggle={() => {}} />);
    expect(screen.getByText("5h · 3B")).toBeInTheDocument();
  });

  it("shows raw inline path without expanding", () => {
    renderRow(<PacketTableRow packet={pkt({ latestObserver: observer({ pathBytes: "7fa4" }) })} expanded={false} onToggle={() => {}} />);
    expect(screen.getByText("7F")).toBeInTheDocument();
    expect(screen.getByText("A4")).toBeInTheDocument();
  });

  it("prefers high-confidence node names but keeps ambiguous hops as raw hashes", () => {
    renderRow(<PacketTableRow packet={pkt({ latestObserver: observer({
      pathBytes: "7fa4",
      resolvedPath: [
        { confidence: "high", nodes: [{ id: "n1", publicKey: "7f00", name: "Lambhov" }] },
        { confidence: "ambiguous", nodes: [
          { id: "n2", publicKey: "a400", name: "One" },
          { id: "n3", publicKey: "a411", name: "Two" },
        ] },
      ],
    }) })} expanded={false} onToggle={() => {}} />);
    expect(screen.getByText("Lambhov")).toBeInTheDocument();
    expect(screen.getByText("A4")).toBeInTheDocument();
    expect(screen.queryByText("One")).not.toBeInTheDocument();
  });

  it("keeps one compact desktop row and shows n/a when observer data is absent", () => {
    const { container } = renderRow(<PacketTableRow packet={pkt()} expanded={false} onToggle={() => {}} />);
    expect(container.querySelectorAll("button")).toHaveLength(1);
    expect(screen.getAllByText("n/a").length).toBeGreaterThanOrEqual(3);
  });

  it("reflects expanded/fresh/scope and fallback labels", () => {
    const { container } = renderRow(<PacketTableRow packet={pkt({ scope: "#bc", routeTypeName: "", payloadType: 99, payloadTypeName: "CUSTOM_99" })} expanded isFresh onToggle={() => {}} />);
    expect(screen.getByRole("button")).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("›")).toHaveClass("rotate-90");
    expect(screen.getByText("#bc")).toBeInTheDocument();
    expect(screen.getByText("CUSTOM_99")).toBeInTheDocument();
    expect(screen.getByText("Unknown")).toBeInTheDocument();
    expect(container.querySelector(".packet-fresh")).not.toBeInTheDocument(); // expanded styling wins by design
  });
});
