import { describe, it, expect } from "vitest";
import { mergeBorders } from "../../../src/features/map/useMapBordersData";
import type { Feature, Polygon } from "geojson";

const poly = (id: number): Feature<Polygon> => ({
  type: "Feature",
  properties: { name: `p${id}` },
  geometry: { type: "Polygon", coordinates: [[[id, 0], [id + 1, 0], [id + 1, 1], [id, 0]]] },
});

describe("mergeBorders", () => {
  it("drops IATAs with no border and stamps the iata onto each feature's properties", () => {
    const fc = mergeBorders([
      { iata: "YOW", border: poly(0) },
      { iata: "YYZ", border: null },
      { iata: "YUL", border: poly(5) },
    ]);

    expect(fc.type).toBe("FeatureCollection");
    expect(fc.features).toHaveLength(2);
    expect(fc.features.map((f) => f.properties.iata)).toEqual(["YOW", "YUL"]);
    // existing properties and geometry survive the merge
    expect(fc.features[0]!.properties.name).toBe("p0");
    expect(fc.features[0]!.geometry).toEqual(poly(0).geometry);
  });

  it("returns an empty FeatureCollection when nothing has a border", () => {
    const fc = mergeBorders([{ iata: "YOW", border: null }]);
    expect(fc.features).toHaveLength(0);
  });
});
