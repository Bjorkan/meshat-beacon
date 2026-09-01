import { describe, expect, it } from "vitest";
import { prepareSpiderfyForDirectUse } from "../../../src/features/map/spiderfy-adapter";

describe("prepareSpiderfyForDirectUse", () => {
  it("supplies the parent style metadata Spiderfy 2.0.0 needs for direct spiderfy()", () => {
    const spider = { clickedParentClusterStyle: null };

    prepareSpiderfyForDirectUse(spider);

    expect(spider.clickedParentClusterStyle).toEqual({
      type: "symbol",
      layout: {},
      paint: {},
    });
  });
});
