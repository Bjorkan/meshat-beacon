import { expect, test, type Page } from '@playwright/test';
import type { BestRouteResult } from '../../src/types/api';

const FROM = 'aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899';
const TO = '11223344556677889900aabbccddeeff11223344556677889900aabbccddeeff';
const MID = 'cc'.padEnd(64, '0');

function leg(
  from: string,
  to: string,
  extra: Partial<BestRouteResult['paths'][number]['legs'][number]> = {},
) {
  return {
    from,
    to,
    snrSampleCount: 0,
    snrLastSeen: 0,
    observationCount: 5,
    unmeasured: true,
    neighbor: false,
    unseen: false,
    ...extra,
  };
}

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
          supportsMultibytePaths: false,
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
          supportsMultibytePaths: false,
        },
      ],
      legs: [
        leg(FROM, TO, {
          snr: 7.5,
          snrSampleCount: 3,
          snrLastSeen: 1,
          unmeasured: false,
          neighbor: true,
        }),
      ],
      totalCost: 0.6,
      hopCount: 1,
      hasUnmeasuredLegs: false,
      containsStaleNodes: false,
      hasUnseenLegs: false,
    },
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
          supportsMultibytePaths: false,
        },
        {
          id: 'id-m',
          publicKey: MID,
          name: 'Mid',
          latitude: 59.605,
          longitude: 16.51,
          nodeType: 2,
          nodeTypeName: 'repeater',
          stale: false,
          supportsMultibytePaths: false,
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
          supportsMultibytePaths: false,
        },
      ],
      legs: [leg(FROM, MID), leg(MID, TO)],
      totalCost: 5,
      hopCount: 2,
      hasUnmeasuredLegs: true,
      containsStaleNodes: false,
      hasUnseenLegs: false,
    },
  ],
};

const longRoutes: BestRouteResult = {
  paths: Array.from({ length: 3 }, (_, routeIndex) => {
    const nodes = [
      best.paths[0].nodes[0],
      ...Array.from({ length: 10 }, (_, index) => ({
        ...best.paths[1].nodes[1],
        id: `long-${routeIndex}-${index}`,
        publicKey: (0x100000 + routeIndex * 100 + index).toString(16).padEnd(64, '0'),
        name: `Repeater ${routeIndex + 1}-${index + 1}`,
        latitude: 59.601 + index * 0.0008,
        longitude: 16.501 + index * 0.0016,
      })),
      best.paths[0].nodes[1],
    ];
    return {
      ...best.paths[0],
      nodes,
      legs: nodes.slice(1).map((node, index) => leg(nodes[index].publicKey, node.publicKey)),
      hopCount: nodes.length - 1,
      hasUnmeasuredLegs: true,
    };
  }),
};

