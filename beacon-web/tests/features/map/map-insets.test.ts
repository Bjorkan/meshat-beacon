import { expect, it } from 'vitest';
import { mapOverlayInsets } from '../../../src/features/map/map-insets';

it.each([320, 360, 390, 430, 680, 768, 1280])(
  'keeps a usable content rectangle at %d px',
  (width) => {
    for (const height of [240, 600, 900])
      for (const live of [false, true]) {
        const p = mapOverlayInsets(width, height, live);
        expect(width - p.left - p.right).toBeGreaterThan(width * 0.4);
        expect(height - p.top - p.bottom).toBeGreaterThanOrEqual(height * 0.19);
      }
  },
);
it('reserves the bottom loading/LIVE lane and the responsive feed', () => {
  expect(mapOverlayInsets(390, 700, false).bottom).toBeGreaterThanOrEqual(112);
  expect(mapOverlayInsets(390, 700, true).bottom).toBeGreaterThan(340);
  expect(mapOverlayInsets(1280, 700, true).right).toBeGreaterThanOrEqual(384);
});
it('stacks the feed when a desktop sidebar leaves a narrow map', () => {
  const narrow = mapOverlayInsets(680, 700, true);
  const wide = mapOverlayInsets(1100, 700, true);
  expect(narrow.bottom).toBeGreaterThan(wide.bottom);
  expect(narrow.right).toBeLessThan(wide.right);
});
