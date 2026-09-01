import { describe, it, expect } from "vitest";
import { buildPathSummary, MAX_PATH_HOPS_SHOWN } from "../../../src/features/packets/path-summary";
import type { PacketSummary } from "../../../src/types/api";
import { PayloadType } from "../../../src/types/enums";

const pkt = (over: Partial<PacketSummary> = {}): PacketSummary => ({
  packetHash: "AA11", payloadType: 1, payloadTypeName: "ADVERT",
  routeType: 1, routeTypeName: "FLOOD",
  firstHeardAt: 0, lastHeardAt: 0, observationCount: 1, ...over,
});
const obs = (o: object) => ({ latestObserver: { id: "o1", iata: "YVR", ...o } });

describe("buildPathSummary", () => {
  it("is n/a without path metadata", () => {
    expect(buildPathSummary(pkt()).isNa).toBe(true);
    expect(buildPathSummary(pkt(obs({ pathBytes: "7fa4" }))).isNa).toBe(true);
  });

  it("labels a literal zero-hop path as direct", () => {
    expect(buildPathSummary(pkt(obs({ pathLength: { raw: "00", hashSize: 1, hopCount: 0 } })))).toMatchObject({
      hopLabel: "0 hops · direct", chips: [], isNa: false,
    });
  });

  it("shows raw hashes when the REST/WS row has no resolution", () => {
    const s = buildPathSummary(pkt(obs({
      pathLength: { raw: "42", hashSize: 1, hopCount: 2 }, pathBytes: "7fa4",
    })));
    expect(s.chips).toEqual([
      { kind: "hex", label: "7F", confidence: "none" },
      { kind: "hex", label: "A4", confidence: "none" },
    ]);
  });

  it("uses a human-readable name only for a single high-confidence resolution", () => {
    const s = buildPathSummary(pkt(obs({
      pathLength: { raw: "42", hashSize: 1, hopCount: 2 }, pathBytes: "7fa4",
      resolvedPath: [
        { confidence: "high", nodes: [{ id: "n1", publicKey: "7f0011", name: "Lambhov" }] },
        { confidence: "none", nodes: [] },
      ],
    })));
    expect(s.chips).toEqual([
      { kind: "node", label: "Lambhov", raw: "7F", confidence: "high" },
      { kind: "hex", label: "A4", confidence: "none" },
    ]);
  });

  it("keeps the raw hash primary for ambiguous resolution and exposes candidate count", () => {
    const s = buildPathSummary(pkt(obs({
      pathLength: { raw: "41", hashSize: 1, hopCount: 1 }, pathBytes: "7f",
      resolvedPath: [{ confidence: "ambiguous", nodes: [
        { id: "n1", publicKey: "7f00", name: "One" },
        { id: "n2", publicKey: "7f11", name: "Two" },
      ] }],
    })));
    expect(s.chips).toEqual([{ kind: "hex", label: "7F", confidence: "ambiguous", candidateCount: 2 }]);
  });

  it("rejects malformed pathBytes rather than guessing chunk boundaries", () => {
    const s = buildPathSummary(pkt(obs({
      pathLength: { raw: "43", hashSize: 1, hopCount: 3 }, pathBytes: "7fa4",
    })));
    expect(s.chips).toEqual([]);
    expect(s.hopLabel).toBe("3 hops");
  });

  it("truncates long paths to the inline budget", () => {
    const s = buildPathSummary(pkt(obs({
      pathLength: { raw: "4a", hashSize: 1, hopCount: 10 },
      pathBytes: "00010203040506070809",
    })));
    expect(s.chips).toHaveLength(MAX_PATH_HOPS_SHOWN);
    expect(s.overflow).toBe(10 - MAX_PATH_HOPS_SHOWN);
  });

  it("does not interpret TRACE observation SNR bytes as path hashes", () => {
    const s = buildPathSummary(pkt({
      payloadType: PayloadType.TRACE,
      ...obs({ pathLength: { raw: "43", hashSize: 1, hopCount: 3 }, pathBytes: "000102" }),
    }));
    expect(s.hopLabel).toBe("3 hops");
    expect(s.chips).toEqual([]);
  });
});
