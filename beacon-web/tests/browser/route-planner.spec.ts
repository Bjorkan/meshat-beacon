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

async function mockApi(page: Page) {
  await page.addInitScript(() => localStorage.setItem('beacon-language', 'en'));
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
      await route.fulfill({ json: best });
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
