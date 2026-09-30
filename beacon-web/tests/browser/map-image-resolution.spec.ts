import { expect, test, type Page } from '@playwright/test';
import type { Map as MapLibreMap } from 'maplibre-gl';

declare global {
  interface Window {
    beaconMap?: MapLibreMap;
  }
}

// MapLibre v6 requires runtime marker images to be resolved through
// map.setMissingStyleImageResolver before the requesting tiles parse (#101, #102): clusters must
// draw their generated count/ring symbol above the native fallback circle, and spiderfy leaves
// must draw their capsules at the end of each leg.

interface TestNode {
  id: string;
  publicKey: string;
  name: string;
  nodeTypeName: string;
  nodeType: number;
  lat: number;
  lng: number;
  iatas: never[];
  isObserver: boolean;
}

const node = (id: string, type: string, lng: number, observer = false, lat = 57.7): TestNode => ({
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

const stubBackend = async (page: Page, nodes: TestNode[]) => {
  await page.addInitScript(() => {
    localStorage.setItem('beacon-language', 'en');
    sessionStorage.setItem('meshat-splash-shown', '1');
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
  await page.route('**/api/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/v1/nodes') return route.fulfill({ json: { items: nodes, hasMore: false } });
    // Node detail panel queries: serve the matching fixture node and empty lists for its
    // observations/neighbors, so selecting a leaf renders a normal detail panel.
    const detail = /^\/api\/v1\/nodes\/([^/]+)$/.exec(path);
    if (detail) {
      const found = nodes.find((candidate) => candidate.id === decodeURIComponent(detail[1]!));
      return found
        ? route.fulfill({ json: found })
        : route.fulfill({ status: 404, json: { error: 'Not found' } });
    }
    if (/^\/api\/v1\/nodes\/[^/]+\/observations$/.test(path))
      return route.fulfill({ json: { items: [], hasMore: false } });
    if (/^\/api\/v1\/nodes\/[^/]+\/path-packets(\?.*)?$/.test(path))
      return route.fulfill({ json: { items: [], hasMore: false } });
    if (/^\/api\/v1\/nodes\/[^/]+\/neighbors$/.test(path)) return route.fulfill({ json: [] });
    return route.fulfill({ json: [] });
  });
};

const trackUnresolvedImages = (page: Page): { unresolved: string[] } => {
  const unresolved: string[] = [];
  page.on('console', (message) => {
    if (message.type() !== 'warning') return;
    const match = /Image "(node-(?:cluster|pill):[^"]*)" could not be loaded/.exec(message.text());
    if (match) unresolved.push(match[1]!);
  });
  return { unresolved };
};

const renderedFeatureCount = (page: Page, layerId: string) => (): Promise<number> =>
  page.evaluate((layer) => {
    const map = window.beaconMap;
    if (!map) return -1; // map not mounted yet; keep polling
    if (!map.getLayer(layer)) return -1;
    return map.queryRenderedFeatures({ layers: [layer] }).length;
  }, layerId);

const spiderfyLeafCount = (page: Page) => (): Promise<number> =>
  page.evaluate(() => {
    const map = window.beaconMap;
    if (!map) return 0; // map not mounted yet; keep polling
    const layers = (map.getStyle().layers ?? [])
      .map((layer) => layer.id)
      .filter((id) => id.includes('-spiderfy-leaf'));
    return layers.flatMap((id) => map.queryRenderedFeatures({ layers: [id] })).length;
  });

const renderedClusters = (page: Page, layerId: string) => (): Promise<string[]> =>
  page.evaluate((layer) => {
    const map = window.beaconMap;
    if (!map) return []; // map not mounted yet; keep polling
    return map
      .queryRenderedFeatures({ layers: [layer] })
      .map((feature) =>
        feature.geometry.type === 'Point'
          ? `${feature.properties?.point_count}@${feature.geometry.coordinates
              .map((value: number) => value.toFixed(5))
              .join(',')}`
          : '',
      )
      .sort();
  }, layerId);