async function mockApi(page: Page, result: BestRouteResult = best) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    localStorage.setItem('beacon-language', 'en');
    sessionStorage.setItem('meshat-splash-shown', '1');
  });
  await page.route('https://tiles.openfreemap.org/**', async (route) => {
    if (new URL(route.request().url()).pathname.startsWith('/styles/')) {
      await route.fulfill({
        json: {
          version: 8,
          sources: {},
          glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
          layers: [
            { id: 'background', type: 'background', paint: { 'background-color': '#111827' } },
          ],
        },
      });
    } else {
      await route.fulfill({ contentType: 'application/x-protobuf', body: '' });
    }
  });
  // console/pageerror capture: a map-init exception must be visible in CI
  // logs rather than inferred from a disappearing element.
  page.on('pageerror', (err) => console.log(`[browser-pageerror] ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.log(`[browser-console-error] ${msg.text()}`);
  });
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path === '/api/v1/routes/best') {
      await route.fulfill({ json: result });
      return;
    }
    if (path === '/api/v1/nodes') {
      const pubkey = url.searchParams.get('pubkey');
      const name = url.searchParams.get('name');
      const prefix = url.searchParams.get('pubkeyPrefix');
      // The repeater-only planner passes type=repeater on suggest/lookup
      // calls; the mock honors it so picker filtering is actually exercised.
      const onlyRepeaters = url.searchParams.get('type') === 'repeater';
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
      const companion = {
        id: 'id-c',
        publicKey: 'cc'.padEnd(64, '0'),
        name: 'Companion',
        lat: 59.62,
        lng: 16.53,
        nodeType: 1,
        nodeTypeName: 'companion',
      };
      if (pubkey === FROM) items.push(alpha);
      else if (pubkey === TO) items.push(beta);
      else if (name && 'alpha'.includes(name.toLowerCase())) items.push(alpha);
      else if (name && 'beta'.includes(name.toLowerCase())) items.push(beta);
      else if (name && 'companion'.includes(name.toLowerCase()) && !onlyRepeaters)
        items.push(companion);
      else if (prefix && FROM.startsWith(prefix.toLowerCase())) items.push(alpha);
      else if (prefix && TO.startsWith(prefix.toLowerCase())) items.push(beta);
      await route.fulfill({ json: { items, hasMore: false } });
      return;
    }
    await route.fulfill({ json: path === '/api/v1/traces' ? [] : {} });
  });
  await page.routeWebSocket('**/ws', () => {});
}

test('route planner restores endpoints and reveals node and signal details on demand', async ({
  page,
}) => {
  await mockApi(page);
  await page.goto(`/routes?from=${FROM}&to=${TO}`);
  const first = page.getByRole('article', { name: 'First ranked', exact: true });
  const alternative = page.getByRole('article', { name: 'Alternative 1', exact: true });
  await expect(page.getByRole('combobox', { name: 'From', exact: true })).toHaveValue('Alpha');
  await expect(page.getByRole('combobox', { name: 'To', exact: true })).toHaveValue('Beta');
  await expect(first.getByRole('button', { name: 'Show First ranked on the map' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(first.getByText('Direct route', { exact: true })).toBeVisible();
  await expect(first.getByText('Fresh SNR: 1 of 1 hops', { exact: true })).toBeVisible();
  await expect(alternative.getByText('via Mid', { exact: true })).toBeVisible();
  await expect(alternative.getByText('Fresh SNR: 0 of 2 hops', { exact: true })).toBeVisible();
  for (const card of [first, alternative]) {
    const disclosure = card.getByRole('button', { name: 'Show details', exact: true });
    await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    await expect(card.locator('[data-route-details]')).toBeHidden();
    await expect(disclosure).toHaveAttribute(
      'aria-controls',
      (await card.locator('[data-route-details]').getAttribute('id')) ?? '',
    );
    await expect(card.getByRole('button', { name: /^Open node / })).toHaveCount(0);
    await expect(
      card.getByRole('button', { name: 'Copy MeshCore route', exact: true }),
    ).toBeVisible();
  }
  await expect(first.getByText('7.50 dB', { exact: true })).toBeHidden();
  await expect(first.getByText('Neighbor-marked in this direction', { exact: true })).toBeHidden();
  await first.getByRole('button', { name: 'Show details', exact: true }).click();
  await expect(first.getByRole('button', { name: 'Hide details', exact: true })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  await expect(first.getByRole('button', { name: 'Open node Alpha', exact: true })).toBeVisible();
  await expect(first.getByRole('button', { name: 'Open node Beta', exact: true })).toBeVisible();
  await expect(first.getByText('AABBCC', { exact: true })).toBeVisible();
  await expect(first.getByText('7.50 dB', { exact: true })).toBeVisible();
  await expect(first.getByText(/3 SNR samples/)).toBeVisible();
  await expect(first.getByText('Neighbor-marked in this direction', { exact: true })).toBeVisible();
  await expect(
    alternative.getByRole('button', { name: 'Show details', exact: true }),
  ).toHaveAttribute('aria-expanded', 'false');
  await alternative.getByRole('button', { name: 'Show details', exact: true }).click();
  await expect(
    alternative.getByRole('button', { name: 'Open node Mid', exact: true }),
  ).toBeVisible();
  await expect(alternative.getByText('No fresh SNR', { exact: true })).toHaveCount(2);
  await alternative.getByText('No fresh SNR', { exact: true }).first().click();
  await expect(first.getByRole('button', { name: 'Show First ranked on the map' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page).not.toHaveURL(/alt=/);
  await expect(page.getByTestId('route-map')).toBeVisible();
});

for (const viewport of [
  { name: 'desktop', width: 1280, height: 900, hasTouch: false },
  { name: 'mobile', width: 390, height: 844, hasTouch: true },
]) {
  test.describe(viewport.name, () => {
    test.use({
      viewport: { width: viewport.width, height: viewport.height },
      hasTouch: viewport.hasTouch,
    });

    test('sheet retains its position after repeated drags, taps and route changes', async ({
      page,
      browserName,
    }) => {
      test.skip(!viewport.hasTouch, 'Mobile sheet gestures');
      await mockApi(page);
      await page.goto(`/routes?from=${FROM}&to=${TO}`);
      const sheet = page.getByTestId('route-sheet');
      const handle = page.getByRole('button', { name: 'Toggle results' });
      await expect(page.getByRole('article')).toHaveCount(2);
      await expect(page.getByTestId('meshat-splash-icon')).toBeHidden();
      await expect(sheet).toHaveAttribute('data-snap', 'half');
      const session = browserName === 'chromium' ? await page.context().newCDPSession(page) : null;
      const drag = async (distance: number) => {
        const bounds = (await handle.boundingBox())!;
        const x = bounds.x + bounds.width / 2;
        const y = bounds.y + bounds.height / 2;
        if (session) {
          await session.send('Input.dispatchTouchEvent', {
            type: 'touchStart',
            touchPoints: [{ x, y }],
          });
        } else {
          await page.mouse.move(x, y);
          await page.mouse.down();
        }
        for (let step = 1; step <= 12; step++) {
          const nextY = y - (distance * step) / 12;
          if (session) {
            await session.send('Input.dispatchTouchEvent', {
              type: 'touchMove',
              touchPoints: [{ x, y: nextY }],
            });
          } else {
            await page.mouse.move(x, nextY);
          }
          await page.waitForTimeout(25);
        }
        // Release after pausing so this exercises position-based snapping.
        await page.waitForTimeout(150);
        if (session)
          await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        else await page.mouse.up();
        await page.waitForTimeout(250);
      };
      const initialHeight = (await sheet.boundingBox())!.height;
      await drag(220);
      await expect(sheet).toHaveAttribute('data-snap', 'full');
      const fullHeight = (await sheet.boundingBox())!.height;
      expect(fullHeight).toBeGreaterThan(initialHeight + 100);
      await page.getByRole('button', { name: 'Show Alternative 1 on the map' }).tap();
      await expect(page).toHaveURL(/alt=1/);
      await expect(sheet).toHaveAttribute('data-snap', 'full');
      expect((await sheet.boundingBox())!.height).toBeCloseTo(fullHeight, 0);
      await drag(-220);
      await expect(sheet).toHaveAttribute('data-snap', 'half');
      await drag(-250);
      await expect(sheet).toHaveAttribute('data-snap', 'peek');
      expect((await sheet.boundingBox())!.height).toBeCloseTo(112, 0);
      await expect(handle).toHaveAttribute('aria-expanded', 'false');
      // A fresh tap works after a drag and repeated taps use the saved snap.
      await handle.tap();
      await expect(sheet).toHaveAttribute('data-snap', 'half');
      await page.waitForTimeout(250);
      await handle.tap();
      await expect(sheet).toHaveAttribute('data-snap', 'peek');
      await handle.focus();
      await page.keyboard.press('End');
      await expect(sheet).toHaveAttribute('data-snap', 'full');
      await page.keyboard.press('Home');
      await expect(sheet).toHaveAttribute('data-snap', 'peek');
      await page.keyboard.press('Enter');
      await expect(sheet).toHaveAttribute('data-snap', 'half');
      await session?.detach();
    });

    test('route planner selects the card body without expanding details', async ({
      page,
    }, testInfo) => {
      await mockApi(page);
      await page.goto(`/routes?from=${FROM}&to=${TO}`);
      const first = page.getByRole('article', { name: 'First ranked', exact: true });
      const alternative = page.getByRole('article', { name: 'Alternative 1', exact: true });
      await expect(first).toBeVisible();
      await expect(alternative).toBeVisible();
      await expect(page.getByTestId('meshat-splash-icon')).toBeHidden();
      await page.screenshot({ path: testInfo.outputPath(`${viewport.name}-collapsed.png`) });
      const summary = alternative.getByText('via Mid', { exact: true });
      if (viewport.hasTouch) await summary.tap();
      else await summary.click();
      await expect(page).toHaveURL(/alt=1/);
      await expect(
        alternative.getByRole('button', { name: 'Show Alternative 1 on the map' }),
      ).toHaveAttribute('aria-pressed', 'true');
      await expect(
        first.getByRole('button', { name: 'Show First ranked on the map' }),
      ).toHaveAttribute('aria-pressed', 'false');
      await expect(
        alternative.getByRole('button', { name: 'Show details', exact: true }),
      ).toHaveAttribute('aria-expanded', 'false');
      const disclosure = first.getByRole('button', { name: 'Show details', exact: true });
      if (viewport.hasTouch) await disclosure.tap();
      else await disclosure.click();
      await expect(
        first.getByRole('button', { name: 'Open node Alpha', exact: true }),
      ).toBeVisible();
      await expect(
        first.getByRole('button', { name: 'Hide details', exact: true }),
      ).toHaveAttribute('aria-expanded', 'true');
      await expect(
        alternative.getByRole('button', { name: 'Show details', exact: true }),
      ).toHaveAttribute('aria-expanded', 'false');
      await expect(
        alternative.getByRole('button', { name: 'Show Alternative 1 on the map' }),
      ).toHaveAttribute('aria-pressed', 'true');
      await expect(page).toHaveURL(/alt=1/);
      await page.screenshot({ path: testInfo.outputPath(`${viewport.name}-expanded.png`) });
      for (const card of [first, alternative]) {
        const bounds = await card.boundingBox();
        expect(bounds).not.toBeNull();
        expect(bounds!.x).toBeGreaterThanOrEqual(0);
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width);
        expect(await card.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
      ).toBeLessThanOrEqual(1);
      const copy = alternative.getByRole('button', { name: 'Copy MeshCore route', exact: true });
      await copy.scrollIntoViewIfNeeded();
      await expect(copy).toBeInViewport();
    });

    test('expanded long routes scroll inside the panel without moving the map or page', async ({
      page,
      browserName,
    }) => {
      await mockApi(page, longRoutes);
      await page.addInitScript(() => {
        Object.defineProperty(navigator, 'clipboard', {
          configurable: true,
          value: { writeText: async () => {} },
        });
      });
      await page.goto(`/routes?from=${FROM}&to=${TO}`);
      const cards = page.getByRole('article');
      await expect(cards).toHaveCount(3);
      await expect(page.getByTestId('meshat-splash-icon')).toBeHidden();
      const panel =
        viewport.name === 'mobile'
          ? page.getByTestId('route-results-list')
          : page.getByTestId('route-panel');
      const map = page.getByTestId('route-map');
      const footer = viewport.hasTouch ? page.getByRole('tablist') : page.getByRole('contentinfo');
      const mapBounds = await map.boundingBox();
      const footerBounds = await footer.boundingBox();
      const assertContained = async () => {
        expect(await map.boundingBox()).toEqual(mapBounds);
        expect(await footer.boundingBox()).toEqual(footerBounds);
        expect(
          await page.evaluate(() => ({
            x: window.scrollX,
            y: window.scrollY,
            overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            overflowY:
              document.documentElement.scrollHeight - document.documentElement.clientHeight,
          })),
        ).toEqual({ x: 0, y: 0, overflowX: 0, overflowY: 0 });
      };
      for (const card of await cards.all()) {
        await card.getByRole('button', { name: 'Show details', exact: true }).click();
        await expect(card.locator('[data-route-details]')).toBeVisible();
      }
      await panel.evaluate((el) => {
        el.scrollTop = 0;
      });
      await assertContained();
      const bounds = (await panel.boundingBox())!;
      const session =
        viewport.hasTouch && browserName === 'chromium'
          ? await page.context().newCDPSession(page)
          : null;
      const scroll = async (direction: number, padding = false) => {
        const x = bounds.x + (padding ? 4 : bounds.width / 2);
        const y = bounds.y + bounds.height * 0.7;
        if (session) {
          await session.send('Input.dispatchTouchEvent', {
            type: 'touchStart',
            touchPoints: [{ x, y }],
          });
          for (let step = 1; step <= 8; step++) {
            await session.send('Input.dispatchTouchEvent', {
              type: 'touchMove',
              touchPoints: [{ x, y: y - direction * step * 25 }],
            });
          }
          await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        } else {
          await page.mouse.move(x, y);
          for (let i = 0; i < 8; i++) {
            await page.mouse.wheel(0, direction * 250);
          }
        }
      };
      await panel.evaluate((el) => el.focus());
      await scroll(1, true);
      await expect.poll(() => panel.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
      await assertContained();
      await scroll(1);
      await expect.poll(() => panel.evaluate((el) => el.scrollTop)).toBeGreaterThan(200);
      await assertContained();
      const lastCard = cards.last();
      const lastNode = lastCard.getByRole('button', { name: /^Open node / }).last();
      await lastNode.scrollIntoViewIfNeeded();
      await expect(lastNode).toBeInViewport({ ratio: 1 });
      await assertContained();
      const copy = lastCard.getByRole('button', { name: 'Copy MeshCore route', exact: true });
      if (viewport.hasTouch) await copy.tap();
      else await copy.click();
      await expect(copy).toHaveText('MeshCore route copied');
      await expect(copy).toBeInViewport({ ratio: 1 });
      await assertContained();
      await panel.evaluate((el) => {
        el.scrollTop = el.scrollHeight;
      });
      await scroll(1);
      await expect
        .poll(() =>
          panel.evaluate((el) => Math.abs(el.scrollHeight - el.clientHeight - el.scrollTop)),
        )
        .toBeLessThanOrEqual(1);
      await assertContained();
      await panel.evaluate((el) => {
        el.scrollTop = 0;
      });
      await scroll(-1);
      await assertContained();
      await page.mouse.move(viewport.width - 2, bounds.y + 20);
      await page.mouse.wheel(0, 500);
      await assertContained();
      await session?.detach();
    });

    test('search suggestions remain clickable above route results', async ({ page }) => {
      await mockApi(page, longRoutes);
      await page.goto(`/routes?from=${FROM}&to=${TO}`);
      const to = page.getByRole('combobox', { name: 'To', exact: true });
      await expect(to).toHaveValue('Beta');
      await to.fill('bet');
      const suggestion = page.getByRole('option', { name: /Beta/ });
      await expect(suggestion).toBeInViewport({ ratio: 1 });
      if (viewport.hasTouch) await suggestion.tap();
      else await suggestion.click();
      await expect(suggestion).toBeHidden();
      await expect(page).toHaveURL(new RegExp(`to=${TO}`));
    });

    test('route planner keyboard disclosures and selection stay independent', async ({ page }) => {
      await mockApi(page);
      await page.goto(`/routes?from=${FROM}&to=${TO}`);
      const first = page.getByRole('article', { name: 'First ranked', exact: true });
      const alternative = page.getByRole('article', { name: 'Alternative 1', exact: true });
      const firstSelect = first.getByRole('button', { name: 'Show First ranked on the map' });
      const alternativeSelect = alternative.getByRole('button', {
        name: 'Show Alternative 1 on the map',
      });
      await expect(firstSelect).toHaveJSProperty('tagName', 'BUTTON');
      await expect(alternativeSelect).toHaveJSProperty('tagName', 'BUTTON');
      await alternativeSelect.focus();
      await page.keyboard.press('Tab');
      await expect(
        alternative.getByRole('button', { name: 'Show details', exact: true }),
      ).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(
        alternative.getByRole('button', { name: 'Hide details', exact: true }),
      ).toBeFocused();
      await expect(
        alternative.getByRole('button', { name: 'Hide details', exact: true }),
      ).toHaveAttribute('aria-expanded', 'true');
      await expect(
        alternative.getByRole('button', { name: 'Open node Mid', exact: true }),
      ).toBeVisible();
      await expect(firstSelect).toHaveAttribute('aria-pressed', 'true');
      await expect(page).not.toHaveURL(/alt=/);
      await firstSelect.focus();
      await page.keyboard.press('Tab');
      await expect(first.getByRole('button', { name: 'Show details', exact: true })).toBeFocused();
      await page.keyboard.press('Space');
      await expect(
        first.getByRole('button', { name: 'Hide details', exact: true }),
      ).toHaveAttribute('aria-expanded', 'true');
      await expect(
        alternative.getByRole('button', { name: 'Hide details', exact: true }),
      ).toHaveAttribute('aria-expanded', 'true');
      await alternativeSelect.focus();
      await page.keyboard.press('Enter');
      await expect(alternativeSelect).toHaveAttribute('aria-pressed', 'true');
      await expect(page).toHaveURL(/alt=1/);
      await first.getByRole('button', { name: 'Hide details', exact: true }).focus();
      await page.keyboard.press('Space');
      await expect(
        first.getByRole('button', { name: 'Show details', exact: true }),
      ).toHaveAttribute('aria-expanded', 'false');
      await expect(first.getByRole('button', { name: /^Open node / })).toHaveCount(0);
      await expect(
        alternative.getByRole('button', { name: 'Hide details', exact: true }),
      ).toHaveAttribute('aria-expanded', 'true');
      await expect(alternativeSelect).toHaveAttribute('aria-pressed', 'true');
      await expect(page).toHaveURL(/alt=1/);
      await firstSelect.focus();
      await page.keyboard.press('Space');
      await expect(firstSelect).toHaveAttribute('aria-pressed', 'true');
      await expect(alternativeSelect).toHaveAttribute('aria-pressed', 'false');
      await expect(page).not.toHaveURL(/alt=/);
      await expect(
        first.getByRole('button', { name: 'Show details', exact: true }),
      ).toHaveAttribute('aria-expanded', 'false');
      await expect(
        alternative.getByRole('button', { name: 'Hide details', exact: true }),
      ).toHaveAttribute('aria-expanded', 'true');
    });

    test('copying an inactive route writes its own path without selecting or expanding it', async ({
      page,
    }) => {
      await mockApi(page);
      await page.addInitScript(() => {
        let copied = '';
        Object.defineProperty(navigator, 'clipboard', {
          configurable: true,
          value: {
            writeText: async (value: string) => {
              copied = value;
            },
            readText: async () => copied,
          },
        });
      });
      await page.goto(`/routes?from=${FROM}&to=${TO}`);
      const first = page.getByRole('article', { name: 'First ranked', exact: true });
      const alternative = page.getByRole('article', { name: 'Alternative 1', exact: true });
      const alternativeCopy = alternative.getByRole('button', {
        name: 'Copy MeshCore route',
        exact: true,
      });
      if (viewport.hasTouch) await alternativeCopy.tap();
      else await alternativeCopy.click();
      await expect(alternativeCopy).toHaveText('MeshCore route copied');
      await expect
        .poll(() => page.evaluate(() => navigator.clipboard.readText()))
        .toBe('aabbcc,cc0000,112233');
      await expect(
        first.getByRole('button', { name: 'Show First ranked on the map' }),
      ).toHaveAttribute('aria-pressed', 'true');
      await expect(page).not.toHaveURL(/alt=/);
      await expect(
        alternative.getByRole('button', { name: 'Show details', exact: true }),
      ).toHaveAttribute('aria-expanded', 'false');
      await alternative.getByRole('button', { name: 'Show Alternative 1 on the map' }).click();
      const firstCopy = first.getByRole('button', { name: 'Copy MeshCore route', exact: true });
      await firstCopy.focus();
      await page.keyboard.press('Enter');
      await expect(firstCopy).toHaveText('MeshCore route copied');
      await expect
        .poll(() => page.evaluate(() => navigator.clipboard.readText()))
        .toBe('aabbcc,112233');
      await expect(
        alternative.getByRole('button', { name: 'Show Alternative 1 on the map' }),
      ).toHaveAttribute('aria-pressed', 'true');
      await expect(
        first.getByRole('button', { name: 'Show First ranked on the map' }),
      ).toHaveAttribute('aria-pressed', 'false');
      await expect(page).toHaveURL(/alt=1/);
      for (const card of [first, alternative]) {
        await expect(
          card.getByRole('button', { name: 'Show details', exact: true }),
        ).toHaveAttribute('aria-expanded', 'false');
        await expect(card.locator('[data-route-details]')).toBeHidden();
      }
    });
    test('route planner bottom sheet snaps peek to half on mobile', async ({ page }) => {
      if (viewport.name !== 'mobile') return;
      await mockApi(page, longRoutes);
      await page.goto(`/routes?from=${FROM}&to=${TO}`);
      const sheet = page.locator('section[aria-label]').first();
      await expect(sheet).toBeVisible();
      const map = page.getByTestId('route-map');
      const mapBox = await map.boundingBox();
      const sheetBox = await sheet.boundingBox();
      expect(sheetBox).not.toBeNull();
      if (mapBox && sheetBox) {
        expect(sheetBox.y).toBeLessThan(mapBox.y + mapBox.height * 0.9);
      }
      const handle = sheet.getByRole('button', { name: /Toggle results/ });
      await expect(handle).toBeVisible();
      for (const card of await page.getByRole('article').all()) {
        await expect(card).toBeVisible();
      }
    });

    test('route planner map is visible behind sheet in peek on mobile', async ({ page }) => {
      await mockApi(page);
      await page.goto('/routes');
      const map = page.getByTestId('route-map');
      await expect(map).toBeVisible();
      await page.goto(`/routes?from=${FROM}&to=${TO}`);
      await expect(map).toBeVisible();
    });
  });
}

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

test('route planner picker never surfaces non-repeaters', async ({ page }) => {
  await mockApi(page);
  await page.goto('/routes');
  await expect(
    page.getByText('Pick a from-node and a to-node to plan a route.').first(),
  ).toBeVisible();
  const fromBox = page.getByRole('combobox', { name: 'From' });
  await fromBox.click();
  await fromBox.fill('companion');
  // A companion exists server-side but the repeater-only picker must not
  // offer it through any picker path.
  await expect(page.getByRole('option', { name: /Companion/ })).toHaveCount(0);
});

test('planner adapts between desktop and mobile without reloading or duplicating controls', async ({
  page,
}) => {
  await mockApi(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/routes?from=${FROM}&to=${TO}`);
  await expect(page.getByRole('article')).toHaveCount(2);
  await expect(page.getByRole('combobox')).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Toggle results' })).toBeHidden();
  await page.setViewportSize({ width: 390, height: 844 });
  const handle = page.getByRole('button', { name: 'Toggle results' });
  await expect(handle).toBeVisible();
  await handle.click();
  await expect(page.getByTestId('route-sheet')).toHaveAttribute('data-snap', 'peek');
  const search = (await page.getByTestId('route-search').boundingBox())!;
  const sheet = (await page.getByTestId('route-sheet').boundingBox())!;
  expect(search.y + search.height).toBeLessThan(sheet.y);
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(handle).toBeHidden();
  await expect(page.getByRole('article')).toHaveCount(2);
  await expect(page.getByRole('combobox')).toHaveCount(2);
  await expect(page.getByTestId('route-panel')).toBeVisible();
});

