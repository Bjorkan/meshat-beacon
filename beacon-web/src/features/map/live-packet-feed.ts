import type { WsPacketObservation } from "../../types/ws";

export const LIVE_PACKET_FEED_LIMIT = 5;

export interface LivePacketEntry {
  packetHash: string;
  payloadType: number;
  payloadTypeName: string;
  routeTypeName: string;
  observationCount: number;
  scope?: string;
  iata: string;
  heardAt: number;
  hopCount?: number;
}

export function livePacketEntry(data: WsPacketObservation["data"]): LivePacketEntry {
  return {
    packetHash: data.packetHash,
    payloadType: data.packet.payloadType,
    payloadTypeName: data.packet.payloadTypeName,
    routeTypeName: data.packet.routeTypeName,
    observationCount: data.packet.observationCount,
    scope: data.packet.scope,
    iata: data.observation.iata,
    heardAt: data.observation.heardAt,
    hopCount: data.observation.pathLength?.hopCount,
  };
}

export function pushLivePacket(
  entries: LivePacketEntry[],
  entry: LivePacketEntry,
  limit = LIVE_PACKET_FEED_LIMIT,
): LivePacketEntry[] {
  return [entry, ...entries.filter((item) => item.packetHash !== entry.packetHash)].slice(0, limit);
}