// The GeoJSON source tiles can render before MapLibre's 'load' event; camera/interaction work
// (cluster clicks, spiderfy) is only reliable once the map is fully loaded, so gate on loaded()
// before touching the map, the way a real user would.
const waitForMapReady = (page: Page) =>
  expect
    .poll(() => page.evaluate(() => window.beaconMap?.loaded() ?? false), { timeout: 15000 })
    .toBe(true);

const clustersMatch = async (page: Page) => {
  const fallback = await renderedClusters(page, 'nodes-clusters-fallback')();
  const symbols = await renderedClusters(page, 'nodes-clusters')();
  return fallback.length > 0 && JSON.stringify(fallback) === JSON.stringify(symbols);
};

test('zooming into unseen cluster compositions resolves every generated marker image', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1100, height: 800 });
  const { unresolved } = trackUnresolvedImages(page);
  await stubBackend(page, [
    node('aa0001', 'room_server', 14.1, true),
    node('aa0002', 'room_server', 14.1),
    node('aa0003', 'sensor', 14.1),
    node('aa0004', 'repeater', 14.1),
    node('bb0001', 'companion', 13.7),
    node('bb0002', 'companion', 13.7),
    node('bb0003', 'companion', 13.7),
    node('5c0680', 'room_server', 14.5, true),
    node('abcdef', 'sensor', 14.3, false, 57.6),
  ]);
  // Open below the capsule range so the zoom creates cluster ids and capsule ids that the
  // session has never requested; nothing re-layouts the layers afterwards.
  await page.goto('/map?lat=57.7&lng=14.1&zoom=7&clustering=on');
  await waitForMapReady(page);
  await expect
    .poll(renderedFeatureCount(page, 'nodes-clusters-fallback'), { timeout: 15000 })
    .toBeGreaterThanOrEqual(1);

  await page.evaluate(() => {
    const map = window.beaconMap;
    if (!map) throw new Error('beaconMap not exposed');
    map.jumpTo({ center: [14.1, 57.7], zoom: 9.5 });
  });
  // Every rendered fallback circle must have its generated symbol above it...
  await expect.poll(() => clustersMatch(page), { timeout: 15000 }).toBe(true);
  // ...and the capsule layer must show both unclustered nodes.
  await expect.poll(renderedFeatureCount(page, 'nodes-unclustered'), { timeout: 15000 }).toBe(2);
  expect(unresolved).toEqual([]);
});

test('spiderfying a terminal cluster renders clickable leaf capsules', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 800 });
  const { unresolved } = trackUnresolvedImages(page);
  await stubBackend(page, [
    node('cc0001', 'repeater', 14.1, true),
    node('cc0002', 'companion', 14.1),
    node('cc0003', 'sensor', 14.1),
  ]);
  await page.goto('/map?lat=57.7&lng=14.1&zoom=16&clustering=on');
  await waitForMapReady(page);
  await expect
    .poll(renderedFeatureCount(page, 'nodes-clusters-fallback'), { timeout: 15000 })
    .toBe(1);

  const clickAt = async (offsetX: number) => {
    const point = await page.evaluate((offset) => {
      const map = window.beaconMap;
      if (!map) throw new Error('beaconMap not exposed');
      const projected = map.project([14.1, 57.7]);
      const rect = map.getCanvas().getBoundingClientRect();
      return { x: rect.left + projected.x + offset, y: rect.top + projected.y };
    }, offsetX);
    await page.mouse.click(point.x, point.y);
  };

  await clickAt(0);
  await expect.poll(spiderfyLeafCount(page), { timeout: 15000 }).toBe(3);
  // A leaf click must select the node instead of closing the fan as a click on empty map. The
  // selected ring cannot render for a node that is still inside the terminal cluster, so assert
  // the selection through the URL the app writes and the opened detail panel. Opening the panel
  // also changes the map insets, which moves the camera and closes the fan by design.
  await clickAt(110);
  await expect.poll(() => page.url(), { timeout: 15000 }).toContain('node=cc0001');
  await expect(page.getByText('cc0001' + '0'.repeat(12))).toBeVisible();
  expect(unresolved).toEqual([]);
});