test('Swedish light layout fits a small phone and keeps search accessible after rotation', async ({
  page,
}, testInfo) => {
  await mockApi(page);
  await page.addInitScript(() => {
    localStorage.setItem('beacon-theme', 'meshat-light');
    localStorage.setItem('beacon-language', 'sv');
  });
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto(`/routes?from=${FROM}&to=${TO}`);
  await expect(page.getByRole('article')).toHaveCount(2);
  await expect(page.getByTestId('meshat-splash-icon')).toBeHidden();
  const handle = page.getByRole('button', { name: 'Växla resultat' });
  await handle.focus();
  await page.keyboard.press('End');
  await expect(page.getByTestId('route-sheet')).toHaveAttribute('data-snap', 'full');
  const assertFits = async () => {
    await expect
      .poll(async () => {
        const search = (await page.getByTestId('route-search').boundingBox())!;
        const sheet = (await page.getByTestId('route-sheet').boundingBox())!;
        return sheet.y - search.y - search.height;
      })
      .toBeGreaterThanOrEqual(0);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
    ).toBe(0);
    for (const card of await page.getByRole('article').all()) {
      expect(await card.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
    }
  };
  await assertFits();
  await page.screenshot({ path: testInfo.outputPath('small-phone-light-sv.png') });
  await page.setViewportSize({ width: 740, height: 390 });
  await assertFits();
  await expect(page.getByRole('combobox')).toHaveCount(2);
  await page.getByRole('combobox', { name: 'Från', exact: true }).fill('alp');
  await expect(page.getByRole('option', { name: /Alpha/ })).toBeVisible();
  await page.getByRole('option', { name: /Alpha/ }).click();
});
