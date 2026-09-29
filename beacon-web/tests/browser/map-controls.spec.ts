import { expect, test, type Locator, type Page, type WebSocketRoute } from '@playwright/test';

async function mockMap(page: Page) {
  let socket: WebSocketRoute | undefined;
  await page.addInitScript(() => {
    localStorage.setItem('beacon-language', 'en');
    localStorage.setItem('beacon-map-settings-open', 'true');
    sessionStorage.setItem('meshat-splash-shown', '1');
  });
  await page.routeWebSocket('**/ws', (ws) => {
    socket = ws;
  });
  await page.route('https://tiles.openfreemap.org/**', (route) =>
    route.fulfill({
      json: {
        version: 8,
        sources: {},
        layers: [
          { id: 'background', type: 'background', paint: { 'background-color': '#111827' } },
        ],
      },
    }),
  );
  await page.route('https://s3.amazonaws.com/elevation-tiles-prod/**', (route) => route.abort());
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/v1/nodes/missing') {
      await route.fulfill({ status: 404, json: { error: 'Not found' } });
      return;
    }
    await route.fulfill({ json: path === '/api/v1/nodes' ? { items: [], hasMore: false } : [] });
  });
  return () => {
    for (let index = 0; index < 5; index++) {
      socket?.send(
        JSON.stringify({
          v: 1,
          type: 'event',
          event: 'packetObservation',
          data: {
            packetHash: `packet-${index}`,
            packet: {
              payloadType: 5,
              payloadTypeName: 'GROUP_TEXT',
              observationCount: 2,
              scope: 'custom-region-with-a-long-name',
            },
            observation: {
              observerId: 'observer',
              observerName: 'Observer',
              iata: 'JKG',
              heardAt: Date.now(),
              pathLength: { hashSize: 2, hopCount: 2, raw: '82' },
              resolvedPath: [
                {
                  confidence: 'high',
                  nodes: [{ id: 'a', publicKey: 'aa', latitude: 57.7, longitude: 14.1 }],
                },
                {
                  confidence: 'high',
                  nodes: [{ id: 'b', publicKey: 'bb', latitude: 57.71, longitude: 14.12 }],
                },
              ],
            },
          },
        }),
      );
    }
  };
}

async function noOverlap(first: Locator, second: Locator) {
  const a = await first.boundingBox();
  const b = await second.boundingBox();
  expect(a).not.toBeNull();
  expect(b).not.toBeNull();
  expect(
    a!.x + a!.width <= b!.x ||
      b!.x + b!.width <= a!.x ||
      a!.y + a!.height <= b!.y ||
      b!.y + b!.height <= a!.y,
  ).toBe(true);
}

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 1100, height: 800 },
  { width: 390, height: 844 },
  { width: 320, height: 568 },
  { width: 667, height: 390 },
]) {
  test(`map controls stay separate at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const sendPackets = await mockMap(page);
    await page.goto('/map');
    const settings = page.getByRole('button', { name: 'Map settings', exact: true });
    const zoom = page.locator('.maplibregl-ctrl-zoom-in');
    const nav = page.locator('.maplibregl-ctrl-top-right');
    await expect(zoom).toBeVisible();
    await expect(settings).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByRole('switch')).toHaveCount(0);
    await page.getByRole('button', { name: 'Play live packet flow' }).click();
    const live = page.getByRole('button', { name: 'Stop live packet flow' });
    const feed = page.getByRole('region', { name: 'Live packets', exact: true });
    await expect(feed).toBeVisible();
    sendPackets();
    await expect(feed.locator('[data-packet-hash]')).toHaveCount(5);
    expect(await feed.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    const packetButton = feed.getByRole('button', {
      name: 'Open packet packet-4 in packet viewer',
    });
    await packetButton.scrollIntoViewIfNeeded();
    const packetBounds = await packetButton.boundingBox();
    const feedBounds = await feed.boundingBox();
    expect(packetBounds!.x + packetBounds!.width).toBeLessThanOrEqual(
      feedBounds!.x + feedBounds!.width,
    );
    await settings.click();
    const panel = settings.locator('..');
    await expect(page.getByRole('switch', { name: 'Group nodes' })).toBeDisabled();
    await noOverlap(panel, feed);
    await noOverlap(panel, nav);
    await noOverlap(feed, nav);
    await noOverlap(feed, live);
    await noOverlap(live, page.locator('.maplibregl-ctrl-bottom-left'));
    await expect(zoom).toBeEnabled();
    await zoom.click();

    // Longer help must scroll inside the settings panel without growing over the feed.
    await page.getByText('Map legend', { exact: true }).click();
    await noOverlap(panel, feed);
    await noOverlap(feed, nav);
    await noOverlap(panel, live);
    await page.screenshot({ path: `/tmp/beacon-map-controls-${viewport.width}.png` });

    await page.getByRole('button', { name: 'Hide live packets' }).click();
    await expect(feed).toHaveCount(0);
    await page.getByRole('button', { name: 'Show live packets' }).click();
    await expect(feed).toBeVisible();
    await live.click();
    await expect(feed).toHaveCount(0);
  });
}

test('a desktop node sidebar triggers the narrow map layout', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 800 });
  await mockMap(page);
  await page.goto('/map?node=missing&flow=on');
  await expect(page.getByRole('button', { name: 'Close detail panel' })).toBeVisible();
  const settings = page.getByRole('button', { name: 'Map settings', exact: true });
  await settings.click();
  const feed = page.getByRole('region', { name: 'Live packets', exact: true });
  await noOverlap(settings.locator('..'), feed);
  await noOverlap(feed, page.locator('.maplibregl-ctrl-top-right'));
});

test('minimizing a mobile node panel leaves map controls accessible', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockMap(page);
  await page.goto('/map?node=missing&flow=on');
  await page.getByRole('button', { name: 'Minimize detail panel' }).click();
  const live = page.getByRole('button', { name: 'Stop live packet flow' });
  const detailHeader = page
    .getByRole('button', { name: 'Expand detail panel' })
    .locator('../../..');
  await noOverlap(live, detailHeader);
  await noOverlap(page.locator('.maplibregl-ctrl-bottom-left'), detailHeader);
  await live.click();
  await expect(page.getByRole('button', { name: 'Play live packet flow' })).toBeVisible();
});

test('loading status has its own lane above live traffic on a small screen', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  const sendPackets = await mockMap(page);
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    (url) => url.pathname === '/api/v1/nodes',
    async (route) => {
      await pending;
      await route.fulfill({ json: { items: [], hasMore: false } });
    },
  );
  await page.goto('/map?flow=on');
  const status = page.getByRole('status').filter({ hasText: /Loading/ });
  const feed = page.getByRole('region', { name: 'Live packets', exact: true });
  await expect(feed).toBeVisible();
  sendPackets();
  await expect(feed.locator('[data-packet-hash]')).toHaveCount(5);
  await expect(status).toBeVisible();
  await noOverlap(status, feed);
  await noOverlap(status, page.getByRole('button', { name: 'Stop live packet flow' }));
  release();
  await expect(status).toHaveCount(0);
});
