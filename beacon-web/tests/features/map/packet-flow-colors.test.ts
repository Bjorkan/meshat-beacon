import { describe, expect, it } from "vitest";
import { PACKET_FLOW_COLORS, packetFlowColor } from "../../../src/features/map/packet-flow-colors";

describe("packetFlowColor", () => {
  it("is stable for the same hash, including empty or unusual input", () => {
    expect(packetFlowColor("abc123")).toBe(packetFlowColor("abc123"));
    expect(packetFlowColor("")).toBe(packetFlowColor(""));
    expect(packetFlowColor("💥/not-hex")).toBe(packetFlowColor("💥/not-hex"));
  });

  it("always chooses a curated color and distributes representative packet hashes", () => {
    const colors = ["a1", "b2", "c3", "d4", "e5", "f6", "0123456789abcdef"].map(packetFlowColor);
    expect(colors.every((color) => PACKET_FLOW_COLORS.includes(color as typeof PACKET_FLOW_COLORS[number]))).toBe(true);
    expect(new Set(colors).size).toBeGreaterThan(1);
  });
});
