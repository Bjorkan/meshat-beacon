import { expect, test, type Page } from '@playwright/test';
import type { TraceDetail, TracePacket } from '../../src/types/api';

const packet: TracePacket = {
  packetHash: 'newest-packet',
  routeType: 1,
  routeTypeName: 'DIRECT',
  scope: 'EU',
  firstHeardAt: Date.now() - 120_000,
  lastHeardAt: Date.now() - 60_000,
  rawPath: [{ hash: 'aa', snr: 13.25 }, { hash: 'bb', snr: 3.75 }, { hash: 'cc' }],
  resolvedRoute: [
    { confidence: 'high', nodes: [{ id: 'gateway', name: 'Gateway', publicKey: 'aa' }] },
    { confidence: 'ambiguous', nodes: [{ id: 'candidate', name: 'Candidate', publicKey: 'bb' }] },
    { confidence: 'none', nodes: [] },
  ],
};
const packets: TracePacket[] = [
  {
    ...packet,
    packetHash: 'empty-path',
    routeTypeName: 'FLOOD',
    scope: undefined,
    lastHeardAt: 1,
    rawPath: [],
    resolvedRoute: [],
  },
  {
    ...packet,
    packetHash: 'long-path',
    routeTypeName: 'DIRECT',
    lastHeardAt: 2,
    rawPath: Array.from({ length: 40 }, (_, i) => ({
      hash: i.toString(16).padStart(2, '0'),
      snr: i % 2 ? undefined : 7.5,
    })),
    resolvedRoute: [
      {
        confidence: 'high',
        nodes: [{ id: 'long-name', name: 'LongRepeaterName'.repeat(10), publicKey: '00' }],
      },
    ],
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
  const table = page.getByRole('table', { name: `${rows.length} packet`, exact: false });
  await expect(table).toBeVisible();
  return table;
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
  expect(sizes).toEqual({ table: 0, panel: 0, page: 0 });
}

test('desktop columns align and long paths scroll locally without widening the panel', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  const table = await openTrace(page);
  await page.screenshot({ path: testInfo.outputPath('desktop.png') });
  const header = await table
    .locator('thead th')
    .evaluateAll((cells) => cells.map((el) => el.getBoundingClientRect().x));
  for (const row of await table.locator('tbody tr').all()) {
    const cells = await row
      .locator('td')
      .evaluateAll((cells) => cells.map((el) => el.getBoundingClientRect().x));
    expect(cells).toEqual(header);
    expect(await row.evaluate((el) => el.getBoundingClientRect().height)).toBeLessThan(90);
  }
  const paths = table.getByRole('region', { name: 'Path' });
  const longPath = paths.nth(1);
  expect(await longPath.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  await expectContained(page);
  await longPath.focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => longPath.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
  await longPath.evaluate((el) => {
    el.scrollLeft = el.scrollWidth;
  });
  await expect(longPath.getByText('27', { exact: true })).toBeInViewport();
  await page.locator('.trace-packets').evaluate((el) => {
    (el as HTMLElement).style.width = '400px';
  });
  expect(
    await table
      .locator('tbody tr')
      .first()
      .evaluate((el) => getComputedStyle(el).display),
  ).toBe('grid');
  await expectContained(page);
});

test('keyboard node navigation and Analyze are separate actions in row order', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  const table = await openTrace(page);
  const row = table.locator('tbody tr').first();
  const path = row.getByRole('region', { name: 'Path' });
  await path.focus();
  await page.keyboard.press('Tab');
  await expect(row.getByRole('button', { name: 'Gateway' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(row.getByRole('button', { name: 'Analyze →' })).toBeFocused();
  const request = page.waitForRequest('**/api/v1/packets/newest-packet');
  await page.keyboard.press('Enter');
  await request;
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('resolved node opens its details without opening the analyzer', async ({ page }) => {
  const table = await openTrace(page, [packet]);
  const request = page.waitForRequest('**/api/v1/nodes/gateway');
  await table.getByRole('button', { name: 'Gateway' }).focus();
  await page.keyboard.press('Enter');
  await request;
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(page.url()).not.toContain('newest-packet');
});

for (const width of [360, 768]) {
  test(`compact rows retain content and actions at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const table = await openTrace(page);
    await expect(table.getByRole('button', { name: 'Analyze →' })).toHaveCount(3);
    await expect(table.getByText('No path')).toBeVisible();
    await expect(table.getByText('13.25 dB')).toBeVisible();
    await expectContained(page);
    await page.screenshot({ path: testInfo.outputPath('compact.png') });
    // The panel can be narrower than the viewport, independently of breakpoints.
    await page
      .locator('.trace-packets')
      .evaluate((el) => ((el as HTMLElement).style.width = '280px'));
    expect(
      await table
        .locator('tbody tr')
        .first()
        .evaluate((el) => getComputedStyle(el).display),
    ).toBe('grid');
    await expectContained(page);
  });
}

test('Space activates the explicit action for a single packet', async ({ page }) => {
  const table = await openTrace(page, [packet]);
  await table.getByRole('button', { name: 'Analyze →' }).focus();
  const request = page.waitForRequest('**/api/v1/packets/newest-packet');
  await page.keyboard.press('Space');
  await request;
  await expect(page.getByRole('dialog')).toBeVisible();
});

test.describe('touch', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'Mobile emulation requires Chromium');
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('hop popovers and Analyze remain independent on mobile', async ({ page }) => {
    const table = await openTrace(page, [packet]);
    await expectContained(page);
    await table.getByText('Gateway', { exact: true }).tap();
    const popover = page.getByRole('tooltip');
    await expect(popover).toContainText('Hash AA');
    const request = page.waitForRequest('**/api/v1/nodes/gateway');
    await popover.getByRole('button', { name: 'Gateway' }).tap();
    await request;
    await expect(page.getByRole('dialog')).toBeVisible();
    expect(page.url()).not.toContain('newest-packet');
  });
});
