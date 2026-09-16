import { expect, test, type Page } from '@playwright/test';
import type { TraceDetail, TracePacket } from '../../src/types/api';

// Kartan kräver lokaliserade noder: samma fixtur som enheterna, runt Västmanland
// så varje ben ligger väl inom 150 km LoRa-gränsen.
const packet: TracePacket = {
  packetHash: 'newest-packet-hash',
  routeType: 1,
  routeTypeName: 'DIRECT',
  scope: 'EU',
  firstHeardAt: Date.now() - 120_000,
  lastHeardAt: Date.now() - 60_000,
  rawPath: [{ hash: 'aa', snr: 3.75 }, { hash: 'bb', snr: 13.25 }, { hash: 'cc' }],
  resolvedRoute: [
    {
      confidence: 'high',
      nodes: [{ id: 'gateway', name: 'Gateway', publicKey: 'aa', longitude: 16.5, latitude: 59.6 }],
    },
    {
      confidence: 'high',
      nodes: [{ id: 'relay', name: 'Relay', publicKey: 'bb', longitude: 16.52, latitude: 59.61 }],
    },
    { confidence: 'none', nodes: [] },
  ],
};
const packets: TracePacket[] = [
  {
    ...packet,
    packetHash: 'empty-path-hash',
    routeTypeName: 'FLOOD',
    scope: undefined,
    lastHeardAt: 1,
    rawPath: [],
    resolvedRoute: [],
  },
  {
    ...packet,
    packetHash: 'long-path-hash-40',
    routeTypeName: 'DIRECT',
    lastHeardAt: 2,
    rawPath: Array.from({ length: 40 }, (_, i) => ({
      hash: `p${i.toString(16).padStart(2, '0')}`,
      snr: i % 2 ? undefined : 7.5,
    })),
    resolvedRoute: [],
  },
  packet,
];

async function openTrace(page: Page, rows = packets) {
  await page.addInitScript(() => localStorage.setItem('beacon-language', 'en'));
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    let data: unknown = [];
    if (path === '/api/v1/traces')
      data = [
        {
          traceTag: 'abcd',
          firstHeardAt: 1,
          lastHeardAt: 2,
          packetCount: rows.length,
          iataCount: 1,
          traceType: 'TRACE',
          pathHashes: [],
          snrValues: [],
        },
      ];
    else if (path === '/api/v1/traces/abcd')
      data = { traceTag: 'abcd', packets: rows } satisfies TraceDetail;
    else if (/\/packets\/|\/nodes\//.test(path)) {
      await route.fulfill({ status: 404, json: { error: 'not found' } });
      return;
    }
    await route.fulfill({ json: data });
  });
  await page.routeWebSocket('**/ws', () => {});
  await page.goto('/traces');
  await page.getByText('ABCD', { exact: true }).click();
  // sektionsrubriken i detaljpanelen (tabb-raden innehåller också ett "Packets")
  const panel = page.locator('.trace-packets');
  await expect(panel).toBeVisible();
  return panel;
}

