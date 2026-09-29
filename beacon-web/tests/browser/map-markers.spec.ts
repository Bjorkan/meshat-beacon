import { expect, test } from '@playwright/test';

interface MarkerDraw {
  text: string;
  rings: Array<{ color: string; sweep: number }>;
  eyeCurves: number;
}
declare global {
  interface Window {
    markerDraws: MarkerDraw[];
  }
}

test('map renders actual cluster proportions and three-byte observer capsules', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1100, height: 800 });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem('beacon-language', 'en');
    sessionStorage.setItem('meshat-splash-shown', '1');
    window.markerDraws = [];
    const records = new WeakMap<CanvasRenderingContext2D, MarkerDraw & { arc?: number }>();
    const record = (ctx: CanvasRenderingContext2D) => {
      if (!records.has(ctx)) records.set(ctx, { text: '', rings: [], eyeCurves: 0 });
      return records.get(ctx)!;
    };
    const proto = CanvasRenderingContext2D.prototype;
    const { beginPath, arc, stroke, fillText, quadraticCurveTo, getImageData } = proto;
    proto.beginPath = function () {
      record(this).arc = undefined;
      return beginPath.call(this);
    };
    proto.arc = function (...args) {
      record(this).arc = args[4] - args[3];
      return arc.apply(this, args);
    };
    proto.stroke = function (...args: Parameters<typeof stroke>) {
      const data = record(this);
      if (data.arc !== undefined)
        data.rings.push({ color: String(this.strokeStyle), sweep: data.arc });
      return stroke.apply(this, args);
    };
    proto.fillText = function (...args) {
      record(this).text = args[0];
      return fillText.apply(this, args);
    };
    proto.quadraticCurveTo = function (...args) {
      record(this).eyeCurves++;
      return quadraticCurveTo.apply(this, args);
    };
    proto.getImageData = function (...args) {
      const data = record(this);
      if (data.text)
        window.markerDraws.push({
          text: data.text,
          rings: [...data.rings],
          eyeCurves: data.eyeCurves,
        });
      return getImageData.apply(this, args);
    };
  });
  await page.routeWebSocket('**/ws', () => {});
  await page.route('https://tiles.openfreemap.org/**', (route) =>
    route.fulfill({
      json: {
        version: 8,
        sources: {},
        layers: [
          { id: 'background', type: 'background', paint: { 'background-color': '#e4e9e3' } },
        ],
      },
    }),
  );
  await page.route('https://s3.amazonaws.com/elevation-tiles-prod/**', (route) => route.abort());
  const node = (id: string, type: string, lng: number, observer = false, lat = 57.7) => ({
    id,
    publicKey: id.padEnd(64, '0'),
    name: 'Name must not replace the three-byte ID',
    nodeTypeName: type,
    nodeType: 2,
    lat,
    lng,
    iatas: [],
    isObserver: observer,
  });
  const nodes = [
    node('aa0001', 'room_server', 14.1, true),
    node('aa0002', 'room_server', 14.1),
    node('aa0003', 'sensor', 14.1),
    node('aa0004', 'repeater', 14.1),
    node('bb0001', 'companion', 13.7),
    node('bb0002', 'companion', 13.7),
    node('bb0003', 'companion', 13.7),
    node('5c0680', 'room_server', 14.5, true),
    node('abcdef', 'sensor', 14.5, false, 57.5),
  ];
  await page.route('**/api/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({
      json: path === '/api/v1/nodes' ? { items: nodes, hasMore: false } : [],
    });
  });
  await page.goto('/map?lat=57.7&lng=14.1&zoom=9&clustering=on');
  await expect
    .poll(() => page.evaluate(() => window.markerDraws.map((draw) => draw.text)))
    .toContain('4');
  const mixed = await page.evaluate(() => window.markerDraws.find((draw) => draw.text === '4')!);
  expect(mixed.rings).toHaveLength(3);
  expect(mixed.rings.map((ring) => ring.sweep / (Math.PI * 2)).sort()).toEqual([0.25, 0.25, 0.5]);
  expect(mixed.rings.reduce((sum, ring) => sum + ring.sweep, 0)).toBeCloseTo(Math.PI * 2);
  await expect
    .poll(() => page.evaluate(() => window.markerDraws.find((draw) => draw.text === '3')?.rings))
    .toEqual([{ color: '#0072b2', sweep: Math.PI * 2 }]);
  await expect
    .poll(() =>
      page.evaluate(() => window.markerDraws.find((draw) => draw.text === '5C0680')?.eyeCurves),
    )
    .toBe(2);
  await expect
    .poll(() =>
      page.evaluate(() => window.markerDraws.find((draw) => draw.text === 'ABCDEF')?.eyeCurves),
    )
    .toBe(0);
  await page.screenshot({ path: '/tmp/beacon-map-markers.png' });

  await page.getByRole('button', { name: 'Map settings', exact: true }).click();
  await page
    .getByRole('group', { name: 'Node type' })
    .getByRole('button', { name: 'Room', exact: true })
    .click();
  await expect
    .poll(() => page.evaluate(() => window.markerDraws.find((draw) => draw.text === '2')?.rings))
    .toEqual([{ color: '#009e73', sweep: Math.PI * 2 }]);
  await page
    .getByRole('group', { name: 'Node type' })
    .getByRole('button', { name: 'All', exact: true })
    .click();
  await page.getByRole('switch', { name: 'Group nodes' }).click();
  await expect
    .poll(() => page.evaluate(() => window.markerDraws.map((draw) => draw.text)))
    .toContain('AA0004');
  await page.getByRole('tab', { name: 'Packets', exact: true }).click();
  expect(errors).toEqual([]);
});
