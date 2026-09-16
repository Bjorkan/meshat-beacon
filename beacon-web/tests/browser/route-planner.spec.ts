import { expect, test, type Page } from '@playwright/test';
import type { BestRouteResult } from '../../src/types/api';

const FROM = 'aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899';
const TO = '11223344556677889900aabbccddeeff11223344556677889900aabbccddeeff';

const best: BestRouteResult = {
  paths: [
    {
      nodes: [
        {
          id: 'id-a',
          publicKey: FROM,
          name: 'Alpha',
          latitude: 59.6,
          longitude: 16.5,
          nodeType: 2,
          nodeTypeName: 'repeater',
          stale: false,
        },
        {
          id: 'id-b',
          publicKey: TO,
          name: 'Beta',
          latitude: 59.61,
          longitude: 16.52,
          nodeType: 2,
          nodeTypeName: 'repeater',
          stale: false,
        },
      ],
      legs: [
        {
          from: FROM,
          to: TO,
          snr: 7.5,
          snrSampleCount: 3,
          snrLastSeen: 1,
          observationCount: 5,
          unmeasured: false,
          neighbor: true,
        },
      ],
      totalCost: 0.6,
      hopCount: 1,
      hasUnmeasuredLegs: false,
      containsStaleNodes: false,
    },
  ],
};

async function mockApi(page: Page) {
  await page.addInitScript(() => localStorage.setItem('beacon-language', 'en'));
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path === '/api/v1/routes/best') {
      await route.fulfill({ json: best });
      return;
    }
    if (path === '/api/v1/nodes') {
      const pubkey = url.searchParams.get('pubkey');
      const name = url.searchParams.get('name');
      const prefix = url.searchParams.get('pubkeyPrefix');
      const items = [];
      const alpha = {
        id: 'id-a',
        publicKey: FROM,
        name: 'Alpha',
        lat: 59.6,
        lng: 16.5,
        nodeType: 2,
        nodeTypeName: 'repeater',
      };
      const beta = {
        id: 'id-b',
        publicKey: TO,
        name: 'Beta',
        lat: 59.61,
        lng: 16.52,
        nodeType: 2,
        nodeTypeName: 'repeater',
      };
      if (pubkey === FROM) items.push(alpha);
      else if (pubkey === TO) items.push(beta);
      else if (name && 'alpha'.includes(name.toLowerCase())) items.push(alpha);
      else if (name && 'beta'.includes(name.toLowerCase())) items.push(beta);
      else if (prefix && FROM.startsWith(prefix.toLowerCase())) items.push(alpha);
      else if (prefix && TO.startsWith(prefix.toLowerCase())) items.push(beta);
      await route.fulfill({ json: { items, hasMore: false } });
      return;
    }
    await route.fulfill({ json: path === '/api/v1/traces' ? [] : {} });
  });
  await page.routeWebSocket('**/ws', () => {});
}

test('route planner restores from/to from the URL and shows the neighbor leg', async ({ page }) => {
  await mockApi(page);
  await page.goto(`/routes?from=${FROM}&to=${TO}`);
  await expect(page.getByText('Best')).toBeVisible();
  // name first, grey 3-byte prefix alongside
  await expect(page.getByText('Alpha').first()).toBeVisible();
  await expect(page.getByText('AABBCC').first()).toBeVisible();
  // explicitly marked neighbor leg carries its badge
  await expect(page.getByText('Neighbor').first()).toBeVisible();
  // map pane exists (WebGL canvas itself is engine-dependent)
  await expect(page.getByTestId('route-map')).toBeVisible();
});

test('route planner picks nodes by name search', async ({ page }) => {
  await mockApi(page);
  await page.goto('/routes');
  await expect(
    page.getByText('Pick a from-node and a to-node to plan a route.').first(),
  ).toBeVisible();
  const fromBox = page.getByRole('combobox', { name: 'From' });
  await fromBox.click();
  await fromBox.fill('alp');
  await expect(page.getByRole('option', { name: /Alpha/ })).toBeVisible();
  await page.getByRole('option', { name: /Alpha/ }).click();
  // pick survived into the field
  await expect(fromBox).toHaveValue('Alpha');
});
