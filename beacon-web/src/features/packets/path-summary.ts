import type { PacketSummary, ResolvedHop } from "../../types/api";
import type { PathConfidence } from "../../types/enums";
import { PayloadType } from "../../types/enums";

export const MAX_PATH_HOPS_SHOWN = 4;

export type PathChip =
  | { kind: "node"; label: string; raw: string; confidence: "high" }
  | { kind: "hex"; label: string; confidence: Exclude<PathConfidence, "high">; candidateCount?: number };

export interface PathSummary {
  hopLabel: string;
  chips: PathChip[];
  overflow: number;
  isNa: boolean;
}

const NA: PathSummary = { hopLabel: "n/a", chips: [], overflow: 0, isNa: true };

function rawHops(pathBytes: string | undefined, hashSize: number, hopCount: number): string[] {
  if (!pathBytes || hashSize < 1 || hopCount < 1) return [];
  const width = hashSize * 2;
  if (pathBytes.length !== width * hopCount) return [];
  const out: string[] = [];
  for (let i = 0; i < pathBytes.length; i += width) out.push(pathBytes.slice(i, i + width).toUpperCase());
  return out;
}

function chipFor(raw: string, hop: ResolvedHop | undefined): PathChip {
  if (hop?.confidence === "high" && hop.nodes.length === 1) {
    const node = hop.nodes[0]!;
    return {
      kind: "node",
      label: node.name ?? node.publicKey.slice(0, 8).toUpperCase(),
      raw,
      confidence: "high",
    };
  }
  if (hop?.confidence === "ambiguous") {
    return { kind: "hex", label: raw, confidence: "ambiguous", candidateCount: hop.nodes.length };
  }
  return { kind: "hex", label: raw, confidence: "none" };
}

export function buildPathSummary(packet: PacketSummary): PathSummary {
  const observer = packet.latestObserver;
  const length = observer?.pathLength;
  if (!observer || !length) return NA;

  const { hopCount, hashSize } = length;
  const base = { hopLabel: `${hopCount} hops`, chips: [] as PathChip[], overflow: 0, isNa: false };
  if (hopCount === 0) return { ...base, hopLabel: "0 hops · direct" };

  // TRACE's observation path field is per-hop SNR data. Packet detail reconstructs the intended
  // trace route separately, so the list must never label these bytes as path hashes.
  if (packet.payloadType === PayloadType.TRACE) return base;

  const raw = rawHops(observer.pathBytes, hashSize, hopCount);
  if (raw.length === 0) return base;
  const chips = raw.slice(0, MAX_PATH_HOPS_SHOWN).map((hash, i) => chipFor(hash, observer.resolvedPath?.[i]));
  return { ...base, chips, overflow: Math.max(0, hopCount - chips.length) };
}