async function expectContained(page: Page) {
  const sizes = await page.locator('.trace-packets').evaluate((el) => {
    const panel = el.closest('.overflow-hidden')!;
    return {
      table: el.scrollWidth - el.clientWidth,
      panel: panel.scrollWidth - panel.clientWidth,
      page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
  expect(sizes.table).toBe(0);
  expect(sizes.panel).toBe(0);
}

test('packet-path map draws with an All selector and isolates a packet on click', async ({
  page,
}, testInfo) => {
  // WebGL-kartan ritas bara i Chromium här; Firefox täcks av enheterna + filter-specen.
  test.skip(page.context().browser()?.browserType().name() !== 'chromium', 'WebGL map');
  await page.setViewportSize({ width: 1600, height: 900 });
  await openTrace(page);
  const map = page.locator('.trace-map');
  await expect(map).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('desktop.png') });
  // Alla tre paketen listas (nyast först), med karta + väljare ovanför
  await expect(page.getByRole('button', { name: 'All paths' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Analyze →' })).toHaveCount(3);
  // Isolera nyaste paketet: listan filtreras till det paketet
  await page.getByRole('button', { name: 'NEWEST-P' }).click();
  await expect(page.getByRole('button', { name: 'Analyze →' })).toHaveCount(1);
  await page.getByRole('button', { name: 'All paths' }).click();
  await expect(page.getByRole('button', { name: 'Analyze →' })).toHaveCount(3);
  await expectContained(page);
});

test('hop list keeps order, measured SNR and separate node navigation', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await openTrace(page, [packet]);
  const list = page.getByRole('group', { name: 'Path' });
  await expect(list.getByText('Gateway')).toBeVisible();
  await expect(list.getByText('RELAY')).toBeVisible();
  // SNR[1] = länken Gateway→Relay; SNR[0] (utan föregående hopp) ritas aldrig
  await expect(list.getByText('13.25 dB')).toBeVisible();
  await expect(list.getByText('3.75 dB')).not.toBeVisible();
  const request = page.waitForRequest('**/api/v1/nodes/gateway');
  await list.getByRole('button', { name: 'Gateway' }).focus();
  await page.keyboard.press('Enter');
  await request;
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(page.url()).not.toContain('newest-packet-hash');
});

test('keyboard Analyze opens the analyzer without touching node navigation', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await openTrace(page, [packet]);
  await page.getByRole('button', { name: 'Analyze →' }).focus();
  const request = page.waitForRequest('**/api/v1/packets/newest-packet-hash');
  await page.keyboard.press('Enter');
  await request;
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('empty and long paths render without widening the panel', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await openTrace(page);
  await expect(page.getByRole('article', { name: 'EMPTY-PA' }).getByText('No path')).toBeVisible();
  // nyast först: newest-packet-hash, long-path-hash-40, empty-path-hash
  const longPacket = page.getByRole('article', { name: 'LONG-PAT' });
  await expect(longPacket.getByText('P00', { exact: true })).toBeVisible();
  await expect(longPacket.getByText('P27', { exact: true })).toBeVisible();
  // alla 40 hopp listas (#1..#40), inget trunkeras bort
  await expect(longPacket.getByText('#40')).toBeVisible();
  await expectContained(page);
  await page.screenshot({ path: testInfo.outputPath('desktop.png') });
});

for (const width of [360, 768]) {
  test(`compact rows retain content and actions at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await openTrace(page);
    await expect(page.getByRole('button', { name: 'Analyze →' })).toHaveCount(3);
    await expect(
      page.getByRole('article', { name: 'EMPTY-PA' }).getByText('No path'),
    ).toBeVisible();
    await expect(page.getByText('13.25 dB')).toBeVisible();
    await expectContained(page);
    await page.screenshot({ path: testInfo.outputPath('compact.png') });
    // The panel can be narrower than the viewport, independently of breakpoints.
    await page
      .locator('.trace-packets')
      .evaluate((el) => ((el as HTMLElement).style.width = '280px'));
    await expectContained(page);
  });
}

test('Space activates the explicit action for a single packet', async ({ page }) => {
  await openTrace(page, [packet]);
  await page.getByRole('button', { name: 'Analyze →' }).focus();
  const request = page.waitForRequest('**/api/v1/packets/newest-packet-hash');
  await page.keyboard.press('Space');
  await request;
  await expect(page.getByRole('dialog')).toBeVisible();
});

test.describe('touch', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'Mobile emulation requires Chromium');
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('hop popovers and Analyze remain independent on mobile', async ({ page }) => {
    await openTrace(page, [packet]);
    await expectContained(page);
    await page.getByText('Gateway', { exact: true }).tap();
    const popover = page.getByRole('tooltip');
    await expect(popover).toContainText('Hash AA');
    const request = page.waitForRequest('**/api/v1/nodes/gateway');
    await popover.getByRole('button', { name: 'Gateway' }).tap();
    await request;
    await expect(page.getByRole('dialog')).toBeVisible();
    expect(page.url()).not.toContain('newest-packet-hash');
  });
});
