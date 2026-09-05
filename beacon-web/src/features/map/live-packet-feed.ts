import type { WsPacketObservation } from '../../types/ws';
import { packetChain, resolvedPathNodes } from './packet-flow';

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

// Shared eligibility for the live map flow and the live packet feed: a packet is renderable only
// when it carries a resolved path whose route width is multibyte (1-byte prefixes are ambiguous)
// and whose located nodes form a drawable chain of at least two nodes. Both consumers must use
// this helper so feed and renderer cannot drift apart.
export function buildLiveFlowCandidate(
  observation: WsPacketObservation['data']['observation'],
): { coords: [number, number][]; ids: (string | null)[] } | null {
  if (!observation?.resolvedPath) return null;
  if ((observation.pathLength?.hashSize ?? 0) < 2) return null;
  const nodes = resolvedPathNodes(
    packetChain(
      observation.resolvedSource,
      observation.resolvedPath,
      observation.resolvedDestination,
    ),
  );
  if (nodes.length < 2) return null;
  return {
    coords: nodes.map((node) => [node.lng, node.lat] as [number, number]),
    ids: nodes.map((node) => node.id),
  };
}

export function livePacketEntry(data: WsPacketObservation['data']): LivePacketEntry {
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
