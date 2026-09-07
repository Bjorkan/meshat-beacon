import { expect, it } from 'vitest';
import { mapOverlayInsets } from '../../../src/features/map/map-insets';

it.each([320, 360, 390, 430, 1280])('keeps a usable content rectangle at %d px', (width) => {
  for (const height of [240, 600, 900])
    for (const live of [false, true]) {
      const p = mapOverlayInsets(width, height, live);
      expect(width - p.left - p.right).toBeGreaterThan(width * 0.4);
      expect(height - p.top - p.bottom).toBeGreaterThanOrEqual(height * 0.19);
    }
});
it('reserves the bottom loading/LIVE lane and the responsive feed', () => {
  expect(mapOverlayInsets(390, 700, false).bottom).toBeGreaterThanOrEqual(112);
  expect(mapOverlayInsets(390, 700, true).bottom).toBeGreaterThan(350);
  expect(mapOverlayInsets(1280, 700, true).right).toBeGreaterThanOrEqual(384);
});
