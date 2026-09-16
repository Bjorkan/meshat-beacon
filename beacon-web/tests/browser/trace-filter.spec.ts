import { expect, test, type Page } from '@playwright/test';
import type { TraceTagSummary } from '../../src/types/api';

function traces(type: '' | 'TRACE' | 'PING'): TraceTagSummary[] {
  const prefix = type === 'TRACE' ? 'b' : type === 'PING' ? 'c' : 'a';
  return Array.from({ length: 200 }, (_, i) => ({
    traceTag: prefix + i.toString(16).padStart(7, '0'),
    traceType: type || (i % 2 ? 'PING' : 'TRACE'),
    firstHeardAt: 1_789_516_800_001 - i * 60_000,
    lastHeardAt: 1_789_516_860_123 - i * 60_000,
    packetCount: i + 1,
    iataCount: 3,
    pathHashes: ['a1', 'b2', 'c3', 'd4', 'e5', 'f6', '07', '08'],
    snrValues: [13.25, 3.75, -7.5, 4, 8, 0, 5, 6],
    resolvedPath: Array.from({ length: 8 }, (_, hop) => ({
      confidence: hop % 3 ? 'high' : 'ambiguous',
      nodeName: `SE-STD-REPEATER-${i}-${hop}`,
    })),
  }));
}

async function prepare(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('beacon-language', 'en');
    sessionStorage.setItem('meshat-splash-shown', '1');
  });
  await page.routeWebSocket('**/ws', () => {});
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url());
    const type = url.searchParams.get('type') as '' | 'TRACE' | 'PING' | null;
    await route.fulfill({ json: url.pathname === '/api/v1/traces' ? traces(type ?? '') : [] });
  });
  await page.goto('/traces');
  await expect(page.getByText('A0000000', { exact: true })).toBeVisible();
}

test('filter swaps update the list to the matching result set', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await prepare(page);
  const group = page.getByRole('group', { name: 'Trace type' });
  for (const [label, prefix] of [
    ['Trace', 'B'],
    ['Ping', 'C'],
    ['All', 'A'],
    ['Trace', 'B'],
    ['Ping', 'C'],
    ['All', 'A'],
  ]) {
    await group.getByRole('button', { name: label, exact: true }).click();
    await expect(group.getByRole('button', { name: label, exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.getByText(`${prefix}0000000`, { exact: true })).toBeVisible();
  }
  // Virtualized: only viewport + overscan mounts, never the full 200 rows.
  expect(await page.locator('tbody tr[tabindex]').count()).toBeLessThan(50);
});

test('slow and superseded requests keep controls usable and preserve URL history', async ({
  page,
}) => {
  await prepare(page);
  let releaseTrace = () => {};
  const responseReady = new Promise<void>((resolve) => {
    releaseTrace = resolve;
  });
  let notifyRequest = () => {};
  const requestStarted = new Promise<void>((resolve) => {
    notifyRequest = resolve;
  });
  await page.route('**/api/v1/traces?**', async (route) => {
    if (new URL(route.request().url()).searchParams.get('type') !== 'TRACE')
      return route.fallback();
    notifyRequest();
    await responseReady;
    await route.fulfill({ json: traces('TRACE') });
  });
  const group = page.getByRole('group', { name: 'Trace type' });
  try {
    await group.getByRole('button', { name: 'Trace', exact: true }).click();
    await requestStarted;
    await expect(group.getByRole('button', { name: 'Trace', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(new URL(page.url()).searchParams.get('tt')).toBe('TRACE');
    // The first response is still held. Keyboard navigation and a second filter must work now.
    // (The held TRACE fetch is aborted by the query client when Ping mounts its own query,
    // so the old response may never arrive — the Ping result must win regardless.)
    await group.getByRole('button', { name: 'Trace', exact: true }).focus();
    await page.keyboard.press('Tab');
    await expect(group.getByRole('button', { name: 'Ping', exact: true })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByText('C0000000', { exact: true })).toBeVisible();
    releaseTrace();
    // If the aborted TRACE response still resolves, it must not clobber the Ping view.
    await page.waitForTimeout(500);
    await expect(group.getByRole('button', { name: 'Ping', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.getByText('C0000000', { exact: true })).toBeVisible();
    expect(new URL(page.url()).searchParams.get('tt')).toBe('PING');
    await page.goBack();
    await expect(page.getByText('B0000000', { exact: true })).toBeVisible();
    expect(new URL(page.url()).searchParams.get('tt')).toBe('TRACE');
    await page.goBack();
    await expect(page.getByText('A0000000', { exact: true })).toBeVisible();
    expect(new URL(page.url()).searchParams.get('tt')).toBeNull();
    await page.goForward();
    await expect(page.getByText('B0000000', { exact: true })).toBeVisible();
  } finally {
    releaseTrace();
  }
});

for (const width of [1440, 390]) {
  test(`all 200 traces remain reachable and filter swaps reset scroll at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await prepare(page);
    const scroller = page.locator('[data-virtualized="true"]');
    // Variable-height paths are measured while scrolling; settle at the last item.
    await expect(async () => {
      await scroller.evaluate((el) => {
        el.scrollTop = el.scrollHeight;
      });
      await expect(page.getByText('A00000C7', { exact: true })).toBeInViewport();
    }).toPass();
    expect(await scroller.locator('[data-index]').count()).toBeLessThan(50);
    await page
      .getByRole('group', { name: 'Trace type' })
      .getByRole('button', { name: 'Ping', exact: true })
      .click();
    await expect(page.getByText('C0000000', { exact: true })).toBeInViewport();
    expect(await page.locator('[data-virtualized="true"]').evaluate((el) => el.scrollTop)).toBe(0);
  });
}
