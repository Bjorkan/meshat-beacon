import { describe, expect, it } from "vitest";
import {
  PACKET_PULSE_DURATION_MS,
  PACKET_PULSE_MAX_RADIUS_PX,
  PACKET_PULSE_MIN_RADIUS_PX,
  PACKET_RELAY_FORWARD_DELAY_MS,
  packetPulseFrame,
} from "../../../src/features/map/packet-flow-pulses";

describe("packet flow node pulses", () => {
  it("expands and fades a transmit wave away from the node", () => {
    const start = packetPulseFrame("outbound", 0)!;
    const mid = packetPulseFrame("outbound", PACKET_PULSE_DURATION_MS / 2)!;
    const end = packetPulseFrame("outbound", PACKET_PULSE_DURATION_MS - 1)!;
    expect(start.radius).toBe(PACKET_PULSE_MIN_RADIUS_PX);
    expect(mid.radius).toBeGreaterThan(start.radius);
    expect(end.radius).toBeCloseTo(PACKET_PULSE_MAX_RADIUS_PX, 0);
    expect(start.opacity).toBeGreaterThan(mid.opacity);
    expect(mid.opacity).toBeGreaterThan(end.opacity);
    expect(start.strokeWidth).toBeGreaterThan(end.strokeWidth);
  });

  it("contracts a receive wave into the node", () => {
    const start = packetPulseFrame("inbound", 0)!;
    const mid = packetPulseFrame("inbound", PACKET_PULSE_DURATION_MS / 2)!;
    const end = packetPulseFrame("inbound", PACKET_PULSE_DURATION_MS - 1)!;
    expect(start.radius).toBe(PACKET_PULSE_MAX_RADIUS_PX);
    expect(mid.radius).toBeLessThan(start.radius);
    expect(end.radius).toBeCloseTo(PACKET_PULSE_MIN_RADIUS_PX, 0);
    expect(end.strokeWidth).toBeGreaterThan(start.strokeWidth);
    expect(mid.opacity).toBeGreaterThan(start.opacity);
    expect(end.opacity).toBeLessThan(start.opacity);
  });

  it("is time-bounded and permits a short receive-to-forward relay beat", () => {
    expect(packetPulseFrame("outbound", -1)).toBeNull();
    expect(packetPulseFrame("inbound", PACKET_PULSE_DURATION_MS)).toBeNull();
    expect(PACKET_RELAY_FORWARD_DELAY_MS).toBeGreaterThan(0);
    expect(PACKET_RELAY_FORWARD_DELAY_MS).toBeLessThan(PACKET_PULSE_DURATION_MS / 3);
  });
});
