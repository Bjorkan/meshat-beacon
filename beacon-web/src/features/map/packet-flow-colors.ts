export const PACKET_FLOW_COLORS = [
  "#22C55E", "#38BDF8", "#F97316", "#A78BFA", "#F43F5E",
  "#EAB308", "#2DD4BF", "#60A5FA", "#E879F9", "#84CC16",
] as const;

// FNV-1a: tiny deterministic hash, sufficient to choose a stable palette bucket without state.
export function packetFlowColor(packetHash: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < packetHash.length; i += 1) {
    hash ^= packetHash.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return PACKET_FLOW_COLORS[(hash >>> 0) % PACKET_FLOW_COLORS.length]!;
}
