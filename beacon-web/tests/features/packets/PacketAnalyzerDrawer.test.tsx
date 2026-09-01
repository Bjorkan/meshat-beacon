import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PacketAnalyzerDrawer } from "../../../src/features/packets/PacketAnalyzerDrawer";
import type { PacketDetail } from "../../../src/types/api";
import { PayloadType, RouteType } from "../../../src/types/enums";

describe("PacketAnalyzerDrawer close", () => {
  it("delegates URL-backed closing to its route owner", () => {
    const onClose = vi.fn();
    render(
      <PacketAnalyzerDrawer detail={undefined} selectedObservationId={null} onClose={onClose} />,
    );

    fireEvent.click(screen.getByLabelText("Close analyzer"));

    expect(onClose).toHaveBeenCalledOnce();
  });
});

const hop = (id: string, lng: number, lat: number) => ({ confidence: "high" as const, nodes: [{ id, name: `Node ${id.toUpperCase()}`, publicKey: "pk", longitude: lng, latitude: lat }] });

function makeDetail(resolvedPath: unknown[]): PacketDetail {
  return {
    packetHash: "abcdef12",
    header: { raw: "12", routeType: RouteType.FLOOD, routeTypeName: "FLOOD", payloadType: PayloadType.TEXT, payloadTypeName: "TXT_MSG", payloadVersion: 1 },
    firstHeardAt: 0, lastHeardAt: 0, firstToLastMs: 0, observationCount: 1,
    rawPayload: "", decrypted: false,
    observations: [{ id: 1, observerId: "obs12345", iata: "YYZ", heardAt: 0, sourceBroker: "b", pathLength: { raw: "02", hashSize: 1, hopCount: resolvedPath.length }, resolvedPath }],
  } as unknown as PacketDetail;
}

describe("PacketAnalyzerDrawer copy link", () => {
  const writeText = vi.fn();

  beforeEach(() => {
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, writable: true, configurable: true });
    writeText.mockClear();
  });

  afterEach(() => window.history.replaceState({}, "", "/"));

  it("copies a link that reopens the drawer over the expanded row", () => {
    render(
      <PacketAnalyzerDrawer detail={makeDetail([])} selectedObservationId={null} onClose={() => {}} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Copy packet link" }));

    const copied = new URL(writeText.mock.calls[0]![0] as string);
    expect(copied.pathname).toBe("/packets");
    expect(copied.searchParams.get("hash")).toBe("abcdef12");
    expect(copied.searchParams.get("analyze")).toBe("1"); // the drawer is part of the shared state
  });
});

describe("PacketAnalyzerDrawer view-path button", () => {
  it("enables the button and calls onViewPath when a path is drawable", () => {
    const onViewPath = vi.fn();
    render(
      <PacketAnalyzerDrawer detail={makeDetail([hop("a", -79, 43), hop("b", -75, 45)])} selectedObservationId={null} onClose={() => {}} onViewPath={onViewPath} />,
    );
    const btn = screen.getByRole("button", { name: /view path on map/i });
    expect(btn).toBeEnabled();
    fireEvent.click(btn);
    expect(onViewPath).toHaveBeenCalledOnce();
  });

  it("disables the button when no path is drawable", () => {
    render(
      <PacketAnalyzerDrawer detail={makeDetail([hop("a", -79, 43)])} selectedObservationId={null} onClose={() => {}} onViewPath={() => {}} />,
    );
    expect(screen.getByRole("button", { name: /view path on map/i })).toBeDisabled();
  });
});

describe("PacketAnalyzerDrawer TRACE path data", () => {
  // After beacon-server's trace-path fix (7a58a07) a TRACE observation's pathBytes are the trace's
  // own path hashes (with matching hashSize/hopCount and a real resolvedPath), not raw SNR bytes —
  // so it must render as resolved Path Data, not under the old "Path SNR Data" label.
  function traceDetail(): PacketDetail {
    return {
      packetHash: "abcdef12",
      header: { raw: "12", routeType: RouteType.FLOOD, routeTypeName: "FLOOD", payloadType: PayloadType.TRACE, payloadTypeName: "TRACE", payloadVersion: 1 },
      firstHeardAt: 0, lastHeardAt: 0, firstToLastMs: 0, observationCount: 1,
      rawPayload: "", decrypted: false,
      observations: [{
        id: 1, observerId: "obs12345", iata: "YYZ", heardAt: 0, sourceBroker: "b",
        pathLength: { raw: "02", hashSize: 1, hopCount: 2 },
        pathBytes: "abcd",
        resolvedPath: [hop("a", -79, 43), hop("b", -75, 45)],
      }],
    } as unknown as PacketDetail;
  }

  it("renders TRACE path bytes as resolved Path Data, not raw 'Path SNR Data'", () => {
    render(
      <PacketAnalyzerDrawer detail={traceDetail()} selectedObservationId={null} onClose={() => {}} />,
    );
    expect(screen.queryByText("Path SNR Data")).not.toBeInTheDocument();
    expect(screen.getByText("Path Data")).toBeInTheDocument();
    // the first trace hop renders its high-confidence node name as primary, tinted green.
    expect(screen.getByText("Node A").className).toContain("text-green");
  });
});
