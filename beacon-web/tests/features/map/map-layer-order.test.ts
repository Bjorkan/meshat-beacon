import { describe, expect, it, vi } from "vitest";
import { MAP_OVERLAY_LAYER_ORDER, syncMapOverlayLayerOrder } from "../../../src/features/map/map-layer-order";

describe("map overlay layer order", () => {
  it("moves every existing Beacon layer into the declared bottom-to-top order", () => {
    const present = new Set(MAP_OVERLAY_LAYER_ORDER.filter((_, index) => index % 2 === 0));
    const moveLayer = vi.fn();

    syncMapOverlayLayerOrder({
      getLayer: (id: string) => present.has(id) ? ({ id } as never) : undefined,
      moveLayer,
    });

    expect(moveLayer.mock.calls.map(([id]) => id)).toEqual(
      MAP_OVERLAY_LAYER_ORDER.filter((id) => present.has(id)),
    );
  });
});
