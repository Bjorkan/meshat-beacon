import { describe, it, expect } from "vitest";
import {
  ALL_REGIONS,
  isAllRegions,
  resolveIatas,
  regionKey,
  serializeSelection,
  deserializeSelection,
  type RegionSelection,
} from "../../src/hooks/region-selection";

const regionIatas = new Map<string, string[]>([
  ["western-canada", ["YVR", "YYJ"]],
  ["cascadia", ["YVR", "SEA"]], // intentionally overlaps YVR with western-canada
]);

describe("isAllRegions", () => {
  it("is true only for an empty selection", () => {
    expect(isAllRegions(ALL_REGIONS)).toBe(true);
    expect(isAllRegions({ regions: [], iatas: [] })).toBe(true);
    expect(isAllRegions({ regions: ["cascadia"], iatas: [] })).toBe(false);
    expect(isAllRegions({ regions: [], iatas: ["YVR"] })).toBe(false);
  });
});

describe("resolveIatas", () => {
  it("returns undefined (= all) for an empty selection", () => {
    expect(resolveIatas(ALL_REGIONS, regionIatas)).toBeUndefined();
  });

  it("returns the selected IATAs sorted and deduped", () => {
    expect(resolveIatas({ regions: [], iatas: ["YYJ", "YVR", "YVR"] }, regionIatas)).toEqual(["YVR", "YYJ"]);
  });

  it("expands region slugs to their member IATAs", () => {
    expect(resolveIatas({ regions: ["western-canada"], iatas: [] }, regionIatas)).toEqual(["YVR", "YYJ"]);
  });

  it("unions regions and individual IATAs, deduping the overlap", () => {
    expect(resolveIatas({ regions: ["western-canada", "cascadia"], iatas: ["YYZ"] }, regionIatas)).toEqual([
      "SEA",
      "YVR",
      "YYJ",
      "YYZ",
    ]);
  });

  it("ignores a region slug that isn't in the map yet", () => {
    expect(resolveIatas({ regions: ["not-loaded"], iatas: ["YVR"] }, regionIatas)).toEqual(["YVR"]);
  });
});

describe("regionKey", () => {
  it("is '*' when there is no filter", () => {
    expect(regionKey(undefined)).toBe("*");
    expect(regionKey([])).toBe("*");
  });

  it("joins the resolved IATAs for a stable query key", () => {
    expect(regionKey(["YVR", "YYJ"])).toBe("YVR,YYJ");
  });
});

describe("serialize/deserialize", () => {
  it("round-trips a selection", () => {
    const sel: RegionSelection = { regions: ["cascadia"], iatas: ["YVR"] };
    expect(deserializeSelection(serializeSelection(sel))).toEqual(sel);
  });

  it("falls back to all-regions on missing or malformed input", () => {
    expect(deserializeSelection(null)).toEqual(ALL_REGIONS);
    expect(deserializeSelection("not json")).toEqual(ALL_REGIONS);
    expect(deserializeSelection('{"regions":"oops"}')).toEqual(ALL_REGIONS);
  });
});
