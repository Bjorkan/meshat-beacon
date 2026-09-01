export type PacketPulseDirection = "outbound" | "inbound";

export interface PacketPulseFrame {
  radius: number;
  opacity: number;
  strokeWidth: number;
  glowRadius: number;
  glowOpacity: number;
}

export const PACKET_PULSE_DURATION_MS = 760;
export const PACKET_PULSE_MIN_RADIUS_PX = 4;
export const PACKET_PULSE_MAX_RADIUS_PX = 27;
export const PACKET_RELAY_FORWARD_DELAY_MS = 90;
export const PACKET_PULSE_MAX = 240;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

// A transmit pulse expands away from the node. A receive pulse uses the same visual language in
// reverse: the ring contracts into the node and is absorbed by the existing node glow at arrival.
// This is pure and time-based so dropped frames never alter the animation's duration or direction.
export function packetPulseFrame(
  direction: PacketPulseDirection,
  elapsedMs: number,
): PacketPulseFrame | null {
  if (elapsedMs < 0 || elapsedMs >= PACKET_PULSE_DURATION_MS) return null;
  const t = clamp01(elapsedMs / PACKET_PULSE_DURATION_MS);

  if (direction === "outbound") {
    const radius = lerp(PACKET_PULSE_MIN_RADIUS_PX, PACKET_PULSE_MAX_RADIUS_PX, t);
    const opacity = 0.92 * Math.pow(1 - t, 1.25);
    return {
      radius,
      opacity,
      strokeWidth: lerp(2.4, 0.9, t),
      glowRadius: radius + 3,
      glowOpacity: 0.22 * Math.pow(1 - t, 1.4),
    };
  }

  const radius = lerp(PACKET_PULSE_MAX_RADIUS_PX, PACKET_PULSE_MIN_RADIUS_PX, t);
  // Keep the incoming ring readable at the outside, peak near the middle, then let the node glow
  // carry the final impact instead of snapping to a bright ring at radius zero.
  const midPeak = 1 - Math.abs(2 * t - 1);
  // Fade the final ~20% as the ring is absorbed into the node. The feature-state glow is already
  // strongest at arrival, so this avoids a one-frame snap when the contracting ring reaches zero.
  const impactFade = clamp01((1 - t) / 0.2);
  const opacity = (0.34 + 0.56 * midPeak) * impactFade;
  return {
    radius,
    opacity,
    strokeWidth: lerp(0.9, 2.5, t),
    glowRadius: radius + 3,
    glowOpacity: (0.1 + 0.14 * midPeak) * impactFade,
  };
}
